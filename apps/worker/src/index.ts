import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { createServer } from "node:http";
import { prisma } from "@nexus/db";
import {
  alibabaSuppressionSyncQueue,
  type AlibabaSuppressionSyncJob,
  QUEUE_NAMES,
  deadLetterQueue,
  deliveryQueue,
  getRedisConnection,
  retryQueue,
  withDistributedLock
} from "@nexus/queue";
import { processDelivery } from "./processors/delivery.processor.js";
import { processRetry } from "./processors/retry.processor.js";
import { dispatchFairBatch } from "./scheduler/campaign-dispatch.service.js";
import { recoverCampaignQueuesOnBoot } from "./scheduler/campaign-recovery.service.js";
import { getAllSafetyStates } from "./safety/distributed-safety.service.js";
import { safeCreateCampaignLog } from "./logging/safe-campaign-log.js";
import { processAlibabaSuppressionSync, recoverAlibabaSyncJobs } from "./processors/alibaba-sync.processor.js";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null
});
const workerConcurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY || 120));
const schedulerTickMs = Math.max(200, Number(process.env.SCHEDULER_TICK_MS ?? 500));
const schedulerBatchSize = Math.max(50, Number(process.env.SCHEDULER_BATCH_SIZE ?? 2000));
const schedulerDbReadConcurrency = Math.max(1, Number(process.env.WORKER_DB_READ_CONCURRENCY ?? 5));
const schedulerCampaignTake = Math.max(1, Number(process.env.SCHEDULER_CAMPAIGN_TAKE ?? 20));
const workerSettingsCacheMs = Math.max(1_000, Number(process.env.WORKER_SETTINGS_CACHE_MS ?? 30_000));
const workerSmtpCacheMs = Math.max(1_000, Number(process.env.WORKER_SMTP_CACHE_MS ?? 30_000));
const workerCampaignCacheMs = Math.max(1_000, Number(process.env.WORKER_CAMPAIGN_CACHE_MS ?? 10_000));

const deliveryWorker = new Worker(QUEUE_NAMES.DELIVERY, processDelivery, {
  connection: redis,
  concurrency: workerConcurrency
});

const retryWorker = new Worker(QUEUE_NAMES.RETRY, processRetry, {
  connection: redis,
  concurrency: Math.max(1, Math.floor(workerConcurrency / 2))
});

const alibabaSyncWorker = new Worker<AlibabaSuppressionSyncJob>(
  QUEUE_NAMES.ALIBABA_SUPPRESSION_SYNC,
  processAlibabaSuppressionSync,
  {
    connection: redis,
    concurrency: 1
  }
);

const sharedRedis = getRedisConnection();
type WorkerHealthSnapshot = {
  ok: boolean;
  service: string;
  ts: number;
  checks: { db: boolean; redis: boolean };
  worker: { concurrency: number };
  queue: { lagMs: number; counts: Record<string, number> };
  smtpThrottle: { activeCount: number; states: unknown[] };
  sharedSafety: unknown[];
  error?: string;
};

let latestHealthSnapshot: WorkerHealthSnapshot = {
  ok: false,
  service: "nexus-worker",
  ts: Date.now(),
  checks: { db: false, redis: false },
  worker: { concurrency: workerConcurrency },
  queue: { lagMs: 0, counts: {} as Record<string, number> },
  smtpThrottle: { activeCount: 0, states: [] },
  sharedSafety: []
};

let cachedPoolRetrySettings: {
  retryCount: number;
  retryDelayMs: number;
  expiresAt: number;
} | null = null;
let cachedMetricsDbSnapshot: {
  throttled: Array<{ id: string; name: string; throttleReason: string | null }>;
  throughputRows: Array<{ smtpaccountid: string; sent_last_minute: bigint }>;
  expiresAt: number;
} | null = null;
let metricsPullRunning = false;
let lastSchedulerDbDiagnosticsAt = 0;

async function getCachedPoolRetrySettings() {
  const now = Date.now();
  if (cachedPoolRetrySettings && cachedPoolRetrySettings.expiresAt > now) {
    return cachedPoolRetrySettings;
  }
  const poolSetting = await prisma.appSetting.findUnique({ where: { key: "smtp_pool_settings" } }).catch(() => null);
  const settings = ((poolSetting?.value as any) ?? {}) as {
    retryCount?: number;
    retryDelayMs?: number;
  };
  cachedPoolRetrySettings = {
    retryCount: Number(settings.retryCount ?? 5),
    retryDelayMs: Number(settings.retryDelayMs ?? 2000),
    expiresAt: now + workerSettingsCacheMs
  };
  return cachedPoolRetrySettings;
}

async function sampleWorkerMetrics() {
  if (metricsPullRunning) {
    return;
  }
  metricsPullRunning = true;
  try {
    await withDistributedLock("lock:worker-metrics-publisher", 2_500, async () => {
      const now = Date.now();
      const [queueCounts, retryCounts, deadCounts, waitingJobs, safetyStates] = await Promise.all([
        deliveryQueue.getJobCounts(),
        retryQueue.getJobCounts(),
        deadLetterQueue.getJobCounts(),
        deliveryQueue.getJobs(["waiting"], 0, 0, true),
        getAllSafetyStates()
      ]);
      const dbSnapshot = cachedMetricsDbSnapshot && cachedMetricsDbSnapshot.expiresAt > now
        ? cachedMetricsDbSnapshot
        : await (async () => {
            const [throttled, throughputRows] = await Promise.all([
              prisma.smtpAccount.findMany({
                where: { isThrottled: true },
                select: { id: true, name: true, throttleReason: true },
                take: 100
              }).catch(() => []),
              prisma.$queryRaw<Array<{ smtpaccountid: string; sent_last_minute: bigint }>>`
                SELECT c."smtpAccountId" as smtpaccountid, COUNT(*)::bigint as sent_last_minute
                FROM "CampaignLog" cl
                JOIN "Campaign" c ON c.id = cl."campaignId"
                WHERE cl."eventType" = 'sent' AND cl."createdAt" >= NOW() - INTERVAL '1 minute'
                GROUP BY c."smtpAccountId"
                ORDER BY sent_last_minute DESC
                LIMIT 20
              `.catch(() => [])
            ]);
            const next = {
              throttled,
              throughputRows,
              expiresAt: now + 30_000
            };
            cachedMetricsDbSnapshot = next;
            return next;
          })();

      const queueLagMs = waitingJobs.length > 0 ? Date.now() - waitingJobs[0].timestamp : 0;
      await sharedRedis.hset("metrics:queue", {
        lagMs: String(queueLagMs),
        deliveryCountsJson: JSON.stringify(queueCounts),
        retryCountsJson: JSON.stringify(retryCounts),
        deadCountsJson: JSON.stringify(deadCounts),
        updatedAt: String(Date.now())
      });
      await sharedRedis.hset("metrics:worker", {
        concurrency: String(workerConcurrency),
        updatedAt: String(Date.now())
      });
      await sharedRedis.set(
        "metrics:throughput",
        JSON.stringify(
          dbSnapshot.throughputRows.map((row: any) => ({
            smtpAccountId: row.smtpaccountid,
            sentLastMinute: Number(row.sent_last_minute)
          }))
        ),
        "EX",
        15
      );
      await sharedRedis.set("metrics:throttled", JSON.stringify(dbSnapshot.throttled), "EX", 15);
      await sharedRedis.set("metrics:shared-safety", JSON.stringify(safetyStates), "EX", 15);

      latestHealthSnapshot = {
        ok: true,
        service: "nexus-worker",
        ts: Date.now(),
        checks: { db: true, redis: true },
        worker: { concurrency: workerConcurrency },
        queue: {
          lagMs: queueLagMs,
          counts: {
            ...queueCounts,
            retryWaiting: retryCounts.waiting ?? 0,
            deadWaiting: deadCounts.waiting ?? 0
          }
        },
        smtpThrottle: { activeCount: dbSnapshot.throttled.length, states: dbSnapshot.throttled },
        sharedSafety: safetyStates
      };
    });
  } catch (error) {
    latestHealthSnapshot = {
      ...latestHealthSnapshot,
      ok: false,
      ts: Date.now(),
      error: (error as Error).message
    };
  } finally {
    metricsPullRunning = false;
  }
}

const healthServer = createServer(async (req, res) => {
  if (req.url !== "/health") {
    res.writeHead(404);
    res.end();
    return;
  }

  res.writeHead(latestHealthSnapshot.ok ? 200 : 503, { "Content-Type": "application/json" });
  res.end(JSON.stringify(latestHealthSnapshot));
});
healthServer.listen(Number(process.env.WORKER_HEALTH_PORT ?? 4050));

const workerMetricsInterval = setInterval(() => {
  void sampleWorkerMetrics();
}, 10_000);
void sampleWorkerMetrics();
void recoverAlibabaSyncJobs();
void recoverCampaignQueuesOnBoot();
const alibabaRecoveryInterval = setInterval(() => {
  void recoverAlibabaSyncJobs();
}, 60_000);

let schedulerRunning = false;
const schedulerInterval = setInterval(async () => {
  if (schedulerRunning) {
    console.warn("[scheduler] tick skipped because previous tick is still running");
    return;
  }
  schedulerRunning = true;
  try {
    const now = Date.now();
    if (now - lastSchedulerDbDiagnosticsAt > 60_000) {
      lastSchedulerDbDiagnosticsAt = now;
      console.info("[scheduler.db]", {
        tickMs: schedulerTickMs,
        batchSize: schedulerBatchSize,
        workerConcurrency,
        dbReadConcurrency: schedulerDbReadConcurrency,
        campaignTake: schedulerCampaignTake,
        cacheTtls: {
          settingsMs: workerSettingsCacheMs,
          smtpMs: workerSmtpCacheMs,
          campaignMs: workerCampaignCacheMs
        }
      });
    }
    const dispatchStats = await dispatchFairBatch(schedulerBatchSize);
    if ((dispatchStats.lastSchedulerEnqueued ?? 0) === 0 && (dispatchStats.dbPendingRecipients ?? 0) > 0) {
      console.warn("[scheduler.underfeeding]", dispatchStats);
    }
  } catch (error) {
    console.error("fair_scheduler_error", error);
  } finally {
    schedulerRunning = false;
  }
}, schedulerTickMs);

deliveryWorker.on("completed", async (job) => {
  await safeCreateCampaignLog({
    campaignId: job.data.campaignId,
    recipientId: job.data.recipientId,
    eventType: "worker_completed",
    status: "success",
    message: `job ${job.id} completed`
  });
});

deliveryWorker.on("failed", async (job, error) => {
  if (!job) {
    return;
  }
  const retrySettings = await getCachedPoolRetrySettings();
  const retryCount = retrySettings.retryCount;
  const retryDelayMs = retrySettings.retryDelayMs;
  const rateLimitRequeueDelayMs = Math.max(500, Number(process.env.RATE_LIMIT_REQUEUE_DELAY_MS ?? 5000));
  const isRateLimitedTimeout = (error?.message ?? "").includes("rate_limited_wait_timeout");
  const nextAttempt = Number(job.data.attempt ?? 1) + 1;
  if (nextAttempt <= retryCount) {
    const delay = isRateLimitedTimeout ? rateLimitRequeueDelayMs : retryDelayMs;
    await retryQueue.add("delivery_retry", {
      ...job.data,
      attempt: nextAttempt
    }, {
      delay
    });
    if (isRateLimitedTimeout) {
      await safeCreateCampaignLog({
        campaignId: job.data.campaignId,
        recipientId: job.data.recipientId,
        eventType: "rate_limited_delayed",
        status: "skipped",
        message: `rate limited, delayed ${delay}ms (attempt ${nextAttempt}/${retryCount})`
      });
      return;
    }
  } else {
    await deadLetterQueue.add("delivery_dead", job.data);
  }

  await safeCreateCampaignLog({
    campaignId: job.data.campaignId,
    recipientId: job.data.recipientId,
    eventType: "worker_failed",
    status: "failed",
    message: error instanceof Error ? error.message : String(error ?? "worker_failed")
  });
});

async function shutdown() {
  clearInterval(workerMetricsInterval);
  clearInterval(schedulerInterval);
  clearInterval(alibabaRecoveryInterval);
  await prisma.campaignRecipient.updateMany({
    where: {
      campaign: { status: { in: ["running", "queued", "partially_completed"] } },
      sendStatus: "queued"
    },
    data: { sendStatus: "pending" }
  }).catch(() => ({ count: 0 }));
  healthServer.close();
  await alibabaSyncWorker.close();
  await retryWorker.close();
  await deliveryWorker.close();
  await redis.quit();
  await prisma.$disconnect();
  await alibabaSuppressionSyncQueue.close();
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
