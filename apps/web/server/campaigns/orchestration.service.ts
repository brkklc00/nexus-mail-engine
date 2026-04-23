import { prisma } from "@nexus/db";
import { campaignQueue, withDistributedLock } from "@nexus/queue";

const CAMPAIGN_LOCK_TTL_MS = 30_000;

async function withCampaignLock<T>(campaignId: string, action: string, callback: () => Promise<T>) {
  return withDistributedLock(`lock:campaign:${action}:${campaignId}`, CAMPAIGN_LOCK_TTL_MS, callback);
}

export async function createCampaign(input: {
  name: string;
  templateId: string;
  listId?: string | null;
  smtpAccountId: string;
  scheduledAt?: Date | null;
}) {
  const [template, smtp, list] = await Promise.all([
    prisma.mailTemplate.findUnique({ where: { id: input.templateId } }),
    prisma.smtpAccount.findUnique({ where: { id: input.smtpAccountId } }),
    input.listId ? prisma.recipientList.findUnique({ where: { id: input.listId } }) : null
  ]);

  if (!template) {
    throw new Error("template_not_found");
  }
  if (!smtp || !smtp.isActive || smtp.isSoftDeleted) {
    throw new Error("smtp_not_available");
  }
  if (input.listId && !list) {
    throw new Error("list_not_found");
  }

  return prisma.campaign.create({
    data: {
      name: input.name,
      subject: template.subject,
      templateId: template.id,
      listId: input.listId ?? null,
      smtpAccountId: smtp.id,
      provider: smtp.providerLabel ?? "custom-smtp",
      status: input.scheduledAt ? "queued" : "pending",
      scheduledAt: input.scheduledAt ?? null
    }
  });
}

export async function startCampaign(campaignId: string) {
  return withCampaignLock(campaignId, "start", async () =>
    prisma.$transaction(async (tx: any) => {
      const campaign = await tx.campaign.findUnique({
        where: { id: campaignId },
        include: { list: true }
      });
      if (!campaign) {
        throw new Error("campaign_not_found");
      }
      if (!["pending", "queued", "paused"].includes(campaign.status)) {
        throw new Error("campaign_state_invalid");
      }

      const recipients = campaign.listId
        ? await tx.recipientListMembership.findMany({
            where: { listId: campaign.listId },
            include: { recipient: true }
          })
        : [];

      const suppression = await tx.suppressionEntry.findMany({
        where: { scope: "global" },
        select: { emailNormalized: true }
      });
      const suppressed = new Set(suppression.map((s: any) => s.emailNormalized));

      const candidates = recipients
        .map((row: any) => row.recipient)
        .filter((recipient: any) => recipient.status === "active")
        .filter((recipient: any) => !suppressed.has(recipient.emailNormalized));

      await tx.campaignRecipient.createMany({
        data: candidates.map((recipient: any) => ({
          campaignId: campaign.id,
          recipientId: recipient.id,
          idempotencyKey: `${campaign.id}:${recipient.id}:${campaign.templateId}`
        })),
        skipDuplicates: true
      });

      const updated = await tx.campaign.update({
        where: { id: campaign.id },
        data: {
          status: "running",
          startedAt: campaign.startedAt ?? new Date(),
          totalTargeted: candidates.length
        }
      });

      await tx.campaignLog.create({
        data: {
          campaignId: campaign.id,
          eventType: "campaign_started",
          status: "success",
          message: `Campaign started with ${candidates.length} recipients`
        }
      });

      return updated;
    })
  );
}

export async function pauseCampaign(campaignId: string) {
  const result = await prisma.campaign.updateMany({
    where: { id: campaignId, status: "running" },
    data: { status: "paused" }
  });
  if (result.count === 0) {
    throw new Error("campaign_pause_failed");
  }
  await prisma.campaignLog.create({
    data: {
      campaignId,
      eventType: "campaign_paused",
      status: "success"
    }
  });
}

export async function resumeCampaign(campaignId: string) {
  return withCampaignLock(campaignId, "resume", async () => {
    const result = await prisma.campaign.updateMany({
      where: { id: campaignId, status: "paused" },
      data: { status: "running" }
    });
    if (result.count === 0) {
      throw new Error("campaign_resume_failed");
    }
    await campaignQueue.add(
      "campaign_resume",
      { campaignId, trigger: "resume" },
      { jobId: `campaign_resume:${campaignId}` }
    );
    await prisma.campaignLog.create({
      data: {
        campaignId,
        eventType: "campaign_resumed",
        status: "success"
      }
    });
  });
}

export async function cancelCampaign(campaignId: string) {
  return prisma.$transaction(async (tx: any) => {
    const result = await tx.campaign.updateMany({
      where: { id: campaignId, status: { in: ["queued", "running", "paused", "pending"] } },
      data: { status: "canceled", finishedAt: new Date(), stoppedEarly: true }
    });
    if (result.count === 0) {
      throw new Error("campaign_cancel_failed");
    }

    await tx.campaignRecipient.updateMany({
      where: { campaignId, sendStatus: { in: ["pending", "queued", "failed"] } },
      data: { sendStatus: "skipped" }
    });
    await tx.campaignLog.create({
      data: {
        campaignId,
        eventType: "campaign_canceled",
        status: "success"
      }
    });
  });
}
