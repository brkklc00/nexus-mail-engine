import { NextResponse } from "next/server";
import { prisma } from "@nexus/db";
import { getRedisConnection } from "@nexus/queue";
import { getQueueObservability } from "@/server/observability/queue-observability.service";
import { withMetricsCache } from "@/server/observability/metrics-cache";

export async function GET() {
  const redis = getRedisConnection();
  try {
    const [dbCheck, redisCheck, queueObs] = await Promise.all([
      withMetricsCache("health_db", 3000, () => prisma.$queryRaw`SELECT 1`),
      withMetricsCache("health_redis", 3000, () => redis.ping()),
      getQueueObservability()
    ]);

    const workerOk = await withMetricsCache("health_worker", 3000, async () => {
      try {
        const workerUrl = process.env.WORKER_HEALTH_URL ?? "http://worker:4050/health";
        const response = await fetch(workerUrl);
        return response.ok;
      } catch {
        return false;
      }
    });

    return NextResponse.json({
      ok: Boolean(dbCheck) && redisCheck === "PONG" && workerOk,
      service: "nexus-web",
      timestamp: new Date().toISOString(),
      checks: {
        db: true,
        redis: redisCheck === "PONG",
        worker: workerOk
      },
      queue: {
        lagMs: queueObs.latencyMs,
        counts: queueObs.deliveryCounts
      },
      smtpThrottle: {
        activeCount: queueObs.throttledStates.length,
        states: queueObs.throttledStates
      },
      sharedSafety: {
        activeCount: queueObs.sharedSafety.length,
        states: queueObs.sharedSafety
      }
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        service: "nexus-web"
      },
      { status: 503 }
    );
  }
}
