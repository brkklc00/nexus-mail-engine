import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { createServer } from "node:http";
import { prisma } from "@nexus/db";
import {
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
import { getAllSafetyStates } from "./safety/distributed-safety.service.js";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null
});

const deliveryWorker = new Worker(QUEUE_NAMES.DELIVERY, processDelivery, {
  connection: redis,
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 8)
});

const retryWorker = new Worker(QUEUE_NAMES.RETRY, processRetry, {
  connection: redis,
  concurrency: Math.max(1, Math.floor(Number(process.env.WORKER_CONCURRENCY ?? 8) / 2))
});

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
  worker: { concurrency: Number(process.env.WORKER_CONCURRENCY ?? 8) },
  queue: { lagMs: 0, counts: {} as Record<string, number> },
  smtpThrottle: { activeCount: 0, states: [] },
  sharedSafety: []
};

async function sampleWorkerMetrics() {
  try {
    await withDistributedLock("lock:worker-metrics-publisher", 2_500, async () => {
      const [queueCounts, retryCounts, deadCounts, waitingJobs, throttled, safetyStates, throughputRows] =
        await Promise.all([
        deliveryQueue.getJobCounts(),
        retryQueue.getJobCounts(),
        deadLetterQueue.getJobCounts(),
        deliveryQueue.getJobs(["waiting"], 0, 0, true),
        prisma.smtpAccount.findMany({
          where: { isThrottled: true },
          select: { id: true, name: true, throttleReason: true }
        }),
        getAllSafetyStates(),
        prisma.$queryRaw<Array<{ smtpaccountid: string; sent_last_minute: bigint }>>`
          SELECT c."smtpAccountId" as smtpaccountid, COUNT(*)::bigint as sent_last_minute
          FROM "CampaignLog" cl
          JOIN "Campaign" c ON c.id = cl."campaignId"
          WHERE cl."eventType" = 'sent' AND cl."createdAt" >= NOW() - INTERVAL '1 minute'
          GROUP BY c."smtpAccountId"
          ORDER BY sent_last_minute DESC
        `
        ]);

      const queueLagMs = waitingJobs.length > 0 ? Date.now() - waitingJobs[0].timestamp : 0;
      await sharedRedis.hset("metrics:queue", {
        lagMs: String(queueLagMs),
        deliveryCountsJson: JSON.stringify(queueCounts),
        retryCountsJson: JSON.stringify(retryCounts),
        deadCountsJson: JSON.stringify(deadCounts),
        updatedAt: String(Date.now())
      });
      await sharedRedis.hset("metrics:worker", {
        concurrency: String(Number(process.env.WORKER_CONCURRENCY ?? 8)),
        updatedAt: String(Date.now())
      });
      await sharedRedis.set(
        "metrics:throughput",
        JSON.stringify(
          throughputRows.map((row: any) => ({
            smtpAccountId: row.smtpaccountid,
            sentLastMinute: Number(row.sent_last_minute)
          }))
        ),
        "EX",
        15
      );
      await sharedRedis.set("metrics:throttled", JSON.stringify(throttled), "EX", 15);
      await sharedRedis.set("metrics:shared-safety", JSON.stringify(safetyStates), "EX", 15);

      latestHealthSnapshot = {
        ok: true,
        service: "nexus-worker",
        ts: Date.now(),
        checks: { db: true, redis: true },
        worker: { concurrency: Number(process.env.WORKER_CONCURRENCY ?? 8) },
        queue: {
          lagMs: queueLagMs,
          counts: {
            ...queueCounts,
            retryWaiting: retryCounts.waiting ?? 0,
            deadWaiting: deadCounts.waiting ?? 0
          }
        },
        smtpThrottle: { activeCount: throttled.length, states: throttled },
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
}, 3000);
void sampleWorkerMetrics();

const schedulerInterval = setInterval(async () => {
  try {
    await dispatchFairBatch(Number(process.env.SCHEDULER_BATCH_SIZE ?? 50));
  } catch (error) {
    console.error("fair_scheduler_error", error);
  }
}, Number(process.env.SCHEDULER_TICK_MS ?? 1500));

deliveryWorker.on("completed", async (job) => {
  await prisma.campaignLog.create({
    data: {
      campaignId: job.data.campaignId,
      recipientId: job.data.recipientId,
      eventType: "worker_completed",
      status: "success",
      message: `job ${job.id} completed`
    }
  });
});

deliveryWorker.on("failed", async (job, error) => {
  if (!job) {
    return;
  }
  const nextAttempt = Number(job.data.attempt ?? 1) + 1;
  if (nextAttempt <= 5) {
    await retryQueue.add("delivery_retry", {
      ...job.data,
      attempt: nextAttempt
    });
  } else {
    await deadLetterQueue.add("delivery_dead", job.data);
  }

  await prisma.campaignLog.create({
    data: {
      campaignId: job.data.campaignId,
      recipientId: job.data.recipientId,
      eventType: "worker_failed",
      status: "failed",
      message: error.message
    }
  });
});

async function shutdown() {
  clearInterval(workerMetricsInterval);
  clearInterval(schedulerInterval);
  healthServer.close();
  await retryWorker.close();
  await deliveryWorker.close();
  await redis.quit();
  await prisma.$disconnect();
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
