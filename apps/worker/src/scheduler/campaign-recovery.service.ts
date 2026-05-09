import { prisma } from "@nexus/db";
import { deliveryQueue, safeJobId } from "@nexus/queue";

function idempotencyKey(campaignId: string, recipientId: string, templateVersion: number): string {
  return `${campaignId}:${recipientId}:${templateVersion}`;
}

export async function recoverCampaignQueuesOnBoot() {
  const staleThreshold = new Date(Date.now() - 5 * 60_000);
  const campaigns = await prisma.campaign.findMany({
    where: {
      isDeleted: false,
      status: { in: ["running", "queued", "partially_completed"] }
    },
    select: {
      id: true,
      templateId: true,
      template: { select: { version: true } }
    }
  });
  const campaignIds = campaigns.map((item: { id: string }) => item.id);
  if (campaignIds.length === 0) {
    console.info("[worker.recovery] campaigns resumed", {
      campaigns: 0,
      pendingRecipients: 0,
      enqueued: 0,
      skippedSent: 0,
      staleProcessingReset: 0
    });
    return;
  }

  const staleReset = await prisma.campaignRecipient.updateMany({
    where: {
      campaignId: { in: campaignIds },
      sendStatus: "queued",
      updatedAt: { lt: staleThreshold }
    },
    data: { sendStatus: "pending" }
  });

  const [pendingRecipients, skippedSent] = await Promise.all([
    prisma.campaignRecipient.findMany({
      where: {
        campaignId: { in: campaignIds },
        sendStatus: "pending"
      },
      select: {
        campaignId: true,
        recipientId: true,
        smtpAccountId: true
      },
      take: 20000
    }),
    prisma.campaignRecipient.count({
      where: {
        campaignId: { in: campaignIds },
        sendStatus: "sent"
      }
    })
  ]);

  const campaignTemplateVersion = new Map<string, number>(
    campaigns.map((item: { id: string; template: { version: number } }) => [item.id, Number(item.template.version ?? 1)])
  );
  let enqueued = 0;
  for (const row of pendingRecipients) {
    const version = Number(campaignTemplateVersion.get(row.campaignId) ?? 1);
    await deliveryQueue.add(
      "deliver_recovery",
      {
        campaignId: row.campaignId,
        recipientId: row.recipientId,
        templateId: "",
        smtpAccountId: row.smtpAccountId ?? "",
        idempotencyKey: idempotencyKey(row.campaignId, row.recipientId, version),
        attempt: 1
      },
      {
        jobId: safeJobId(`delivery_${row.campaignId}_${row.recipientId}_${version}`)
      }
    );
    enqueued += 1;
  }

  console.info("[worker.recovery] campaigns resumed", {
    campaigns: campaigns.length,
    pendingRecipients: pendingRecipients.length,
    enqueued,
    skippedSent,
    staleProcessingReset: staleReset.count
  });
}
