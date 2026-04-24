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
            smtpAccountId: campaign.smtpAccountId,
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
