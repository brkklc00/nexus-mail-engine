import { prisma } from "@nexus/db";
import { getRedisConnection } from "@nexus/queue";

const WINDOW_SECONDS = 120;
const THROTTLE_MIN_MS = 30_000;
const THROTTLE_MAX_MS = 5 * 60_000;
const THROTTLE_BACKOFF = 1.8;
const FAIL_RATE_THRESHOLD = 0.12;
const RECOVERY_THRESHOLD = 0.04;

type SafetyState = {
  total: number;
  failures: number;
  throttleLevel: number;
  throttledUntil: number;
};

const redis = getRedisConnection();

function key(smtpAccountId: string) {
  return `smtp:safety:${smtpAccountId}`;
}

async function readState(smtpAccountId: string): Promise<SafetyState> {
  const raw = await redis.hgetall(key(smtpAccountId));
  return {
    total: Number(raw.total ?? 0),
    failures: Number(raw.failures ?? 0),
    throttleLevel: Number(raw.throttleLevel ?? 0),
    throttledUntil: Number(raw.throttledUntil ?? 0)
  };
}

async function writeState(smtpAccountId: string, state: SafetyState) {
  await redis.hset(key(smtpAccountId), {
    total: String(state.total),
    failures: String(state.failures),
    throttleLevel: String(state.throttleLevel),
    throttledUntil: String(state.throttledUntil)
  });
  await redis.expire(key(smtpAccountId), WINDOW_SECONDS);
}

export async function recordDeliveryOutcome(smtpAccountId: string, isFailure: boolean) {
  const state = await readState(smtpAccountId);
  state.total += 1;
  if (isFailure) state.failures += 1;
  const failRate = state.total > 0 ? state.failures / state.total : 0;
  const now = Date.now();

  if (failRate >= FAIL_RATE_THRESHOLD) {
    state.throttleLevel = Math.min(state.throttleLevel + 1, 6);
    const duration = Math.min(
      THROTTLE_MAX_MS,
      Math.floor(THROTTLE_MIN_MS * THROTTLE_BACKOFF ** Math.max(0, state.throttleLevel - 1))
    );
    state.throttledUntil = now + duration;
    await prisma.smtpAccount.update({
      where: { id: smtpAccountId },
      data: {
        isThrottled: true,
        throttleReason: `shared_safety_fail_rate_${failRate.toFixed(2)}`
      }
    });
  } else if (failRate <= RECOVERY_THRESHOLD && now > state.throttledUntil) {
    state.throttleLevel = Math.max(0, state.throttleLevel - 1);
    if (state.throttleLevel === 0) {
      await prisma.smtpAccount.update({
        where: { id: smtpAccountId },
        data: {
          isThrottled: false,
          throttleReason: null
        }
      });
    }
  }

  await writeState(smtpAccountId, state);
}

export async function getSafetyState(smtpAccountId: string) {
  const state = await readState(smtpAccountId);
  const now = Date.now();
  return {
    ...state,
    isThrottled: state.throttledUntil > now,
    failRate: state.total > 0 ? state.failures / state.total : 0
  };
}

export async function applySafetyToRate(smtpAccountId: string, baseRate: number) {
  const state = await getSafetyState(smtpAccountId);
  if (!state.isThrottled || state.throttleLevel <= 0) {
    return {
      rate: baseRate,
      reason: null
    };
  }

  const multiplier = Math.max(0.1, 1 / (1 + state.throttleLevel));
  return {
    rate: Number((baseRate * multiplier).toFixed(4)),
    reason: `shared_safety_level_${state.throttleLevel}`
  };
}

export async function getAllSafetyStates() {
  const keys = await redis.keys("smtp:safety:*");
  const states = await Promise.all(
    keys.map(async (entry) => {
      const smtpAccountId = entry.split(":").at(-1) ?? "";
      const state = await getSafetyState(smtpAccountId);
      return { smtpAccountId, ...state };
    })
  );
  return states;
}
