type CacheRecord<T> = {
  value: T;
  expiresAt: number;
};

const cache = new Map<string, CacheRecord<unknown>>();

export async function withMetricsCache<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const existing = cache.get(key) as CacheRecord<T> | undefined;
  if (existing && existing.expiresAt > now) {
    return existing.value;
  }
  const value = await loader();
  cache.set(key, { value, expiresAt: now + ttlMs });
  return value;
}
