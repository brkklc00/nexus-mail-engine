import crypto from "node:crypto";
import { prisma } from "@nexus/db";
import { deliveryQueue, withDistributedLock } from "@nexus/queue";
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
  const smtpAccounts = smtpIds.length
    ? await prisma.smtpAccount.findMany({
        where: { id: { in: smtpIds }, isActive: true, isSoftDeleted: false },
        select: { id: true, isThrottled: true }
      })
    : [];
  const smtpState = new Map<string, { id: string; isThrottled: boolean }>(
    smtpAccounts.map((smtp: any) => [smtp.id as string, { id: smtp.id, isThrottled: Boolean(smtp.isThrottled) }])
  );

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
        const activePool = [campaign.smtpAccountId, ...poolFromConfig]
          .filter((id: string, idx: number, arr: string[]) => arr.indexOf(id) === idx)
          .filter((id: string) => {
            const state = smtpState.get(id);
            return Boolean(state && !state.isThrottled);
          });
        const preferredSmtp = nextRecipient.smtpAccountId || campaign.smtpAccountId;
        const selectedSmtp = activePool.includes(preferredSmtp) ? preferredSmtp : activePool[0];
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
            jobId: `delivery:${campaign.id}:${nextRecipient.recipientId}:${campaign.template.version}`
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
