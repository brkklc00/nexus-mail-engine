import { prisma } from "@nexus/db";

type SendStatus = "pending" | "queued" | "sent" | "failed" | "skipped";

const ALLOWED_FROM: Record<SendStatus, SendStatus[]> = {
  pending: [],
  queued: ["pending", "failed"],
  sent: ["queued"],
  failed: ["queued"],
  skipped: ["pending", "queued", "failed"]
};

export async function transitionCampaignRecipientStatus(input: {
  campaignId: string;
  recipientId: string;
  to: SendStatus;
  sentAt?: Date;
}) {
  const from = ALLOWED_FROM[input.to];
  if (from.length === 0) {
    throw new Error(`transition_target_not_allowed:${input.to}`);
  }

  const result = await prisma.campaignRecipient.updateMany({
    where: {
      campaignId: input.campaignId,
      recipientId: input.recipientId,
      sendStatus: { in: from }
    },
    data: {
      sendStatus: input.to,
      sentAt: input.sentAt ?? undefined
    }
  });
  return result.count > 0;
}
