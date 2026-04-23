import { Queue, QueueEvents, type JobsOptions } from "bullmq";
import crypto from "node:crypto";
import IORedis from "ioredis";

export const QUEUE_NAMES = {
  CAMPAIGN: "campaign_queue",
  DELIVERY: "delivery_queue",
  RETRY: "retry_queue",
  DEAD_LETTER: "dead_letter_queue"
} as const;

export type CampaignDispatchJob = {
  campaignId: string;
  trigger: "schedule" | "resume" | "manual";
};

export type DeliveryJob = {
  campaignId: string;
  recipientId: string;
  templateId: string;
  smtpAccountId: string;
  idempotencyKey: string;
  attempt: number;
};

export const defaultJobOptions: JobsOptions = {
  removeOnComplete: 5000,
  removeOnFail: 10000,
  attempts: 5,
  backoff: {
    type: "exponential",
    delay: 2000
  }
};

const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null
});

export function getRedisConnection() {
  return redis;
}

export const campaignQueue = new Queue<CampaignDispatchJob>(QUEUE_NAMES.CAMPAIGN, {
  connection: redis,
  defaultJobOptions
});

export const deliveryQueue = new Queue<DeliveryJob>(QUEUE_NAMES.DELIVERY, {
  connection: redis,
  defaultJobOptions
});

export const retryQueue = new Queue<DeliveryJob>(QUEUE_NAMES.RETRY, {
  connection: redis,
  defaultJobOptions
});

export const deadLetterQueue = new Queue<DeliveryJob>(QUEUE_NAMES.DEAD_LETTER, {
  connection: redis,
  defaultJobOptions: {
    ...defaultJobOptions,
    attempts: 1
  }
});

export const queueEvents = {
  delivery: new QueueEvents(QUEUE_NAMES.DELIVERY, { connection: redis }),
  campaign: new QueueEvents(QUEUE_NAMES.CAMPAIGN, { connection: redis })
};

async function releaseLockIfOwned(key: string, token: string) {
  const script = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    end
    return 0
  `;
  await redis.eval(script, 1, key, token);
}

export async function withDistributedLock<T>(
  key: string,
  ttlMs: number,
  callback: () => Promise<T>
): Promise<T> {
  const token = crypto.randomUUID();
  const acquired = await redis.set(key, token, "PX", ttlMs, "NX");
  if (acquired !== "OK") {
    throw new Error("lock_not_acquired");
  }
  try {
    return await callback();
  } finally {
    await releaseLockIfOwned(key, token);
  }
}
