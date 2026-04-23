import { PrismaClient } from "@prisma/client";
import { getQueueObservability } from "../apps/web/server/observability/queue-observability.service";
import { getSafetyState, recordDeliveryOutcome } from "../apps/worker/src/safety/distributed-safety.service";

const prisma = new PrismaClient();
const BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@nexus.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "ChangeMe123!";
const BENCH_RECIPIENT_COUNT = Number(process.env.BENCH_RECIPIENT_COUNT ?? 200);

async function loginCookie() {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  });
  if (!response.ok) {
    throw new Error("benchmark_login_failed");
  }
  const cookie = response.headers.get("set-cookie");
  if (!cookie) {
    throw new Error("benchmark_cookie_missing");
  }
  return cookie;
}

async function ensureBenchmarkList() {
  const list = await prisma.recipientList.upsert({
    where: { id: "00000000-0000-0000-0000-000000000777" },
    create: {
      id: "00000000-0000-0000-0000-000000000777",
      name: "Benchmark List",
      tags: ["benchmark"],
      maxSize: 50000
    },
    update: {}
  });

  for (let i = 0; i < BENCH_RECIPIENT_COUNT; i += 1) {
    const id = `bench-${i.toString().padStart(6, "0")}`;
    const email = `${id}@example.com`;
    const recipient = await prisma.recipient.upsert({
      where: { emailNormalized: email.toLowerCase() },
      create: {
        email,
        emailNormalized: email.toLowerCase(),
        name: `Bench ${i}`,
        status: "active",
        tags: ["benchmark"]
      },
      update: {
        status: "active"
      }
    });
    await prisma.recipientListMembership.upsert({
      where: {
        listId_recipientId: {
          listId: list.id,
          recipientId: recipient.id
        }
      },
      create: {
        listId: list.id,
        recipientId: recipient.id
      },
      update: {}
    });
  }

  return list.id;
}

async function benchmarkClickOpenWriteOverhead(campaignId: string, recipientId: string) {
  const rounds = 50;
  const t0 = Date.now();
  for (let i = 0; i < rounds; i += 1) {
    await prisma.openEvent.create({
      data: {
        campaignId,
        recipientId,
        userAgent: "benchmark-open"
      }
    });
    await prisma.clickEvent.create({
      data: {
        campaignId,
        recipientId,
        targetUrl: "https://example.com/benchmark",
        userAgent: "benchmark-click"
      }
    });
  }
  const elapsed = Date.now() - t0;
  return Number((elapsed / (rounds * 2)).toFixed(2));
}

async function benchmarkThrottleRecovery(smtpAccountId: string) {
  for (let i = 0; i < 20; i += 1) {
    await recordDeliveryOutcome(smtpAccountId, true);
  }

  const started = Date.now();
  for (let i = 0; i < 240; i += 1) {
    await recordDeliveryOutcome(smtpAccountId, false);
    const state = await getSafetyState(smtpAccountId);
    if (!state.isThrottled && state.throttleLevel === 0) {
      return Date.now() - started;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return -1;
}

async function main() {
  const cookie = await loginCookie();
  const listId = await ensureBenchmarkList();

  const bootstrapRes = await fetch(`${BASE_URL}/api/send/bootstrap`, { headers: { Cookie: cookie } });
  const bootstrap = (await bootstrapRes.json()) as any;
  const templateId = bootstrap.templates?.[0]?.id;
  const smtpAccountId = bootstrap.smtps?.[0]?.id;
  if (!templateId || !smtpAccountId) {
    throw new Error("benchmark_seed_assets_missing");
  }

  const createRes = await fetch(`${BASE_URL}/api/campaigns`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie
    },
    body: JSON.stringify({
      name: `Benchmark-${Date.now()}`,
      templateId,
      listId,
      smtpAccountId
    })
  });
  const created = (await createRes.json()) as any;
  const campaignId = created.campaign.id as string;

  const startedAt = Date.now();
  await fetch(`${BASE_URL}/api/campaigns/${campaignId}/start`, {
    method: "POST",
    headers: { Cookie: cookie }
  });

  let firstSentAt: number | null = null;
  let queueLagMax = 0;
  let queueLagSamples = 0;

  for (let i = 0; i < 180; i += 1) {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    const obs = await getQueueObservability();
    queueLagMax = Math.max(queueLagMax, Number(obs.latencyMs ?? 0));
    queueLagSamples += 1;

    if (!firstSentAt) {
      const firstSent = await prisma.campaignLog.findFirst({
        where: { campaignId, eventType: "sent" },
        orderBy: { createdAt: "asc" }
      });
      if (firstSent) {
        firstSentAt = firstSent.createdAt.getTime();
      }
    }

    if (campaign && ["completed", "partially_completed", "failed", "canceled"].includes(campaign.status)) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) {
    throw new Error("benchmark_campaign_missing");
  }
  const durationMs = Math.max(1, Date.now() - startedAt);
  const throughput = Number(((campaign.totalSent / durationMs) * 1000).toFixed(2));
  const dispatchLatency = firstSentAt ? firstSentAt - startedAt : -1;
  const avgQueueLag = Math.round(queueLagMax / Math.max(1, queueLagSamples));

  const firstRecipient = await prisma.campaignRecipient.findFirst({
    where: { campaignId },
    orderBy: { createdAt: "asc" }
  });
  const writeOverheadMs = firstRecipient
    ? await benchmarkClickOpenWriteOverhead(campaignId, firstRecipient.recipientId)
    : -1;
  const throttleRecoveryTimeMs = await benchmarkThrottleRecovery(smtpAccountId);

  const result = {
    benchmark: "multi_worker_runtime",
    campaignId,
    workersAssumed: Number(process.env.WORKER_REPLICAS ?? 2),
    recipients: BENCH_RECIPIENT_COUNT,
    metrics: {
      queueLagMs: {
        avgSampled: avgQueueLag,
        maxSampled: queueLagMax
      },
      dispatchLatencyMs: dispatchLatency,
      sendThroughputPerSecond: throughput,
      clickOpenWriteOverheadMsPerEvent: writeOverheadMs,
      throttleRecoveryTimeMs
    }
  };

  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
