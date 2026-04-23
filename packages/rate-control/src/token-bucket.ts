export class TokenBucket {
  private tokens: number;
  private lastRefillTs: number;

  constructor(
    private readonly ratePerSecond: number,
    private readonly capacity: number
  ) {
    this.tokens = capacity;
    this.lastRefillTs = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefillTs) / 1000;
    this.lastRefillTs = now;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.ratePerSecond);
  }

  tryTake(tokens = 1): boolean {
    this.refill();
    if (this.tokens < tokens) {
      return false;
    }
    this.tokens -= tokens;
    return true;
  }
}
