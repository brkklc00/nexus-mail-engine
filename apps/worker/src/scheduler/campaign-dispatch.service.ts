import crypto from "node:crypto";
import { prisma } from "@nexus/db";
import { deliveryQueue, safeJobId, withDistributedLock } from "@nexus/queue";
import { FairCampaignScheduler } from "./fair-scheduler.js";
import { transitionCampaignRecipientStatus } from "../state/campaign-recipient-state.service.js";
import { safeCreateCampaignLog } from "../logging/safe-campaign-log.js";

const scheduler = new FairCampaignScheduler();
const WORKER_DB_READ_CONCURRENCY = Math.max(1, Math.min(5, Number(process.env.WORKER_DB_READ_CONCURRENCY ?? 2)));
const WORKER_SETTINGS_CACHE_MS = Math.max(1_000, Number(process.env.WORKER_SETTINGS_CACHE_MS ?? 30_000));
const WORKER_SMTP_CACHE_MS = Math.max(1_000, Number(process.env.WORKER_SMTP_CACHE_MS ?? 30_000));
const WORKER_CAMPAIGN_CACHE_MS = Math.max(1_000, Number(process.env.WORKER_CAMPAIGN_CACHE_MS ?? 10_000));
const WORKER_WARMUP_CACHE_MS = Math.max(1_000, Number(process.env.WORKER_WARMUP_CACHE_MS ?? 30_000));
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

export async function dispatchFairBatch(maxJobs = 100): Promise<number> {
  const campaignTake = Math.max(1, Math.min(100, Number(process.env.SCHEDULER_CAMPAIGN_TAKE ?? 20)));
  const recipientsTakePerCampaign = Math.max(5, Math.min(maxJobs, Number(process.env.SCHEDULER_RECIPIENTS_TAKE_PER_CAMPAIGN ?? 20)));
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
      },
      recipients: {
        where: { sendStatus: "pending" },
        take: recipientsTakePerCampaign,
        select: {
          recipientId: true,
          smtpAccountId: true
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

  const slots = activeCampaigns.map((campaign: any) => ({
    campaignId: campaign.id,
    smtpAccountId: campaign.smtpAccountId,
    provider: campaign.provider,
    remaining: campaign.recipients.length,
    priority: 1
  }));

  const picks = scheduler.nextBatch(slots, maxJobs);
  let dispatched = 0;

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
          select: { id: true, isThrottled: true, healthStatus: true, targetRatePerSecond: true, maxRatePerSecond: true, warmupEnabled: true, warmupStartRps: true, warmupIncrementStep: true, warmupMaxRps: true, cooldownUntil: true }
        }))) as any[];
  if (smtpIds.length > 0 && (!cachedSmtpState || cachedSmtpState.expiresAt <= nowMs || cachedSmtpState.key !== smtpCacheKey)) {
    cachedSmtpState = {
      key: smtpCacheKey,
      data: smtpAccounts,
      expiresAt: nowMs + WORKER_SMTP_CACHE_MS
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
  const perSmtpConcurrency = poolSettings.perSmtpConcurrency;
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
            if (skipThrottled && state.isThrottled) return false;
            if (skipUnhealthy && state.healthStatus === "error") return false;
            if (state.cooldownUntil && new Date(state.cooldownUntil).getTime() > now) return false;
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
          const warmupWeight = state?.warmupEnabled
            ? Math.max(1, Math.round(Math.min(state.warmupMaxRps ?? base, state.warmupStartRps + state.warmupIncrementStep)))
            : Math.max(1, Math.round(base));
          return Array.from({ length: Math.min(20, warmupWeight) }).map(() => id);
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
      });
    } catch (error) {
      if ((error as Error).message !== "lock_not_acquired") {
        throw error;
      }
    }
  }

  return dispatched;
}
