import { prisma } from "@nexus/db";

type EventMeta = {
  ip?: string | null;
  userAgent?: string | null;
};

export async function recordOpenEvent(campaignId: string, recipientId: string, meta: EventMeta) {
  const existing = await prisma.openEvent.findFirst({
    where: { campaignId, recipientId }
  });

  const event = await prisma.openEvent.create({
    data: {
      campaignId,
      recipientId,
      ip: meta.ip,
      userAgent: meta.userAgent
    }
  });

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      totalOpened: { increment: existing ? 0 : 1 }
    }
  });
  return event;
}

export async function recordClickEvent(
  campaignId: string,
  recipientId: string,
  campaignLinkId: string | undefined,
  targetUrl: string,
  meta: EventMeta
) {
  const existing = await prisma.clickEvent.findFirst({
    where: { campaignId, recipientId }
  });

  const event = await prisma.clickEvent.create({
    data: {
      campaignId,
      recipientId,
      campaignLinkId: campaignLinkId ?? null,
      targetUrl,
      ip: meta.ip,
      userAgent: meta.userAgent
    }
  });

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      totalClicked: { increment: existing ? 0 : 1 }
    }
  });
  return event;
}

export async function suppressRecipient(recipientId: string, email: string, reason: string) {
  await prisma.recipient.update({
    where: { id: recipientId },
    data: { status: "unsubscribed" }
  });

  await prisma.campaign.updateMany({
    where: {
      recipients: {
        some: { recipientId }
      }
    },
    data: {
      unsubscribeCount: { increment: 1 }
    }
  });

  return prisma.suppressionEntry.upsert({
    where: {
      emailNormalized_scope: {
        emailNormalized: email.trim().toLowerCase(),
        scope: "global"
      }
    },
    create: {
      email: email.trim(),
      emailNormalized: email.trim().toLowerCase(),
      scope: "global",
      reason,
      recipientId
    },
    update: {
      reason,
      recipientId,
      updatedAt: new Date()
    }
  });
}
