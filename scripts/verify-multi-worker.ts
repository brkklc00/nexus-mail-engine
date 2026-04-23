import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@nexus.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "ChangeMe123!";

async function getSessionCookie() {
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
  return cookie;
}

async function main() {
  const cookie = await getSessionCookie();
  const bootstrapRes = await fetch(`${BASE_URL}/api/send/bootstrap`, { headers: { Cookie: cookie } });
  const bootstrap = (await bootstrapRes.json()) as any;
  const templateId = bootstrap.templates?.[0]?.id;
  const listId = bootstrap.lists?.[0]?.id;
  const smtpAccountId = bootstrap.smtps?.[0]?.id;
  if (!templateId || !listId || !smtpAccountId) {
    throw new Error("seed_data_missing");
  }

  const createRes = await fetch(`${BASE_URL}/api/campaigns`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      name: `MultiWorker-${Date.now()}`,
      templateId,
      listId,
      smtpAccountId
    })
  });
  const created = (await createRes.json()) as any;
  const campaignId = created.campaign.id as string;

  await Promise.all([
    fetch(`${BASE_URL}/api/campaigns/${campaignId}/start`, { method: "POST", headers: { Cookie: cookie } }),
    fetch(`${BASE_URL}/api/campaigns/${campaignId}/start`, { method: "POST", headers: { Cookie: cookie } }),
    fetch(`${BASE_URL}/api/campaigns/${campaignId}/resume`, { method: "POST", headers: { Cookie: cookie } }).catch(
      () => null
    )
  ]);

  for (let i = 0; i < 60; i += 1) {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (campaign && ["completed", "failed", "partially_completed", "canceled"].includes(campaign.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const duplicates = await prisma.campaignLog.groupBy({
    by: ["idempotencyKey"],
    where: { campaignId, idempotencyKey: { not: null } },
    _count: { _all: true },
    having: { idempotencyKey: { _count: { gt: 1 } } }
  });

  const queuedDupes = await prisma.campaignRecipient.groupBy({
    by: ["recipientId"],
    where: { campaignId, sendStatus: "queued" },
    _count: { _all: true },
    having: { recipientId: { _count: { gt: 1 } } }
  });

  console.log(
    JSON.stringify(
      {
        campaignId,
        duplicateDeliveryLogs: duplicates.length,
        duplicateQueuedRecipients: queuedDupes.length
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
