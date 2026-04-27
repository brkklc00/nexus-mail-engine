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

type MinimalRedisClient = {
  ping: () => Promise<string>;
  hgetall: (key: string) => Promise<Record<string, string>>;
  hset: (key: string, value: Record<string, string>) => Promise<number>;
  set: (...args: (string | number)[]) => Promise<string | null>;
  get: (key: string) => Promise<string | null>;
  keys: (pattern: string) => Promise<string[]>;
  expire: (key: string, seconds: number) => Promise<number>;
  eval: (script: string, numKeys: number, ...args: string[]) => Promise<number>;
  quit: () => Promise<string>;
};

function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build" || process.env.BUILD_TIME === "true";
}

function shouldUseNoopRedis(): boolean {
  return isBuildPhase() || !process.env.REDIS_URL;
}

const noopRedisClient: MinimalRedisClient = {
  async ping() {
    return "NOOP";
  },
  async hgetall() {
    return {};
  },
  async hset() {
    return 0;
  },
  async set() {
    return "OK";
  },
  async get() {
    return null;
  },
  async keys() {
    return [];
  },
  async expire() {
    return 0;
  },
  async eval() {
    return 0;
  },
  async quit() {
    return "OK";
  }
};

let redisClient: MinimalRedisClient | null = null;
function getOrCreateRedisClient(): MinimalRedisClient {
  if (redisClient) {
    return redisClient;
  }

  if (shouldUseNoopRedis()) {
    redisClient = noopRedisClient;
    return redisClient;
  }

  redisClient = new IORedis(process.env.REDIS_URL as string, {
    maxRetriesPerRequest: null
  }) as unknown as MinimalRedisClient;
  return redisClient;
}

export function getRedisClient() {
  return getOrCreateRedisClient();
}

export function getRedisConnection() {
  return getOrCreateRedisClient();
}

type MinimalQueue<T> = {
  add: (name: string, data: T, options?: { jobId?: string; delay?: number }) => Promise<unknown>;
  getJobCounts: () => Promise<Record<string, number>>;
  getJobs: (
    types?: any,
    start?: number,
    end?: number,
    asc?: boolean
  ) => Promise<Array<{ timestamp: number }>>;
};

const noopQueue = {
  async add() {
    return null;
  },
  async getJobCounts() {
    return {};
  },
  async getJobs(_types?: any, _start?: number, _end?: number, _asc?: boolean) {
    return [];
  }
};

let campaignQueueInstance: Queue<CampaignDispatchJob> | null = null;
let deliveryQueueInstance: Queue<DeliveryJob> | null = null;
let retryQueueInstance: Queue<DeliveryJob> | null = null;
let deadLetterQueueInstance: Queue<DeliveryJob> | null = null;
let campaignQueueEventsInstance: QueueEvents | null = null;
let deliveryQueueEventsInstance: QueueEvents | null = null;

function getCampaignQueue(): MinimalQueue<CampaignDispatchJob> {
  if (shouldUseNoopRedis()) return noopQueue;
  if (!campaignQueueInstance) {
    campaignQueueInstance = new Queue<CampaignDispatchJob>(QUEUE_NAMES.CAMPAIGN, {
      connection: getOrCreateRedisClient() as unknown as IORedis,
      defaultJobOptions
    });
  }
  return campaignQueueInstance;
}

function getDeliveryQueue(): MinimalQueue<DeliveryJob> {
  if (shouldUseNoopRedis()) return noopQueue;
  if (!deliveryQueueInstance) {
    deliveryQueueInstance = new Queue<DeliveryJob>(QUEUE_NAMES.DELIVERY, {
      connection: getOrCreateRedisClient() as unknown as IORedis,
      defaultJobOptions
    });
  }
  return deliveryQueueInstance;
}

function getRetryQueue(): MinimalQueue<DeliveryJob> {
  if (shouldUseNoopRedis()) return noopQueue;
  if (!retryQueueInstance) {
    retryQueueInstance = new Queue<DeliveryJob>(QUEUE_NAMES.RETRY, {
      connection: getOrCreateRedisClient() as unknown as IORedis,
      defaultJobOptions
    });
  }
  return retryQueueInstance;
}

function getDeadLetterQueue(): MinimalQueue<DeliveryJob> {
  if (shouldUseNoopRedis()) return noopQueue;
  if (!deadLetterQueueInstance) {
    deadLetterQueueInstance = new Queue<DeliveryJob>(QUEUE_NAMES.DEAD_LETTER, {
      connection: getOrCreateRedisClient() as unknown as IORedis,
      defaultJobOptions: {
        ...defaultJobOptions,
        attempts: 1
      }
    });
  }
  return deadLetterQueueInstance;
}

export const campaignQueue = {
  add: (...args: Parameters<MinimalQueue<CampaignDispatchJob>["add"]>) => getCampaignQueue().add(...args),
  getJobCounts: () => getCampaignQueue().getJobCounts(),
  getJobs: (...args: Parameters<MinimalQueue<CampaignDispatchJob>["getJobs"]>) =>
    getCampaignQueue().getJobs(...args)
};

export const deliveryQueue = {
  add: (...args: Parameters<MinimalQueue<DeliveryJob>["add"]>) => getDeliveryQueue().add(...args),
  getJobCounts: () => getDeliveryQueue().getJobCounts(),
  getJobs: (...args: Parameters<MinimalQueue<DeliveryJob>["getJobs"]>) => getDeliveryQueue().getJobs(...args)
};

export const retryQueue = {
  add: (...args: Parameters<MinimalQueue<DeliveryJob>["add"]>) => getRetryQueue().add(...args),
  getJobCounts: () => getRetryQueue().getJobCounts(),
  getJobs: (...args: Parameters<MinimalQueue<DeliveryJob>["getJobs"]>) => getRetryQueue().getJobs(...args)
};

export const deadLetterQueue = {
  add: (...args: Parameters<MinimalQueue<DeliveryJob>["add"]>) => getDeadLetterQueue().add(...args),
  getJobCounts: () => getDeadLetterQueue().getJobCounts(),
  getJobs: (...args: Parameters<MinimalQueue<DeliveryJob>["getJobs"]>) =>
    getDeadLetterQueue().getJobs(...args)
};

export const queueEvents = {
  get delivery() {
    if (shouldUseNoopRedis()) return null;
    if (!deliveryQueueEventsInstance) {
      deliveryQueueEventsInstance = new QueueEvents(QUEUE_NAMES.DELIVERY, {
        connection: getOrCreateRedisClient() as unknown as IORedis
      });
    }
    return deliveryQueueEventsInstance;
  },
  get campaign() {
    if (shouldUseNoopRedis()) return null;
    if (!campaignQueueEventsInstance) {
      campaignQueueEventsInstance = new QueueEvents(QUEUE_NAMES.CAMPAIGN, {
        connection: getOrCreateRedisClient() as unknown as IORedis
      });
    }
    return campaignQueueEventsInstance;
  }
};

async function releaseLockIfOwned(key: string, token: string) {
  if (shouldUseNoopRedis()) {
    return;
  }
  const script = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    end
    return 0
  `;
  await getOrCreateRedisClient().eval(script, 1, key, token);
}

export async function withDistributedLock<T>(
  key: string,
  ttlMs: number,
  callback: () => Promise<T>
): Promise<T> {
  if (shouldUseNoopRedis()) {
    return callback();
  }
  const token = crypto.randomUUID();
  const acquired = await getOrCreateRedisClient().set(key, token, "PX", ttlMs, "NX");
  if (acquired !== "OK") {
    throw new Error("lock_not_acquired");
  }
  try {
    return await callback();
  } finally {
    await releaseLockIfOwned(key, token);
  }
}
