import { getRedisConnection } from "@nexus/queue";
import { withMetricsCache } from "./metrics-cache";

export async function getQueueObservability() {
  const redis = getRedisConnection();
  return withMetricsCache("queue_observability", 2000, async () => {
    const [queueHash, workerHash, throughputJson, throttledJson, sharedSafetyJson] = await Promise.all([
      redis.hgetall("metrics:queue"),
      redis.hgetall("metrics:worker"),
      redis.get("metrics:throughput"),
      redis.get("metrics:throttled"),
      redis.get("metrics:shared-safety")
    ]);

    return {
      deliveryCounts: JSON.parse(queueHash.deliveryCountsJson ?? "{}"),
      retryCounts: JSON.parse(queueHash.retryCountsJson ?? "{}"),
      deadCounts: JSON.parse(queueHash.deadCountsJson ?? "{}"),
      latencyMs: Number(queueHash.lagMs ?? 0),
      workerConcurrency: Number(workerHash.concurrency ?? 0),
      throughputBySmtp: throughputJson ? JSON.parse(throughputJson) : [],
      throttledStates: throttledJson ? JSON.parse(throttledJson) : [],
      sharedSafety: sharedSafetyJson ? JSON.parse(sharedSafetyJson) : []
    };
  });
}
