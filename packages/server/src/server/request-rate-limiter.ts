export interface FixedWindowRateLimiterOptions {
  maxRequests: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface RateLimitBucket {
  count: number;
  startedAt: number;
}

/**
 * A small process-local fixed-window limiter for daemon HTTP endpoints. It is
 * deliberately keyed by the socket peer rather than forwarded headers: Otto
 * does not trust an arbitrary HTTP proxy to establish client identity.
 */
export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();
  private nextCleanupAt = 0;

  constructor(private readonly options: FixedWindowRateLimiterOptions) {}

  take(key: string, now = Date.now()): RateLimitResult {
    this.cleanupExpiredBuckets(now);

    const existing = this.buckets.get(key);
    if (!existing || now - existing.startedAt >= this.options.windowMs) {
      this.buckets.set(key, { count: 1, startedAt: now });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const remainingMs = Math.max(0, this.options.windowMs - (now - existing.startedAt));
    if (existing.count >= this.options.maxRequests) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)) };
    }

    existing.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private cleanupExpiredBuckets(now: number): void {
    if (now < this.nextCleanupAt) return;
    this.nextCleanupAt = now + this.options.windowMs;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.startedAt >= this.options.windowMs) {
        this.buckets.delete(key);
      }
    }
  }
}
