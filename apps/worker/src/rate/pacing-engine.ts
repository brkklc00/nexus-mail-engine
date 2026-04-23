import { TokenBucket } from "@nexus/rate-control";

const buckets = new Map<string, TokenBucket>();
const rates = new Map<string, number>();

export function canDispatch(providerKey: string, ratePerSecond: number): boolean {
  const existing = buckets.get(providerKey);
  const prevRate = rates.get(providerKey);
  if (!existing || prevRate !== ratePerSecond) {
    const bucket = new TokenBucket(ratePerSecond, Math.max(1, ratePerSecond));
    buckets.set(providerKey, bucket);
    rates.set(providerKey, ratePerSecond);
    return bucket.tryTake(1);
  }
  return existing.tryTake(1);
}
