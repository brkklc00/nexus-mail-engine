import { NextResponse } from "next/server";
import { prisma } from "@nexus/db";
import { deliveryQueue, retryQueue } from "@nexus/queue";
import { getSession } from "@/server/auth/session";

function startOfToday() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

function oneMinuteAgo() {
  return new Date(Date.now() - 60_000);
}

function maskEmail(email: string | null | undefined): string {
  if (!email) return "-";
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const visible = local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

type WarmupRow = {
  smtpAccountId: string;
  successfulDeliveries: number | null;
  failedDeliveries: number | null;
  updatedAt: Date | null;
};

type ActiveSmtpRow = {
  id: string;
  fromEmail: string | null;
  isThrottled: boolean | null;
  healthStatus: string | null;
  host: string;
  providerLabel: string | null;
  isActive: boolean;
  isSoftDeleted: boolean;
  cooldownUntil: Date | null;
  throttleReason: string | null;
  lastError: string | null;
  username: string;
  passwordEncrypted: string;
  port: number;
  targetRatePerSecond: number;
  maxRatePerSecond: number | null;
  warmupEnabled: boolean;
  warmupStartRps: number;
  warmupIncrementStep: number;
  warmupMaxRps: number | null;
  alibabaRateCap: number | null;
  alibabaWarmupMaxRatePerSecond: number | null;
};

type RecentLogRow = {
  createdAt: Date;
  eventType: string;
  status: string;
  message: string | null;
  metadata: unknown;
  campaign: {
    name: string;
    smtpAccount: { fromEmail: string | null } | null;
  } | null;
  recipient: { email: string | null } | null;
};

const RECENT_EVENTS_LIMIT = 20;
const SMTP_ACTIVITY_LIMIT = 20;
const HUGE_QUEUE_THRESHOLD = 100_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export async function GET() {
  const startedAt = Date.now();
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  function isAlibabaProvider(providerLabel: string | null | undefined, host: string | null | undefined) {
    const provider = String(providerLabel ?? "").toLowerCase();
    const smtpHost = String(host ?? "").toLowerCase();
    return provider.includes("alibaba") || provider.includes("aliyun") || smtpHost.includes("smtpdm");
  }
  function smtpEligibilityReason(smtp: ActiveSmtpRow): string | null {
    if (!smtp.isActive) return "disabled";
    if (smtp.isSoftDeleted) return "archived";
    if (!smtp.host || !smtp.port || !smtp.username || !smtp.fromEmail || !smtp.passwordEncrypted) return "missing_credentials";
    const authText = `${smtp.healthStatus ?? ""} ${smtp.throttleReason ?? ""} ${smtp.lastError ?? ""}`.toLowerCase();
    if (authText.includes("auth_failed") || authText.includes("authentication") || authText.includes("invalid credentials")) return "auth_failed";
    if (smtp.healthStatus === "error") return "unhealthy";
    if (smtp.isThrottled && smtp.cooldownUntil && smtp.cooldownUntil.getTime() > Date.now()) return "throttled";
    return null;
  }
  function computeWarmupRate(smtp: ActiveSmtpRow, delivered: number, desiredRps: number) {
    if (!smtp.warmupEnabled) return desiredRps;
    const maxWarmup = Math.max(
      Number(smtp.warmupMaxRps ?? 0),
      Number(smtp.alibabaWarmupMaxRatePerSecond ?? 0),
      Number(smtp.targetRatePerSecond ?? 0)
    );
    const progressRate = Number(smtp.warmupStartRps ?? 1) + Math.floor(delivered / 1000) * Number(smtp.warmupIncrementStep ?? 1);
    return Math.min(desiredRps, Math.max(0.01, Math.min(maxWarmup || desiredRps, progressRate)));
  }

  const dayStart = startOfToday();
  const minuteAgo = oneMinuteAgo();
  try {
    const [deliveryCounts, retryCounts, activeCampaigns, sentLastMinute, failedLastMinute, activeSmtps, recentLogs] =
      await withTimeout(
        Promise.all([
          deliveryQueue.getJobCounts(),
          retryQueue.getJobCounts(),
          prisma.campaign.count({ where: { status: { in: ["queued", "running"] } } }),
          prisma.campaignLog.count({
            where: {
              eventType: "sent",
              createdAt: { gte: minuteAgo }
            }
          }),
          prisma.campaignLog.count({
            where: {
              status: "failed",
              createdAt: { gte: minuteAgo }
            }
          }),
          prisma.smtpAccount.findMany({
            where: { isActive: true, isSoftDeleted: false },
            orderBy: { updatedAt: "desc" },
            take: SMTP_ACTIVITY_LIMIT,
            select: {
              id: true,
              fromEmail: true,
              isThrottled: true,
              healthStatus: true,
              host: true,
              providerLabel: true,
              isActive: true,
              isSoftDeleted: true,
              cooldownUntil: true,
              throttleReason: true,
              lastError: true,
              username: true,
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
          prisma.campaignLog.findMany({
            where: {
              OR: [{ eventType: "sent" }, { status: "failed" }]
            },
            orderBy: { createdAt: "desc" },
            take: RECENT_EVENTS_LIMIT,
            select: {
              createdAt: true,
              eventType: true,
              status: true,
              message: true,
              metadata: true,
              campaign: {
                select: {
                  name: true,
                  smtpAccount: { select: { fromEmail: true } }
                }
              },
              recipient: { select: { email: true } }
            }
          })
        ]),
        3000
      );

    const [dailySummaryRow, workerSnapshotRow, schedulerDiagRow, dbStatusRowsRaw] = await Promise.all([
      prisma.appSetting.findUnique({ where: { key: "smtp_daily_target_summary" } }).catch(() => null),
      prisma.appSetting.findUnique({ where: { key: "smtp_pool_settings" } }).catch(() => null),
      prisma.appSetting.findUnique({ where: { key: "scheduler_runtime_diagnostics" } }).catch(() => null),
      prisma.campaignRecipient.groupBy({
        by: ["sendStatus"],
        where: {
          campaign: {
            status: { in: ["running", "queued", "partially_completed"] },
            isDeleted: false
          }
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

    const smtpIds = (activeSmtps as ActiveSmtpRow[]).map((smtp) => smtp.id);
    const warmupRows = smtpIds.length
      ? ((await prisma.smtpWarmupStat
          .findMany({
            where: { date: { gte: dayStart }, smtpAccountId: { in: smtpIds } },
            select: {
              smtpAccountId: true,
              successfulDeliveries: true,
              failedDeliveries: true,
              updatedAt: true
            },
            take: SMTP_ACTIVITY_LIMIT
          })
          .catch((error: unknown) => {
            console.warn("[smtp.live-flow] warmup query skipped", {
              message: error instanceof Error ? error.message : String(error)
            });
            return [];
          })) as WarmupRow[])
      : [];

    const warmupMap = new Map<
      string,
      { successfulDeliveries: number; failedDeliveries: number; updatedAt: string | null }
    >(
      warmupRows.map((row) => [
        row.smtpAccountId,
        {
          successfulDeliveries: Number(row.successfulDeliveries ?? 0),
          failedDeliveries: Number(row.failedDeliveries ?? 0),
          updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null
        }
      ])
    );

    const smtpActivity = (activeSmtps as ActiveSmtpRow[]).map((smtp) => {
      const warm = warmupMap.get(smtp.id);
      const status =
        smtp.healthStatus === "error" ? "unhealthy" : smtp.isThrottled ? "throttled" : "active";
      return {
        smtpId: smtp.id,
        fromEmail: smtp.fromEmail,
        status,
        sentToday: Number(warm?.successfulDeliveries ?? 0),
        failedToday: Number(warm?.failedDeliveries ?? 0),
        currentRps: Number((sentLastMinute / 60).toFixed(3)),
        lastUsedAt: warm?.updatedAt ?? null
      };
    });

    const smtpById = new Map((activeSmtps as ActiveSmtpRow[]).map((smtp) => [smtp.id, smtp.fromEmail]));
    const recentEvents = (recentLogs as RecentLogRow[]).map((log) => {
      const metadata = (log.metadata ?? {}) as { smtpAccountId?: string };
      const smtpFromEmail =
        smtpById.get(String(metadata.smtpAccountId ?? "")) ??
        log.campaign?.smtpAccount?.fromEmail ??
        "-";
      const isSuccess = log.eventType === "sent" && log.status !== "failed";
      return {
        time: log.createdAt.toISOString(),
        campaignName: log.campaign?.name ?? "Campaign",
        smtpFromEmail,
        recipientEmail: maskEmail(log.recipient?.email),
        status: isSuccess ? "success" : "failed",
        error: isSuccess ? null : log.message ?? "delivery_failed"
      };
    });

    const queuePending =
      Number(deliveryCounts.waiting ?? deliveryCounts.wait ?? 0) +
      Number(retryCounts.waiting ?? retryCounts.wait ?? 0);
    const queueProcessing = Number(deliveryCounts.active ?? 0) + Number(retryCounts.active ?? 0);
    const currentRps = Number((sentLastMinute / 60).toFixed(3));
    const queueHuge = queuePending >= HUGE_QUEUE_THRESHOLD;
    const dailySummary = ((dailySummaryRow?.value as any) ?? {}) as {
      dailyTarget?: number;
      targetTotalRps?: number;
      globalRps?: number;
      usableSmtpCount?: number;
      targetPerSmtpRps?: number;
    };
    const targetTotalRps = Number(dailySummary.targetTotalRps ?? dailySummary.globalRps ?? 0);
    const targetPerSmtpRps = Number(dailySummary.targetPerSmtpRps ?? 0);
    const eligiblePool = (activeSmtps as ActiveSmtpRow[]).filter((item) => smtpEligibilityReason(item) === null);
    const usableSmtpCount = Number(dailySummary.usableSmtpCount ?? eligiblePool.length);
    const throttledCount = (activeSmtps as ActiveSmtpRow[]).filter((item) => item.isThrottled).length;
    const alibabaSafeCap = Math.max(1, Number(process.env.ALIBABA_PROVIDER_SAFE_MAX_RPS ?? 15));
    const defaultProviderSafeCap = Math.max(1, Number(process.env.SMTP_DEFAULT_PROVIDER_SAFE_MAX_RPS ?? 5));
    let warmupCapTotalRps = 0;
    let providerCapTotalRps = 0;
    let throttleCapTotalRps = 0;
    let warmupCappedCount = 0;
    for (const smtp of eligiblePool) {
      const delivered = Number(warmupMap.get(smtp.id)?.successfulDeliveries ?? 0);
      const providerCap = isAlibabaProvider(smtp.providerLabel, smtp.host) ? alibabaSafeCap : defaultProviderSafeCap;
      const desired = Math.max(
        0.01,
        Math.min(
          Number(smtp.maxRatePerSecond ?? smtp.targetRatePerSecond ?? 1),
          providerCap,
          targetPerSmtpRps > 0 ? targetPerSmtpRps : providerCap
        )
      );
      providerCapTotalRps += desired;
      const warmupRate = computeWarmupRate(smtp, delivered, desired);
      warmupCapTotalRps += warmupRate;
      if (warmupRate + 0.0001 < desired) warmupCappedCount += 1;
      throttleCapTotalRps += smtp.isThrottled ? Math.max(0.01, warmupRate * 0.5) : warmupRate;
    }
    const schedulerDiag = ((schedulerDiagRow?.value as any) ?? {}) as {
      dbPendingRecipients?: number;
      dbQueuedRecipients?: number;
      dbProcessingRecipients?: number;
      dbSentRecipients?: number;
      dbFailedRecipients?: number;
      dbSkippedRecipients?: number;
      redisWaitingJobs?: number;
      redisActiveJobs?: number;
      schedulerBatchSize?: number;
      requiredBuffer?: number;
      lastSchedulerEnqueued?: number;
      lastSchedulerReason?: string;
      targetRps?: number;
    };
    const redisWaitingJobs =
      Number(schedulerDiag.redisWaitingJobs ?? 0) ||
      (Number(deliveryCounts.waiting ?? deliveryCounts.wait ?? 0) + Number(retryCounts.waiting ?? retryCounts.wait ?? 0));
    const redisActiveJobs =
      Number(schedulerDiag.redisActiveJobs ?? 0) ||
      (Number(deliveryCounts.active ?? 0) + Number(retryCounts.active ?? 0));
    const effectiveDbPendingRecipients = Number(schedulerDiag.dbPendingRecipients ?? dbPendingRecipients ?? 0);
    const effectiveDbQueuedRecipients = Number(schedulerDiag.dbQueuedRecipients ?? dbQueuedRecipients ?? 0);
    const effectiveDbProcessingRecipients = Number(schedulerDiag.dbProcessingRecipients ?? dbProcessingRecipients ?? effectiveDbQueuedRecipients);
    const effectiveDbSentRecipients = Number(schedulerDiag.dbSentRecipients ?? dbSentRecipients ?? 0);
    const effectiveDbFailedRecipients = Number(schedulerDiag.dbFailedRecipients ?? dbFailedRecipients ?? 0);
    const effectiveDbSkippedRecipients = Number(schedulerDiag.dbSkippedRecipients ?? dbSkippedRecipients ?? 0);
    const requiredBuffer = Math.max(
      Number(schedulerDiag.schedulerBatchSize ?? 0),
      Number(schedulerDiag.requiredBuffer ?? Math.ceil(Math.max(0, targetTotalRps) * 60))
    );
    let bottleneckReason = "none";
    if (effectiveDbPendingRecipients <= 0 && effectiveDbQueuedRecipients <= 0 && redisWaitingJobs <= 0 && redisActiveJobs <= 1) bottleneckReason = "queue_empty";
    else if (effectiveDbPendingRecipients > 0 && redisWaitingJobs <= 1) bottleneckReason = "scheduler_underfeeding";
    else if (usableSmtpCount > 0 && usableSmtpCount < 2) bottleneckReason = "too_few_eligible_smtps";
    else if (throttledCount > 0) bottleneckReason = "throttle";
    else if (warmupCappedCount > 0) bottleneckReason = "warmup_cap";
    else if (queueHuge) bottleneckReason = "db_slow";
    if (targetTotalRps > 0 && currentRps < targetTotalRps * 0.8 && bottleneckReason === "none") {
      bottleneckReason = "worker_concurrency";
    }

    console.info("[smtp.live-flow] completed", { ms: Date.now() - startedAt });

    return NextResponse.json({
      ok: true,
      metrics: {
        currentRps,
        targetTotalRps,
        sentLastMinute,
        failedLastMinute,
        queuePending,
        queueProcessing,
        activeCampaigns
      },
      queueCounts: {
        delivery: deliveryCounts,
        retry: retryCounts
      },
      queueHuge,
      diagnostics: {
        dailyTarget: Number(dailySummary.dailyTarget ?? 0),
        eligibleSmtp: usableSmtpCount,
        activeLane: Math.max(0, usableSmtpCount - throttledCount),
        throttledSmtp: throttledCount,
        warmupCappedSmtp: warmupCappedCount,
        warmupCapTotalRps: Number(warmupCapTotalRps.toFixed(4)),
        throttleCapTotalRps: Number(throttleCapTotalRps.toFixed(4)),
        providerCapTotalRps: Number(providerCapTotalRps.toFixed(4)),
        warmupPoolCapacityDaily: Math.floor(warmupCapTotalRps * 86400),
        warmupBottleneckSmtpCount: warmupCappedCount,
        expectedRpsAfterApply: Number(providerCapTotalRps.toFixed(4)),
        targetPerSmtpRps: Number(targetPerSmtpRps.toFixed(4)),
        avgPerSmtpRps: usableSmtpCount > 0 ? Number((currentRps / usableSmtpCount).toFixed(3)) : 0,
        workerConcurrency: Number(process.env.WORKER_CONCURRENCY ?? 0),
        dbPendingRecipients: effectiveDbPendingRecipients,
        dbQueuedRecipients: effectiveDbQueuedRecipients,
        dbProcessingRecipients: effectiveDbProcessingRecipients,
        dbSentRecipients: effectiveDbSentRecipients,
        dbFailedRecipients: effectiveDbFailedRecipients,
        dbSkippedRecipients: effectiveDbSkippedRecipients,
        redisWaitingJobs,
        redisActiveJobs,
        schedulerBatchSize: Number(schedulerDiag.schedulerBatchSize ?? 0),
        requiredBuffer,
        lastSchedulerEnqueued: Number(schedulerDiag.lastSchedulerEnqueued ?? 0),
        lastSchedulerReason: String(schedulerDiag.lastSchedulerReason ?? "unknown"),
        bottleneckReason
      },
      smtpActivity,
      recentEvents
    });
  } catch (error) {
    console.warn("[dashboard.widget] slow", { widget: "smtp_live_flow", ms: Date.now() - startedAt });
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Yüklenemedi",
      metrics: {
        currentRps: 0,
        sentLastMinute: 0,
        failedLastMinute: 0,
        queuePending: 0,
        queueProcessing: 0,
        activeCampaigns: 0
      },
      queueHuge: false,
      smtpActivity: [],
      recentEvents: []
    });
  }
}
