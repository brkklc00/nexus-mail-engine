import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";

const prisma = new PrismaClient();

const BASE_URL = process.env.APP_BASE_URL ?? "http://web:3000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@nexus.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "ChangeMe123!";

function sign(payload: object) {
  const secret = process.env.TRACKING_SECRET ?? "change-me";
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

async function waitForReady() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) return;
    } catch {
      // keep retrying
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("web_not_ready");
}

async function main() {
  await waitForReady();

  const login = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  });
  if (!login.ok) {
    throw new Error("login_failed");
  }
  const cookie = login.headers.get("set-cookie");
  if (!cookie) {
    throw new Error("session_cookie_missing");
  }

  const bootstrapRes = await fetch(`${BASE_URL}/api/send/bootstrap`, {
    headers: { Cookie: cookie }
  });
  const bootstrap = (await bootstrapRes.json()) as any;
  const templateId = bootstrap.templates?.[0]?.id;
  const listId = bootstrap.lists?.[0]?.id;
  const smtpAccountId = bootstrap.smtps?.[0]?.id;
  if (!templateId || !listId || !smtpAccountId) {
    throw new Error("seed_data_missing");
  }

  const createRes = await fetch(`${BASE_URL}/api/campaigns`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie
    },
    body: JSON.stringify({
      name: `Smoke-${Date.now()}`,
      templateId,
      listId,
      smtpAccountId
    })
  });
  const created = (await createRes.json()) as any;
  if (!createRes.ok) {
    throw new Error(`campaign_create_failed:${JSON.stringify(created)}`);
  }
  const campaignId = created.campaign.id as string;

  const startRes = await fetch(`${BASE_URL}/api/campaigns/${campaignId}/start`, {
    method: "POST",
    headers: { Cookie: cookie }
  });
  if (!startRes.ok) {
    throw new Error("campaign_start_failed");
  }

  let campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  for (let i = 0; i < 90; i += 1) {
    campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new Error("campaign_lost");
    if (["completed", "failed", "partially_completed", "canceled"].includes(campaign.status)) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const recipient = await prisma.campaignRecipient.findFirst({
    where: { campaignId },
    orderBy: { createdAt: "asc" }
  });
  if (!recipient) {
    throw new Error("campaign_recipient_missing");
  }

  const clickLink = await prisma.campaignLink.findFirst({
    where: { campaignId }
  });

  const openToken = sign({
    campaignId,
    recipientId: recipient.recipientId,
    type: "open",
    expiresAt: Date.now() + 5 * 60_000
  });
  await fetch(`${BASE_URL}/track/open/${openToken}`);

  if (clickLink) {
    const clickToken = sign({
      campaignId,
      recipientId: recipient.recipientId,
      type: "click",
      campaignLinkId: clickLink.id,
      expiresAt: Date.now() + 5 * 60_000
    });
    await fetch(`${BASE_URL}/track/click/${clickToken}`, { redirect: "manual" });
  }

  const unsubscribeToken = sign({
    campaignId,
    recipientId: recipient.recipientId,
    type: "unsubscribe",
    expiresAt: Date.now() + 5 * 60_000
  });
  await fetch(`${BASE_URL}/unsubscribe/${unsubscribeToken}`);

  const [freshCampaign, opens, clicks, suppression, topLinks] = await Promise.all([
    prisma.campaign.findUnique({ where: { id: campaignId } }),
    prisma.openEvent.count({ where: { campaignId } }),
    prisma.clickEvent.count({ where: { campaignId } }),
    prisma.suppressionEntry.count({ where: { recipientId: recipient.recipientId } }),
    prisma.clickEvent.groupBy({
      by: ["campaignLinkId"],
      where: { campaignId, campaignLinkId: { not: null } },
      _count: { _all: true }
    })
  ]);

  console.log(
    JSON.stringify(
      {
        boot: "ok",
        campaign: {
          id: campaignId,
          status: freshCampaign?.status,
          targeted: freshCampaign?.totalTargeted,
          sent: freshCampaign?.totalSent,
          failed: freshCampaign?.totalFailed,
          skipped: freshCampaign?.totalSkipped,
          uniqueOpened: freshCampaign?.totalOpened,
          uniqueClicked: freshCampaign?.totalClicked
        },
        tracking: {
          openEvents: opens,
          clickEvents: clicks,
          suppressedRecords: suppression
        },
        topLinks
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
