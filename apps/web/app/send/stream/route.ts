import { prisma } from "@nexus/db";
import { calculateEffectiveRate, type WarmupTier } from "@nexus/rate-control";
import { getSession } from "@/server/auth/session";

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
            warmupNextTier: rate.nextTierName
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
