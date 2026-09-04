import { describe, expect, test } from "vitest";

import { FixedWindowRateLimiter } from "./request-rate-limiter.js";

describe("FixedWindowRateLimiter", () => {
  test("limits a client within a window and resets at the next window", () => {
    const limiter = new FixedWindowRateLimiter({ maxRequests: 2, windowMs: 1_000 });

    expect(limiter.take("127.0.0.1", 10_000)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(limiter.take("127.0.0.1", 10_001)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(limiter.take("127.0.0.1", 10_250)).toEqual({ allowed: false, retryAfterSeconds: 1 });
    expect(limiter.take("127.0.0.1", 11_000)).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  test("keeps independent client budgets", () => {
    const limiter = new FixedWindowRateLimiter({ maxRequests: 1, windowMs: 1_000 });

    expect(limiter.take("127.0.0.1", 10_000).allowed).toBe(true);
    expect(limiter.take("127.0.0.1", 10_001).allowed).toBe(false);
    expect(limiter.take("::1", 10_001).allowed).toBe(true);
  });
});
