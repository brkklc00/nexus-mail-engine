import crypto from "node:crypto";
import { prisma } from "@nexus/db";
import { deliveryQueue, safeJobId, withDistributedLock } from "@nexus/queue";
import { FairCampaignScheduler } from "./fair-scheduler.js";
import { transitionCampaignRecipientStatus } from "../state/campaign-recipient-state.service.js";

const scheduler = new FairCampaignScheduler();

function idempotencyKey(campaignId: string, recipientId: string, templateVersion: number): string {
  return crypto
    .createHash("sha256")
    .update(`${campaignId}:${recipientId}:${templateVersion}`)
    .digest("hex");
}

export async function dispatchFairBatch(maxJobs = 100): Promise<number> {
  const activeCampaigns = await prisma.campaign.findMany({
    where: {
      OR: [
        { status: "running" },
        {
          status: "queued",
          OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }]
        }
      ]
    },
    include: {
      template: true,
      recipients: {
        where: { sendStatus: "pending" },
        take: maxJobs
      }
    },
    orderBy: [{ createdAt: "asc" }]
  });

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
  const [smtpAccounts, warmupStats, poolSetting] = await Promise.all([
    smtpIds.length
      ? prisma.smtpAccount.findMany({
          where: { id: { in: smtpIds }, isActive: true, isSoftDeleted: false },
          select: { id: true, isThrottled: true, healthStatus: true, targetRatePerSecond: true, maxRatePerSecond: true, warmupEnabled: true, warmupStartRps: true, warmupIncrementStep: true, warmupMaxRps: true, cooldownUntil: true }
        })
      : Promise.resolve([] as any[]),
    smtpIds.length
      ? prisma.smtpWarmupStat.findMany({
          where: { smtpAccountId: { in: smtpIds }, date: { gte: today } },
          select: { smtpAccountId: true, successfulDeliveries: true, failedDeliveries: true }
        })
      : Promise.resolve([] as any[]),
    prisma.appSetting.findUnique({ where: { key: "smtp_pool_settings" } })
  ]);
  const settings = ((poolSetting?.value as any) ?? {}) as {
    skipThrottled?: boolean;
    skipUnhealthy?: boolean;
    perSmtpConcurrency?: number;
  };
  const skipThrottled = settings.skipThrottled ?? true;
  const skipUnhealthy = settings.skipUnhealthy ?? true;
  const perSmtpConcurrency = Math.max(1, Number(settings.perSmtpConcurrency ?? 1));
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
          await prisma.campaignLog.create({
            data: {
              campaignId: campaign.id,
              recipientId: nextRecipient.recipientId,
              eventType: "dispatch_waiting_smtp",
              status: "skipped",
              message: "No active SMTP available in pool; dispatch delayed."
            }
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
