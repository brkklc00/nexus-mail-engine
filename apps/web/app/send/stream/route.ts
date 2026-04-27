import { prisma } from "@nexus/db";
import { calculateEffectiveRate, type WarmupTier } from "@nexus/rate-control";
import { getSession } from "@/server/auth/session";
import { getQueueObservability } from "@/server/observability/queue-observability.service";

const encoder = new TextEncoder();
const DEFAULT_ALIBABA_LADDER: WarmupTier[] = [
  { name: "5k/day", minDelivered: 5000, ratePerSecond: 0.06 },
  { name: "10k/day", minDelivered: 10000, ratePerSecond: 0.12 },
  { name: "25k/day", minDelivered: 25000, ratePerSecond: 0.29 },
  { name: "50k/day", minDelivered: 50000, ratePerSecond: 0.58 },
  { name: "100k/day", minDelivered: 100000, ratePerSecond: 1.16 },
  { name: "250k/day", minDelivered: 250000, ratePerSecond: 2.89 },
  { name: "500k/day", minDelivered: 500000, ratePerSecond: 5.79 },
  { name: "1m/day", minDelivered: 1000000, ratePerSecond: 11.57 }
];

function ssePayload(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const campaignId = url.searchParams.get("campaignId");
  if (!campaignId) {
    return new Response("campaignId is required", { status: 400 });
  }

  let interval: ReturnType<typeof setInterval> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const push = async () => {
        if (closed) return;
        const campaign = await prisma.campaign.findUnique({
          where: { id: campaignId },
          include: { smtpAccount: true }
        });
        if (!campaign) {
          controller.enqueue(ssePayload("error", { error: "campaign_not_found" }));
          if (interval) clearInterval(interval);
          if (heartbeat) clearInterval(heartbeat);
          controller.close();
          closed = true;
          return;
        }

        const configuredSmtpIds = Array.isArray(((campaign as any).smtpPoolConfig as any)?.smtpIds)
          ? ((((campaign as any).smtpPoolConfig as any).smtpIds as string[]))
          : [campaign.smtpAccountId];
        const [smtpPool, perSmtpSentRows, perSmtpQueuedRows, queueObs] = await Promise.all([
          prisma.smtpAccount.findMany({
            where: { id: { in: configuredSmtpIds }, isActive: true, isSoftDeleted: false },
            select: { id: true, name: true, isThrottled: true }
          }),
          prisma.campaignRecipient.groupBy({
            by: ["smtpAccountId"],
            where: { campaignId: campaign.id, sendStatus: "sent" },
            _count: { _all: true }
          }),
          prisma.campaignRecipient.groupBy({
            by: ["smtpAccountId"],
            where: { campaignId: campaign.id, sendStatus: "queued" },
            _count: { _all: true }
          }),
          getQueueObservability()
        ]);
        const perSmtpSent = perSmtpSentRows
          .filter((row: any) => Boolean(row.smtpAccountId))
          .map((row: any) => ({
            smtpAccountId: row.smtpAccountId,
            smtpName: smtpPool.find((smtp: any) => smtp.id === row.smtpAccountId)?.name ?? row.smtpAccountId,
            sent: Number(row._count?._all ?? 0)
          }));
        const activeSmtpIds = perSmtpQueuedRows
          .filter((row: any) => Boolean(row.smtpAccountId) && Number(row._count?._all ?? 0) > 0)
          .map((row: any) => row.smtpAccountId as string);
        const currentRotation = activeSmtpIds[0] ?? configuredSmtpIds[0] ?? campaign.smtpAccountId;

        const warmupAgg = await prisma.smtpWarmupStat.aggregate({
          where: { smtpAccountId: campaign.smtpAccountId },
          _sum: { successfulDeliveries: true }
        });
        const rate = calculateEffectiveRate({
          smtpHost: campaign.smtpAccount.host,
          targetRatePerSecond: campaign.smtpAccount.targetRatePerSecond,
          maxRatePerSecond: campaign.smtpAccount.maxRatePerSecond,
          alibabaRateCap: campaign.smtpAccount.alibabaRateCap,
          alibabaWarmupMaxRatePerSecond: campaign.smtpAccount.alibabaWarmupMaxRatePerSecond,
          deliveredSuccessCount: warmupAgg._sum.successfulDeliveries ?? 0,
          warmupLadder: DEFAULT_ALIBABA_LADDER
        });
        const total = campaign.totalTargeted || 1;
        controller.enqueue(
          ssePayload("progress", {
            campaignId: campaign.id,
            status: campaign.status,
            progress: Number((((campaign.totalSent + campaign.totalFailed + campaign.totalSkipped) / total) * 100).toFixed(2)),
            sent: campaign.totalSent,
            failed: campaign.totalFailed,
            skipped: campaign.totalSkipped,
            opened: campaign.totalOpened,
            clicked: campaign.totalClicked,
            currentRate: rate.effectiveRatePerSecond,
            effectiveRate: rate.effectiveRatePerSecond,
            throttleReason: campaign.throttleReason,
            warmupTier: rate.warmupTierName,
            warmupNextTier: rate.nextTierName,
            activeSmtps: smtpPool.filter((smtp: any) => !smtp.isThrottled).map((smtp: any) => ({
              id: smtp.id,
              name: smtp.name
            })),
            currentRotation,
            perSmtpSent,
            queue: {
              waiting: Number(queueObs.deliveryCounts?.waiting ?? queueObs.deliveryCounts?.wait ?? 0),
              active: Number(queueObs.deliveryCounts?.active ?? 0),
              failed: Number(queueObs.deliveryCounts?.failed ?? 0)
            }
          })
        );

        if (["completed", "failed", "canceled", "partially_completed"].includes(campaign.status)) {
          controller.enqueue(ssePayload("done", { campaignId: campaign.id, status: campaign.status }));
          if (interval) clearInterval(interval);
          if (heartbeat) clearInterval(heartbeat);
          controller.close();
          closed = true;
        }
      };

      void push();
      interval = setInterval(() => void push(), 1000);
      heartbeat = setInterval(() => {
        if (!closed) {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        }
      }, 15000);
    },
    cancel() {
      if (interval) clearInterval(interval);
      if (heartbeat) clearInterval(heartbeat);
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
