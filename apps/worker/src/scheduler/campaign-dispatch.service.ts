import crypto from "node:crypto";
import { prisma } from "@nexus/db";
import { deliveryQueue, retryQueue, safeJobId, withDistributedLock } from "@nexus/queue";
import { FairCampaignScheduler } from "./fair-scheduler.js";
import { transitionCampaignRecipientStatus } from "../state/campaign-recipient-state.service.js";
import { safeCreateCampaignLog } from "../logging/safe-campaign-log.js";

const scheduler = new FairCampaignScheduler();
const WORKER_DB_READ_CONCURRENCY = Math.max(1, Math.min(5, Number(process.env.WORKER_DB_READ_CONCURRENCY ?? 2)));
const WORKER_SETTINGS_CACHE_MS = Math.max(1_000, Number(process.env.WORKER_SETTINGS_CACHE_MS ?? 30_000));
const WORKER_SMTP_CACHE_MS = Math.max(1_000, Number(process.env.WORKER_SMTP_CACHE_MS ?? 30_000));
const WORKER_CAMPAIGN_CACHE_MS = Math.max(1_000, Number(process.env.WORKER_CAMPAIGN_CACHE_MS ?? 10_000));
const WORKER_WARMUP_CACHE_MS = Math.max(1_000, Number(process.env.WORKER_WARMUP_CACHE_MS ?? 3_000));
const SMTP_LANE_MAX_INFLIGHT = Math.max(1, Number(process.env.SMTP_LANE_MAX_INFLIGHT ?? 2));
const SMTP_RATE_CACHE_MS = Math.max(500, Number(process.env.SMTP_RATE_CACHE_MS ?? 3000));
const SMTP_THROTTLE_EXPIRE_CHECK_MS = Math.max(5_000, Number(process.env.SMTP_THROTTLE_EXPIRE_CHECK_MS ?? 30_000));
const SCHEDULER_DIAGNOSTICS_WRITE_MS = Math.max(3_000, Number(process.env.SCHEDULER_DIAGNOSTICS_WRITE_MS ?? 5_000));
const SCHEDULER_MIN_BUFFER_SECONDS = Math.max(10, Number(process.env.SCHEDULER_MIN_BUFFER_SECONDS ?? 120));
const SCHEDULER_MAX_ENQUEUE_PER_TICK = Math.max(100, Number(process.env.SCHEDULER_MAX_ENQUEUE_PER_TICK ?? 10_000));
const SCHEDULER_FEED_LOG_MS = Math.max(2_000, Number(process.env.SCHEDULER_FEED_LOG_MS ?? 10_000));
let schedulerReadInFlight = 0;
const schedulerReadQueue: Array<() => void> = [];

let cachedPoolSettings: {
  skipThrottled: boolean;
  skipUnhealthy: boolean;
  perSmtpConcurrency: number;
  expiresAt: number;
} | null = null;
let cachedActiveCampaigns: { data: any[]; expiresAt: number } | null = null;
let cachedSmtpState: { data: any[]; expiresAt: number; key: string } | null = null;
let cachedWarmupState: { data: any[]; expiresAt: number; key: string } | null = null;
let lastRuntimeCacheBustTs = 0;
let lastRuntimeCacheBustReadAt = 0;
let lastThrottleExpireSweepAt = 0;
let lastDiagnosticsWriteAt = 0;
let lastSchedulerFeedLogAt = 0;

export type SchedulerDispatchResult = {
  dispatched: number;
  backfilled: number;
  dbPendingRecipients: number;
  dbQueuedRecipients: number;
  dbProcessingRecipients: number;
  dbSentRecipients: number;
  dbFailedRecipients: number;
  dbSkippedRecipients: number;
  redisWaitingJobs: number;
  redisActiveJobs: number;
  redisDelayedJobs: number;
  redisFailedJobs: number;
  schedulerBatchSize: number;
  requiredBuffer: number;
  lastSchedulerEnqueued: number;
  lastSchedulerReason: string;
  targetRps: number;
};

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

async function withSchedulerReadSlot<T>(task: () => Promise<T>): Promise<T> {
  if (schedulerReadInFlight >= WORKER_DB_READ_CONCURRENCY) {
    await new Promise<void>((resolve) => schedulerReadQueue.push(resolve));
  }
  schedulerReadInFlight += 1;
  try {
    return await task();
  } finally {
    schedulerReadInFlight = Math.max(0, schedulerReadInFlight - 1);
    const next = schedulerReadQueue.shift();
    if (next) next();
  }
}

async function getCachedPoolSettings() {
  const now = Date.now();
  if (cachedPoolSettings && cachedPoolSettings.expiresAt > now) {
    return cachedPoolSettings;
  }
  const row = (await withSchedulerReadSlot(() =>
    prisma.appSetting.findUnique({ where: { key: "smtp_pool_settings" } }).catch(() => null)
  )) as { value?: unknown } | null;
  const settings = ((row?.value as any) ?? {}) as {
    skipThrottled?: boolean;
    skipUnhealthy?: boolean;
    perSmtpConcurrency?: number;
  };
  cachedPoolSettings = {
    skipThrottled: settings.skipThrottled ?? true,
    skipUnhealthy: settings.skipUnhealthy ?? true,
    perSmtpConcurrency: Math.max(1, Number(settings.perSmtpConcurrency ?? 1)),
    expiresAt: now + WORKER_SETTINGS_CACHE_MS
  };
  return cachedPoolSettings;
}

function campaignCacheClone(rows: any[]) {
  return rows.map((row) => ({
    ...row,
    recipients: Array.isArray(row.recipients)
      ? row.recipients.map((recipient: any) => ({ ...recipient }))
      : []
  }));
}

function idempotencyKey(campaignId: string, recipientId: string, templateVersion: number): string {
  return crypto
    .createHash("sha256")
    .update(`${campaignId}:${recipientId}:${templateVersion}`)
    .digest("hex");
}

export async function dispatchFairBatch(maxJobs = 100): Promise<SchedulerDispatchResult> {
  const nowForCacheBust = Date.now();
  if (nowForCacheBust - lastRuntimeCacheBustReadAt >= 3_000) {
    lastRuntimeCacheBustReadAt = nowForCacheBust;
    const bust = (await withSchedulerReadSlot(() =>
      prisma.appSetting.findUnique({ where: { key: "smtp_runtime_cache_bust" } }).catch(() => null)
    )) as { value?: unknown } | null;
    const bustTs = Number(((bust?.value as any) ?? {}).ts ?? 0);
    if (Number.isFinite(bustTs) && bustTs > lastRuntimeCacheBustTs) {
      lastRuntimeCacheBustTs = bustTs;
      cachedPoolSettings = null;
      cachedActiveCampaigns = null;
      cachedSmtpState = null;
      cachedWarmupState = null;
    }
  }
  const nowForSweep = Date.now();
  if (nowForSweep - lastThrottleExpireSweepAt >= SMTP_THROTTLE_EXPIRE_CHECK_MS) {
    lastThrottleExpireSweepAt = nowForSweep;
    await withSchedulerReadSlot(() =>
      prisma.smtpAccount
        .updateMany({
          where: {
            isThrottled: true,
            cooldownUntil: { lte: new Date() }
          },
          data: {
            isThrottled: false,
            throttleReason: null,
            cooldownUntil: null
          }
        })
        .catch(() => ({ count: 0 }))
    );
  }

  const campaignTake = Math.max(1, Math.min(100, Number(process.env.SCHEDULER_CAMPAIGN_TAKE ?? 20)));
  const initialRecipientsTakePerCampaign = Math.max(20, Math.min(maxJobs, Number(process.env.SCHEDULER_RECIPIENTS_TAKE_PER_CAMPAIGN ?? 200)));
  const nowMs = Date.now();
  const campaignRows = cachedActiveCampaigns && cachedActiveCampaigns.expiresAt > nowMs
    ? cachedActiveCampaigns.data
    : ((await withSchedulerReadSlot(() => prisma.campaign.findMany({
    where: {
      OR: [
        { status: "running" },
        {
          status: "queued",
          OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }]
        }
      ]
    },
    select: {
      id: true,
      status: true,
      startedAt: true,
      smtpAccountId: true,
      smtpPoolConfig: true,
      templateId: true,
      provider: true,
      template: {
        select: {
          version: true
        }
      }
    },
    orderBy: [{ createdAt: "asc" }],
    take: campaignTake
  }))) as any[]);
  if (!cachedActiveCampaigns || cachedActiveCampaigns.expiresAt <= nowMs) {
    cachedActiveCampaigns = {
      data: campaignRows,
      expiresAt: nowMs + WORKER_CAMPAIGN_CACHE_MS
    };
  }
  const activeCampaigns = campaignCacheClone(campaignRows);
  const targetTotalRpsAllCampaigns = Number(
    activeCampaigns.reduce((sum: number, campaign: any) => {
      const cfg = ((campaign.smtpPoolConfig as any) ?? {}) as { targetTotalRps?: number };
      return sum + Number(cfg.targetTotalRps ?? 0);
    }, 0).toFixed(4)
  );
  const laneCount = Math.max(1, activeCampaigns.length);
  const scaledTargetBatch = Math.max(0, Math.ceil(targetTotalRpsAllCampaigns * SCHEDULER_MIN_BUFFER_SECONDS));
  const scaledLaneBatch = Math.max(0, laneCount * SMTP_LANE_MAX_INFLIGHT * 50);
  const requiredBuffer = Math.max(maxJobs, scaledTargetBatch);
  const computedBatch = Math.max(requiredBuffer, scaledLaneBatch);
  const schedulerBatchSize = Math.max(50, Math.min(10_000, computedBatch));
  const recipientsTakePerCampaign = Math.max(initialRecipientsTakePerCampaign, Math.min(schedulerBatchSize, Number(process.env.SCHEDULER_RECIPIENTS_TAKE_PER_CAMPAIGN ?? 200)));

  for (const campaign of activeCampaigns) {
    const rows = (await withSchedulerReadSlot(() =>
      prisma.campaignRecipient.findMany({
        where: { campaignId: campaign.id, sendStatus: "pending" },
        take: recipientsTakePerCampaign,
        select: { recipientId: true, smtpAccountId: true }
      })
    )) as any[];
    campaign.recipients = rows;
  }

  const slots = activeCampaigns.map((campaign: any) => ({
    campaignId: campaign.id,
    smtpAccountId: campaign.smtpAccountId,
    provider: campaign.provider,
    remaining: campaign.recipients.length,
    priority: 1
  }));

  const requestedJobs = Math.max(schedulerBatchSize, slots.length * SMTP_LANE_MAX_INFLIGHT * 5);
  const picks = scheduler.nextBatch(slots, requestedJobs);
  let dispatched = 0;
  let backfilled = 0;

  const smtpIds = Array.from(
    new Set(
      activeCampaigns.flatMap((campaign: any) => {
        const fromConfig = Array.isArray((campaign.smtpPoolConfig as any)?.smtpIds)
          ? (((campaign as any).smtpPoolConfig as any).smtpIds as string[])
          : [];
        return [campaign.smtpAccountId, ...fromConfig];
      })
    )
  );
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const smtpCacheKey = smtpIds.slice().sort().join(",");
  const smtpAccounts = smtpIds.length === 0
    ? []
    : cachedSmtpState && cachedSmtpState.expiresAt > nowMs && cachedSmtpState.key === smtpCacheKey
      ? cachedSmtpState.data
      : (await withSchedulerReadSlot(() => prisma.smtpAccount.findMany({
          where: { id: { in: smtpIds }, isActive: true, isSoftDeleted: false },
          select: {
            id: true,
            isActive: true,
            isSoftDeleted: true,
            isThrottled: true,
            throttleReason: true,
            healthStatus: true,
            lastError: true,
            targetRatePerSecond: true,
            maxRatePerSecond: true,
            warmupEnabled: true,
            warmupStartRps: true,
            warmupIncrementStep: true,
            warmupMaxRps: true,
            cooldownUntil: true,
            host: true,
            port: true,
            username: true,
            fromEmail: true,
            passwordEncrypted: true
          }
        }))) as any[];
  if (smtpIds.length > 0 && (!cachedSmtpState || cachedSmtpState.expiresAt <= nowMs || cachedSmtpState.key !== smtpCacheKey)) {
    cachedSmtpState = {
      key: smtpCacheKey,
      data: smtpAccounts,
      expiresAt: nowMs + SMTP_RATE_CACHE_MS
    };
  }
  const warmupStats = smtpIds.length === 0
    ? []
    : cachedWarmupState && cachedWarmupState.expiresAt > nowMs && cachedWarmupState.key === smtpCacheKey
      ? cachedWarmupState.data
      : (await withSchedulerReadSlot(() => prisma.smtpWarmupStat.findMany({
          where: { smtpAccountId: { in: smtpIds }, date: { gte: today } },
          select: { smtpAccountId: true, successfulDeliveries: true, failedDeliveries: true }
        }))) as any[];
  if (smtpIds.length > 0 && (!cachedWarmupState || cachedWarmupState.expiresAt <= nowMs || cachedWarmupState.key !== smtpCacheKey)) {
    cachedWarmupState = {
      key: smtpCacheKey,
      data: warmupStats,
      expiresAt: nowMs + WORKER_WARMUP_CACHE_MS
    };
  }
  const poolSettings = await getCachedPoolSettings();
  const skipThrottled = poolSettings.skipThrottled;
  const skipUnhealthy = poolSettings.skipUnhealthy;
  const perSmtpConcurrency = Math.max(1, Number(poolSettings.perSmtpConcurrency ?? SMTP_LANE_MAX_INFLIGHT));
  const warmupMap = new Map<string, { smtpAccountId: string; successfulDeliveries: number; failedDeliveries: number }>(
    warmupStats.map((stat: any) => [
      stat.smtpAccountId as string,
      {
        smtpAccountId: stat.smtpAccountId as string,
        successfulDeliveries: Number(stat.successfulDeliveries ?? 0),
        failedDeliveries: Number(stat.failedDeliveries ?? 0)
      }
    ])
  );
  const now = Date.now();
  const smtpState = new Map<string, any>(
    smtpAccounts.map((smtp: any) => [smtp.id as string, smtp])
  );
  const smtpLaneUsage = new Map<string, number>();

  for (const pick of picks) {
    const campaign = activeCampaigns.find((c: any) => c.id === pick.campaignId);
    if (!campaign || campaign.recipients.length === 0) continue;

    try {
      await withDistributedLock(`lock:dispatch:${campaign.id}`, 2_000, async () => {
        if (campaign.status === "queued") {
          await prisma.campaign.updateMany({
            where: { id: campaign.id, status: "queued" },
            data: { status: "running", startedAt: campaign.startedAt ?? new Date() }
          });
          campaign.status = "running";
        }
        const nextRecipient = campaign.recipients.shift();
        if (!nextRecipient) return;
        const poolFromConfig = Array.isArray(((campaign as any).smtpPoolConfig as any)?.smtpIds)
          ? ((((campaign as any).smtpPoolConfig as any).smtpIds as string[]))
          : [];
        const strategy = (((campaign as any).smtpPoolConfig as any)?.strategy ?? "round_robin") as string;
        const activePool = [campaign.smtpAccountId, ...poolFromConfig]
          .filter((id: string, idx: number, arr: string[]) => arr.indexOf(id) === idx)
          .filter((id: string) => {
            const state = smtpState.get(id);
            if (!state) return false;
            const reason = smtpEligibilityReason(state);
            if (reason === "auth_failed" || reason === "missing_credentials" || reason === "archived" || reason === "disabled") return false;
            if (skipThrottled && reason === "throttled") return false;
            if (skipUnhealthy && reason === "unhealthy") return false;
            return true;
          });
        const preferredSmtp = nextRecipient.smtpAccountId || campaign.smtpAccountId;
        const roundRobin = activePool[dispatched % Math.max(1, activePool.length)];
        const leastUsed = [...activePool].sort((a, b) => {
          const aDelivered = Number(warmupMap.get(a)?.successfulDeliveries ?? 0);
          const bDelivered = Number(warmupMap.get(b)?.successfulDeliveries ?? 0);
          return aDelivered - bDelivered;
        })[0];
        const healthBased = [...activePool].sort((a, b) => {
          const aFailed = Number(warmupMap.get(a)?.failedDeliveries ?? 0);
          const bFailed = Number(warmupMap.get(b)?.failedDeliveries ?? 0);
          return aFailed - bFailed;
        })[0];
        const weightedPool = activePool.flatMap((id) => {
          const state = smtpState.get(id);
          const base = Number(state?.maxRatePerSecond ?? state?.targetRatePerSecond ?? 1);
          const effectiveRps = Math.max(
            0.1,
            state?.warmupEnabled
              ? Math.min(base, Number(state?.warmupMaxRps ?? base))
              : base
          );
          const weight = Math.max(1, Math.min(30, Math.round(effectiveRps * 2)));
          return Array.from({ length: weight }).map(() => id);
        });
        const weighted = weightedPool.length > 0 ? weightedPool[dispatched % weightedPool.length] : roundRobin;
        let selectedSmtp = preferredSmtp;
        if (!activePool.includes(selectedSmtp)) {
          if (strategy === "least_used") selectedSmtp = leastUsed;
          else if (strategy === "health_based") selectedSmtp = healthBased;
          else if (strategy === "warmup_weighted" || strategy === "weighted_warmup") selectedSmtp = weighted;
          else selectedSmtp = roundRobin;
        }
        if (!selectedSmtp) {
          await safeCreateCampaignLog({
            campaignId: campaign.id,
            recipientId: nextRecipient.recipientId,
            eventType: "dispatch_waiting_smtp",
            status: "skipped",
            message: "No active SMTP available in pool; dispatch delayed."
          });
          return;
        }
        const selectedSmtpState = smtpState.get(selectedSmtp);
        if (selectedSmtpState && smtpEligibilityReason(selectedSmtpState)) {
          return;
        }
        const currentUsage = smtpLaneUsage.get(selectedSmtp) ?? 0;
        if (currentUsage >= perSmtpConcurrency) {
          return;
        }
        smtpLaneUsage.set(selectedSmtp, currentUsage + 1);
        if (selectedSmtp !== nextRecipient.smtpAccountId) {
          await prisma.campaignRecipient.updateMany({
            where: {
              campaignId: campaign.id,
              recipientId: nextRecipient.recipientId,
              sendStatus: "pending"
            },
            data: {
              smtpAccountId: selectedSmtp
            }
          });
        }

        const claimed = await transitionCampaignRecipientStatus({
          campaignId: campaign.id,
          recipientId: nextRecipient.recipientId,
          to: "queued"
        });
        if (!claimed) {
          return;
        }

        try {
          await deliveryQueue.add(
            "deliver",
            {
              campaignId: campaign.id,
              recipientId: nextRecipient.recipientId,
              templateId: campaign.templateId,
              smtpAccountId: selectedSmtp,
              idempotencyKey: idempotencyKey(campaign.id, nextRecipient.recipientId, campaign.template.version),
              attempt: 1
            },
            {
              jobId: safeJobId(
                `delivery_${campaign.id}_${nextRecipient.recipientId}_${campaign.template.version}`
              )
            }
          );
          dispatched += 1;
        } catch (enqueueError) {
          await prisma.campaignRecipient
            .updateMany({
              where: {
                campaignId: campaign.id,
                recipientId: nextRecipient.recipientId,
                sendStatus: "queued"
              },
              data: {
                sendStatus: "pending"
              }
            })
            .catch(() => ({ count: 0 }));
          await safeCreateCampaignLog({
            campaignId: campaign.id,
            recipientId: nextRecipient.recipientId,
            eventType: "dispatch_enqueue_failed",
            status: "failed",
            message: enqueueError instanceof Error ? enqueueError.message : "delivery_enqueue_failed"
          });
          return;
        }
      });
    } catch (error) {
      if ((error as Error).message !== "lock_not_acquired") {
        throw error;
      }
    }
  }

  const campaignIds = activeCampaigns.map((item: any) => item.id);
  const [deliveryCounts, retryCounts, dbStatusRowsRaw] = await Promise.all([
    deliveryQueue.getJobCounts().catch(() => ({ waiting: 0, wait: 0, active: 0, delayed: 0, failed: 0 } as any)),
    retryQueue.getJobCounts().catch(() => ({ waiting: 0, wait: 0, active: 0, delayed: 0, failed: 0 } as any)),
    campaignIds.length > 0
      ? withSchedulerReadSlot(() =>
          prisma.campaignRecipient.groupBy({
            by: ["sendStatus"],
            where: {
              campaignId: { in: campaignIds }
            },
            _count: { _all: true }
          })
        )
      : Promise.resolve([])
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
  const redisWaitingJobs = Number(deliveryCounts.waiting ?? (deliveryCounts as any).wait ?? 0) + Number(retryCounts.waiting ?? (retryCounts as any).wait ?? 0);
  const redisActiveJobs = Number(deliveryCounts.active ?? 0) + Number(retryCounts.active ?? 0);
  const redisDelayedJobs = Number(deliveryCounts.delayed ?? 0) + Number(retryCounts.delayed ?? 0);
  const redisFailedJobs = Number(deliveryCounts.failed ?? 0) + Number(retryCounts.failed ?? 0);
  const queuedBuffer = dbQueuedRecipients + redisWaitingJobs;
  let lastSchedulerReason = "normal";
  if (targetTotalRpsAllCampaigns > 0 && schedulerBatchSize === scaledTargetBatch) {
    lastSchedulerReason = "target_rps_scaled_batch";
  } else if (schedulerBatchSize === scaledLaneBatch) {
    lastSchedulerReason = "lane_scaled_batch";
  } else if (schedulerBatchSize === maxJobs) {
    lastSchedulerReason = "base_batch";
  }

  if (campaignIds.length > 0 && queuedBuffer < requiredBuffer && dbPendingRecipients > 0) {
    const backfillLimit = Math.max(1, Math.min(SCHEDULER_MAX_ENQUEUE_PER_TICK, requiredBuffer - queuedBuffer));
    const pendingRows = (await withSchedulerReadSlot(() =>
      prisma.campaignRecipient.findMany({
        where: {
          campaignId: { in: campaignIds },
          sendStatus: "pending"
        },
        orderBy: [{ createdAt: "asc" }],
        take: backfillLimit,
        select: {
          campaignId: true,
          recipientId: true,
          smtpAccountId: true
        }
      })
    )) as Array<{ campaignId: string; recipientId: string; smtpAccountId: string | null }>;
    const templateVersionByCampaign = new Map<string, number>(
      activeCampaigns.map((campaign: any) => [campaign.id as string, Number(campaign.template?.version ?? 1)])
    );
    const templateIdByCampaign = new Map<string, string>(
      activeCampaigns.map((campaign: any) => [campaign.id as string, String(campaign.templateId ?? "")])
    );
    const defaultSmtpByCampaign = new Map<string, string>(
      activeCampaigns.map((campaign: any) => [campaign.id as string, String(campaign.smtpAccountId ?? "")])
    );
    let cursor = 0;
    const workers = Array.from({ length: Math.min(25, pendingRows.length) }, async () => {
      while (cursor < pendingRows.length) {
        const current = cursor;
        cursor += 1;
        const row = pendingRows[current];
        if (!row) continue;
        const version = Number(templateVersionByCampaign.get(row.campaignId) ?? 1);
        const smtpId = row.smtpAccountId ?? defaultSmtpByCampaign.get(row.campaignId) ?? "";
        const claimed = await transitionCampaignRecipientStatus({
          campaignId: row.campaignId,
          recipientId: row.recipientId,
          to: "queued"
        });
        if (!claimed) {
          continue;
        }
        try {
          await deliveryQueue.add(
            "deliver_backfill",
            {
              campaignId: row.campaignId,
              recipientId: row.recipientId,
              templateId: templateIdByCampaign.get(row.campaignId) ?? "",
              smtpAccountId: smtpId,
              idempotencyKey: idempotencyKey(row.campaignId, row.recipientId, version),
              attempt: 1
            },
            {
              jobId: safeJobId(`delivery_${row.campaignId}_${row.recipientId}_${version}`)
            }
          );
          backfilled += 1;
        } catch (enqueueError) {
          await prisma.campaignRecipient
            .updateMany({
              where: {
                campaignId: row.campaignId,
                recipientId: row.recipientId,
                sendStatus: "queued"
              },
              data: {
                sendStatus: "pending"
              }
            })
            .catch(() => ({ count: 0 }));
          await safeCreateCampaignLog({
            campaignId: row.campaignId,
            recipientId: row.recipientId,
            eventType: "backfill_enqueue_failed",
            status: "failed",
            message: enqueueError instanceof Error ? enqueueError.message : "delivery_backfill_enqueue_failed"
          });
        }
      }
    });
    await Promise.all(workers);
    if (backfilled > 0) {
      lastSchedulerReason = "scheduler_underfeeding_backfill";
    }
  }
  const nowFeedLog = Date.now();
  if (nowFeedLog - lastSchedulerFeedLogAt >= SCHEDULER_FEED_LOG_MS) {
    lastSchedulerFeedLogAt = nowFeedLog;
    console.info("[scheduler.feed]", {
      dbPending: dbPendingRecipients,
      dbQueued: dbQueuedRecipients,
      redisWaiting: redisWaitingJobs,
      redisActive: redisActiveJobs,
      redisDelayed: redisDelayedJobs,
      redisFailed: redisFailedJobs,
      requiredBuffer,
      enqueued: dispatched + backfilled,
      targetRps: Number(targetTotalRpsAllCampaigns.toFixed(4)),
      reason: lastSchedulerReason
    });
  }

  const nowDiag = Date.now();
  if (nowDiag - lastDiagnosticsWriteAt >= SCHEDULER_DIAGNOSTICS_WRITE_MS) {
    lastDiagnosticsWriteAt = nowDiag;
    await withSchedulerReadSlot(() =>
      prisma.appSetting.upsert({
        where: { key: "scheduler_runtime_diagnostics" },
        create: {
          key: "scheduler_runtime_diagnostics",
          value: {
            dbPendingRecipients,
            dbQueuedRecipients,
            dbProcessingRecipients,
            dbSentRecipients,
            dbFailedRecipients,
            dbSkippedRecipients,
            redisWaitingJobs,
            redisActiveJobs,
            redisDelayedJobs,
            redisFailedJobs,
            schedulerBatchSize,
            requiredBuffer,
            lastSchedulerEnqueued: dispatched + backfilled,
            lastSchedulerReason,
            targetRps: targetTotalRpsAllCampaigns,
            updatedAt: new Date().toISOString()
          } as any
        },
        update: {
          value: {
            dbPendingRecipients,
            dbQueuedRecipients,
            dbProcessingRecipients,
            dbSentRecipients,
            dbFailedRecipients,
            dbSkippedRecipients,
            redisWaitingJobs,
            redisActiveJobs,
            redisDelayedJobs,
            redisFailedJobs,
            schedulerBatchSize,
            requiredBuffer,
            lastSchedulerEnqueued: dispatched + backfilled,
            lastSchedulerReason,
            targetRps: targetTotalRpsAllCampaigns,
            updatedAt: new Date().toISOString()
          } as any
        }
      }).catch(() => null)
    );
  }

  return {
    dispatched,
    backfilled,
    dbPendingRecipients,
    dbQueuedRecipients,
    dbProcessingRecipients,
    dbSentRecipients,
    dbFailedRecipients,
    dbSkippedRecipients,
    redisWaitingJobs,
    redisActiveJobs,
    redisDelayedJobs,
    redisFailedJobs,
    schedulerBatchSize,
    requiredBuffer,
    lastSchedulerEnqueued: dispatched + backfilled,
    lastSchedulerReason,
    targetRps: targetTotalRpsAllCampaigns
  };
}
