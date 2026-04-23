import type { EffectiveRateDecision } from "@nexus/domain";

export type WarmupTier = {
  name: string;
  minDelivered: number;
  ratePerSecond: number;
};

export type EffectiveRateInput = {
  smtpHost: string;
  targetRatePerSecond: number;
  maxRatePerSecond?: number | null;
  alibabaRateCap?: number | null;
  alibabaWarmupMaxRatePerSecond?: number | null;
  deliveredSuccessCount: number;
  warmupLadder: WarmupTier[];
};

const ALIBABA_HOST_PATTERN = /(aliyun|alibaba|aliyuncs\.com)/i;

export function isAlibabaProvider(host: string): boolean {
  return ALIBABA_HOST_PATTERN.test(host);
}

export function resolveWarmupTier(
  deliveredSuccessCount: number,
  ladder: WarmupTier[]
): { current?: WarmupTier; next?: WarmupTier } {
  const sorted = [...ladder].sort((a, b) => a.minDelivered - b.minDelivered);
  let current: WarmupTier | undefined;

  for (const tier of sorted) {
    if (deliveredSuccessCount >= tier.minDelivered) {
      current = tier;
      continue;
    }
    return { current, next: tier };
  }

  return { current, next: undefined };
}

export function calculateEffectiveRate(input: EffectiveRateInput): EffectiveRateDecision {
  const reasons: string[] = [];
  const isAlibaba = isAlibabaProvider(input.smtpHost);
  let effective = input.targetRatePerSecond;

  if (isAlibaba && input.alibabaRateCap) {
    effective = Math.min(effective, input.alibabaRateCap);
    reasons.push("alibaba_rate_cap");
  }

  if (input.maxRatePerSecond) {
    effective = Math.min(effective, input.maxRatePerSecond);
    reasons.push("max_rate_per_second");
  }

  const { current, next } = resolveWarmupTier(input.deliveredSuccessCount, input.warmupLadder);

  if (isAlibaba && current) {
    effective = Math.min(effective, current.ratePerSecond);
    reasons.push("alibaba_warmup_tier");
  }

  if (isAlibaba && input.alibabaWarmupMaxRatePerSecond) {
    effective = Math.min(effective, input.alibabaWarmupMaxRatePerSecond);
    reasons.push("alibaba_warmup_max_rate_per_second");
  }

  return {
    effectiveRatePerSecond: Math.max(0.01, Number(effective.toFixed(4))),
    reasons,
    warmupTierName: current?.name,
    nextTierName: next?.name
  };
}
