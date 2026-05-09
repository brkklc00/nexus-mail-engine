import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { getQueueObservability } from "@/server/observability/queue-observability.service";

const encoder = new TextEncoder();
function isAlibabaProvider(providerLabel: string | null | undefined, host: string | null | undefined) {
  const provider = String(providerLabel ?? "").toLowerCase();
  const smtpHost = String(host ?? "").toLowerCase();
  return provider.includes("alibaba") || provider.includes("aliyun") || smtpHost.includes("smtpdm");
}

function smtpEligibilityReason(smtp: any): string | null {
  if (!smtp?.isActive) return "disabled";
  if (smtp?.isSoftDeleted) return "archived";
  if (!smtp?.host || !smtp?.port || !smtp?.username || !smtp?.fromEmail || !smtp?.passwordEncrypted) return "missing_credentials";
  const authText = `${smtp?.healthStatus ?? ""} ${smtp?.throttleReason ?? ""} ${smtp?.lastError ?? ""}`.toLowerCase();
  if (authText.includes("auth_failed") || authText.includes("authentication") || authText.includes("invalid credentials")) {
    return "auth_failed";
  }
  if (smtp?.healthStatus === "error") return "unhealthy";
  if (smtp?.isThrottled && smtp?.cooldownUntil && new Date(smtp.cooldownUntil).getTime() > Date.now()) return "throttled";
  return null;
}

function computeWarmupRate(smtp: any, delivered: number, desiredRps: number) {
  if (!smtp?.warmupEnabled) return desiredRps;
  const maxWarmup = Math.max(
    Number(smtp?.warmupMaxRps ?? 0),
    Number(smtp?.alibabaWarmupMaxRatePerSecond ?? 0),
    Number(smtp?.targetRatePerSecond ?? 0)
  );
  const progressRate = Number(smtp?.warmupStartRps ?? 1) + Math.floor(delivered / 1000) * Number(smtp?.warmupIncrementStep ?? 1);
  return Math.min(desiredRps, Math.max(0.01, Math.min(maxWarmup || desiredRps, progressRate)));
}

function ssePayload(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function isMissingCampaignSoftDeleteColumn(message: string): boolean {
  return /column .*isdeleted.* does not exist/i.test(message);
}

async function findCampaignForStream(campaignId: string) {
  const select = {
    id: true,
    status: true,
    smtpAccountId: true,
    smtpPoolConfig: true,
    totalTargeted: true,
    totalSent: true,
    totalFailed: true,
    totalSkipped: true,
    totalOpened: true,
    totalClicked: true,
    throttleReason: true,
    smtpAccount: {
      select: {
        host: true,
        targetRatePerSecond: true,
        maxRatePerSecond: true,
        alibabaRateCap: true,
        alibabaWarmupMaxRatePerSecond: true
      }
    }
  } as const;

  try {
    return await prisma.campaign.findFirst({
      where: { id: campaignId, isDeleted: false },
      select
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[campaign.lookup] failed", { campaignId, message });
    if (!isMissingCampaignSoftDeleteColumn(message)) {
      return null;
    }
    return prisma.campaign.findUnique({
      where: { id: campaignId },
      select
    });
  }
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
        const campaign = await findCampaignForStream(campaignId);
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
        const [smtpPool, perSmtpSentRows, perSmtpQueuedRows, queueObs, targetSummaryRow, schedulerDiagRow, dbStatusRowsRaw] = await Promise.all([
          prisma.smtpAccount.findMany({
            where: { id: { in: configuredSmtpIds }, isActive: true, isSoftDeleted: false },
            select: {
              id: true,
              name: true,
              host: true,
              providerLabel: true,
              isActive: true,
              isSoftDeleted: true,
              isThrottled: true,
              healthStatus: true,
              cooldownUntil: true,
              throttleReason: true,
              lastError: true,
              username: true,
              fromEmail: true,
              passwordEncrypted: true,
              port: true,
              targetRatePerSecond: true,
              maxRatePerSecond: true,
              warmupEnabled: true,
              warmupStartRps: true,
              warmupIncrementStep: true,
              warmupMaxRps: true,
              alibabaRateCap: true,
              alibabaWarmupMaxRatePerSecond: true
            }
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
          getQueueObservability(),
          prisma.appSetting.findUnique({ where: { key: "smtp_daily_target_summary" } }).catch(() => null),
          prisma.appSetting.findUnique({ where: { key: "scheduler_runtime_diagnostics" } }).catch(() => null),
          prisma.campaignRecipient.groupBy({
            by: ["sendStatus"],
            where: {
              campaignId: campaign.id
            },
            _count: { _all: true }
          }).catch(() => [])
        ]);
        const dbStatusRows = (Array.isArray(dbStatusRowsRaw) ? dbStatusRowsRaw : []) as Array<{
          sendStatus: "pending" | "queued" | "sent" | "failed" | "skipped";
          _count: { _all: number };
        }>;
        const dbPendingRecipients = Number(dbStatusRows.find((row) => row.sendStatus === "pending")?._count._all ?? 0);
        const dbQueuedRecipients = Number(dbStatusRows.find((row) => row.sendStatus === "queued")?._count._all ?? 0);
        const dbProcessingRecipients = dbQueuedRecipients;
        const dbSentRecipients = Number(dbStatusRows.find((row) => row.sendStatus === "sent")?._count._all ?? 0);
        const dbFailedRecipients = Number(dbStatusRows.find((row) => row.sendStatus === "failed")?._count._all ?? 0);
        const dbSkippedRecipients = Number(dbStatusRows.find((row) => row.sendStatus === "skipped")?._count._all ?? 0);
        const warmupRows = smtpPool.length
          ? await prisma.smtpWarmupStat.groupBy({
              by: ["smtpAccountId"],
              where: { smtpAccountId: { in: smtpPool.map((item: any) => item.id) } },
              _sum: { successfulDeliveries: true }
            })
          : [];
        const warmupMap = new Map<string, number>(
          warmupRows.map((row: any) => [String(row.smtpAccountId), Number(row._sum?.successfulDeliveries ?? 0)])
        );
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
        const targetSummary = ((targetSummaryRow?.value as any) ?? {}) as {
          targetTotalRps?: number;
          globalRps?: number;
          dailyTarget?: number;
          usableSmtpCount?: number;
          targetPerSmtpRps?: number;
        };
        const schedulerDiag = ((schedulerDiagRow?.value as any) ?? {}) as {
          dbPendingRecipients?: number;
          dbQueuedRecipients?: number;
          dbProcessingRecipients?: number;
          dbSentRecipients?: number;
          dbFailedRecipients?: number;
          dbSkippedRecipients?: number;
          redisWaitingJobs?: number;
          redisActiveJobs?: number;
          redisDelayedJobs?: number;
          redisFailedJobs?: number;
          schedulerBatchSize?: number;
          requiredBuffer?: number;
          lastSchedulerEnqueued?: number;
          lastSchedulerReason?: string;
        };
        const targetTotalRps = Number(targetSummary.targetTotalRps ?? targetSummary.globalRps ?? 0);
        const activeLaneCount = activeSmtpIds.length;
        const throttledCount = smtpPool.filter((smtp: any) => smtp.isThrottled).length;
        const eligiblePool = smtpPool.filter((smtp: any) => smtpEligibilityReason(smtp) === null);
        const healthyCount = eligiblePool.length;
        const alibabaSafeCap = Math.max(1, Number(process.env.ALIBABA_PROVIDER_SAFE_MAX_RPS ?? 15));
        const defaultProviderSafeCap = Math.max(1, Number(process.env.SMTP_DEFAULT_PROVIDER_SAFE_MAX_RPS ?? 5));
        const targetPerSmtpRps = Number(targetSummary.targetPerSmtpRps ?? (healthyCount > 0 ? targetTotalRps / healthyCount : 0));
        let warmupCapTotalRps = 0;
        let providerCapTotalRps = 0;
        let throttleCapTotalRps = 0;
        let warmupCappedCount = 0;
        for (const smtp of eligiblePool) {
          const providerCap = isAlibabaProvider(smtp.providerLabel, smtp.host) ? alibabaSafeCap : defaultProviderSafeCap;
          const desired = Math.max(0.01, Math.min(Number(smtp.maxRatePerSecond ?? smtp.targetRatePerSecond ?? 1), providerCap, targetPerSmtpRps || providerCap));
          providerCapTotalRps += desired;
          const warmupRate = computeWarmupRate(smtp, Number(warmupMap.get(smtp.id) ?? 0), desired);
          warmupCapTotalRps += warmupRate;
          if (warmupRate + 0.0001 < desired) {
            warmupCappedCount += 1;
          }
          const throttledRate = smtp.isThrottled ? Math.max(0.01, warmupRate * 0.5) : warmupRate;
          throttleCapTotalRps += throttledRate;
        }
        let bottleneckReason = "none";
        const queueWaiting = Number(queueObs.deliveryCounts?.waiting ?? queueObs.deliveryCounts?.wait ?? 0);
        const redisWaitingJobs = Number(schedulerDiag.redisWaitingJobs ?? queueWaiting);
        const redisActiveJobs = Number(schedulerDiag.redisActiveJobs ?? queueObs.deliveryCounts?.active ?? 0);
        const redisDelayedJobs = Number(schedulerDiag.redisDelayedJobs ?? queueObs.deliveryCounts?.delayed ?? 0);
        const redisFailedJobs = Number(schedulerDiag.redisFailedJobs ?? queueObs.deliveryCounts?.failed ?? 0);
        const effectiveDbPendingRecipients = Number(schedulerDiag.dbPendingRecipients ?? dbPendingRecipients ?? 0);
        const effectiveDbQueuedRecipients = Number(schedulerDiag.dbQueuedRecipients ?? dbQueuedRecipients ?? 0);
        const effectiveDbProcessingRecipients = Number(schedulerDiag.dbProcessingRecipients ?? dbProcessingRecipients ?? effectiveDbQueuedRecipients);
        const effectiveDbSentRecipients = Number(schedulerDiag.dbSentRecipients ?? dbSentRecipients ?? 0);
        const effectiveDbFailedRecipients = Number(schedulerDiag.dbFailedRecipients ?? dbFailedRecipients ?? 0);
        const effectiveDbSkippedRecipients = Number(schedulerDiag.dbSkippedRecipients ?? dbSkippedRecipients ?? 0);
        const requiredBuffer = Math.max(
          Number(schedulerDiag.schedulerBatchSize ?? 0),
          Number(schedulerDiag.requiredBuffer ?? Math.ceil(Math.max(0, targetTotalRps) * 120))
        );
        const currentBuffer = redisWaitingJobs + redisActiveJobs + redisDelayedJobs;
        const workerConcurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY || 50));
        if (effectiveDbPendingRecipients <= 0 && effectiveDbQueuedRecipients <= 0 && redisWaitingJobs <= 0 && redisActiveJobs <= 0 && redisDelayedJobs <= 0) bottleneckReason = "queue_empty";
        else if (effectiveDbPendingRecipients > 0 && currentBuffer < requiredBuffer) bottleneckReason = "scheduler_underfeeding";
        else if (redisWaitingJobs > 0 && redisActiveJobs < Math.max(1, Math.floor(workerConcurrency * 0.5))) bottleneckReason = "worker_not_consuming";
        else if (healthyCount < 2) bottleneckReason = "too_few_eligible_smtps";
        else if (throttledCount > 0) bottleneckReason = "throttle";
        else if (warmupCappedCount > 0) bottleneckReason = "warmup_cap";
        const effectivePoolRps = throttleCapTotalRps > 0 ? throttleCapTotalRps : warmupCapTotalRps;
        if (targetTotalRps > 0 && effectivePoolRps < targetTotalRps * 0.8 && bottleneckReason === "none") {
          bottleneckReason = redisActiveJobs >= Math.max(1, Math.floor(workerConcurrency * 0.8)) ? "rate_limiter_or_smtp" : "worker_not_consuming";
        }
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
            currentRate: Number(effectivePoolRps.toFixed(4)),
            effectiveRate: Number(effectivePoolRps.toFixed(4)),
            targetTotalRps,
            dailyTarget: Number(targetSummary.dailyTarget ?? 0),
            throttleReason: campaign.throttleReason,
            warmupTier: warmupCappedCount > 0 ? "warmup_cap" : undefined,
            warmupNextTier: undefined,
            activeSmtps: smtpPool.filter((smtp: any) => !smtp.isThrottled).map((smtp: any) => ({
              id: smtp.id,
              name: smtp.name
            })),
            currentRotation,
            activeLaneCount,
            throttledSmtpCount: throttledCount,
            eligibleSmtpCount: healthyCount,
            targetPerSmtpRps: Number(targetPerSmtpRps.toFixed(4)),
            avgPerSmtpRps: healthyCount > 0 ? Number((effectivePoolRps / healthyCount).toFixed(3)) : 0,
            warmupCapTotalRps: Number(warmupCapTotalRps.toFixed(4)),
            throttleCapTotalRps: Number(throttleCapTotalRps.toFixed(4)),
            providerCapTotalRps: Number(providerCapTotalRps.toFixed(4)),
            warmupBottleneckSmtpCount: warmupCappedCount,
            warmupAvgCapRps: warmupCappedCount > 0 ? Number((warmupCapTotalRps / Math.max(1, healthyCount)).toFixed(4)) : 0,
            expectedRpsAfterApply: Number(providerCapTotalRps.toFixed(4)),
            dbPendingRecipients: effectiveDbPendingRecipients,
            dbQueuedRecipients: effectiveDbQueuedRecipients,
            dbProcessingRecipients: effectiveDbProcessingRecipients,
            dbSentRecipients: effectiveDbSentRecipients,
            dbFailedRecipients: effectiveDbFailedRecipients,
            dbSkippedRecipients: effectiveDbSkippedRecipients,
            redisWaitingJobs,
            redisActiveJobs,
            redisDelayedJobs,
            redisFailedJobs,
            schedulerBatchSize: Number(schedulerDiag.schedulerBatchSize ?? 0),
            requiredBuffer,
            lastSchedulerEnqueued: Number(schedulerDiag.lastSchedulerEnqueued ?? 0),
            lastSchedulerReason: String(schedulerDiag.lastSchedulerReason ?? "unknown"),
            bottleneckReason,
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
