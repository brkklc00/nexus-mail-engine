import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";

const prisma = new PrismaClient();

function sign(payload: object) {
  const secret = process.env.TRACKING_SECRET ?? "change-me";
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

async function run() {
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const campaign = await prisma.campaign.findFirst({
    where: { status: { in: ["running", "completed", "partially_completed"] } },
    include: { recipients: true }
  });
  if (!campaign || campaign.recipients.length === 0) {
    throw new Error("No campaign/recipient found for verification");
  }

  const recipient = campaign.recipients[0];
  const link = await prisma.campaignLink.findFirst({
    where: { campaignId: campaign.id }
  });
  if (!link) {
    throw new Error("No campaign link found for click verification");
  }

  const openToken = sign({
    campaignId: campaign.id,
    recipientId: recipient.recipientId,
    type: "open",
    expiresAt: Date.now() + 1000 * 60 * 10
  });
  const clickToken = sign({
    campaignId: campaign.id,
    recipientId: recipient.recipientId,
    type: "click",
    campaignLinkId: link.id,
    expiresAt: Date.now() + 1000 * 60 * 10
  });
  const unsubToken = sign({
    campaignId: campaign.id,
    recipientId: recipient.recipientId,
    type: "unsubscribe",
    expiresAt: Date.now() + 1000 * 60 * 10
  });

  await fetch(`${base}/track/open/${openToken}`);
  await fetch(`${base}/track/click/${clickToken}`, { redirect: "manual" });
  await fetch(`${base}/unsubscribe/${unsubToken}`);

  const [openCount, clickCount, suppression, refreshedCampaign, topLinks] = await Promise.all([
    prisma.openEvent.count({ where: { campaignId: campaign.id, recipientId: recipient.recipientId } }),
    prisma.clickEvent.count({ where: { campaignId: campaign.id, recipientId: recipient.recipientId } }),
    prisma.suppressionEntry.findFirst({
      where: {
        recipientId: recipient.recipientId
      }
    }),
    prisma.campaign.findUnique({ where: { id: campaign.id } }),
    prisma.clickEvent.groupBy({
      by: ["campaignLinkId"],
      where: { campaignId: campaign.id, campaignLinkId: { not: null } },
      _count: { _all: true }
    })
  ]);

  console.log(
    JSON.stringify(
      {
        campaignId: campaign.id,
        recipientId: recipient.recipientId,
        openLogged: openCount > 0,
        clickLogged: clickCount > 0,
        unsubSuppressed: Boolean(suppression),
        campaignMetrics: {
          uniqueOpened: refreshedCampaign?.totalOpened,
          uniqueClicked: refreshedCampaign?.totalClicked,
          unsubscribes: refreshedCampaign?.unsubscribeCount
        },
        topLinks
      },
      null,
      2
    )
  );
}

run()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
