import { describe, expect, it, vi } from "vitest";

import { BrainStatusPublisher, statusChangeKey } from "./status-events.js";

/** Let the publisher's async sample settle. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("statusChangeKey", () => {
  it("ignores traffic counters, the log length, and slot context capacity", () => {
    const base = {
      state: "ready",
      telemetry: { requests: 1, ok: 1, warning: null },
      recent: [{ verdict: "ok" }],
      logLineCount: 10,
      slots: {
        total: 4,
        busy: 1,
        idle: 3,
        prefill: 0,
        decode: 1,
        contexts: [512],
        threads: [{ slot: 0, generatedTokens: 12 }],
      },
    };
    const churned = {
      state: "ready",
      telemetry: { requests: 900, ok: 900, warning: null },
      recent: [{ verdict: "ok" }, { verdict: "ok" }],
      logLineCount: 4000,
      slots: {
        total: 4,
        busy: 1,
        idle: 3,
        prefill: 0,
        decode: 1,
        contexts: [4096],
        threads: [{ slot: 0, generatedTokens: 12 }],
      },
    };
    expect(statusChangeKey(churned)).toBe(statusChangeKey(base));
  });

  it("treats bounded live token counters and rates as a change", () => {
    const earlier = {
      slots: { busy: 1, decode: 1, threads: [{ slot: 0, generatedTokens: 12 }] },
    };
    const later = {
      slots: {
        busy: 1,
        decode: 1,
        threads: [{ slot: 0, generatedTokens: 25, tokensPerSecond: 52 }],
      },
    };
    expect(statusChangeKey(later)).not.toBe(statusChangeKey(earlier));
  });

  it("treats aggregate inference-stage movement as a change", () => {
    const processing = { inference: { activeRequests: 1, processing: 1, thinking: 0 } };
    const thinking = { inference: { activeRequests: 1, processing: 0, thinking: 1 } };
    expect(statusChangeKey(thinking)).not.toBe(statusChangeKey(processing));
  });

  it("treats the slot phase split as a change", () => {
    const idle = { slots: { total: 4, busy: 0, idle: 4, prefill: 0, decode: 0 } };
    const decoding = { slots: { total: 4, busy: 1, idle: 3, prefill: 0, decode: 1 } };
    expect(statusChangeKey(decoding)).not.toBe(statusChangeKey(idle));
  });

  it("treats the reasoning-only warning as a change but not the totals behind it", () => {
    const clean = { telemetry: { requests: 3, warning: null } };
    const warned = { telemetry: { requests: 3, warning: "reasoning-only responses" } };
    expect(statusChangeKey(warned)).not.toBe(statusChangeKey(clean));
  });
});

describe("BrainStatusPublisher", () => {
  it("is not ready, and serves nothing, until a source is installed", () => {
    const publisher = new BrainStatusPublisher();
    expect(publisher.ready).toBe(false);
    publisher.setSource(async () => ({ state: "ready" }));
    expect(publisher.ready).toBe(true);
  });

  it("delivers a snapshot to a new subscriber", async () => {
    const publisher = new BrainStatusPublisher();
    publisher.setSource(async () => ({ state: "ready" }));
    const seen: unknown[] = [];
    publisher.subscribe((snapshot) => seen.push(snapshot));
    await flush();
    expect(seen).toEqual([{ state: "ready" }]);
  });

  it("emits once per real change and never for an unchanged sample", async () => {
    let state = "starting";
    let requests = 0;
    const publisher = new BrainStatusPublisher();
    publisher.setSource(async () => ({ state, telemetry: { requests: (requests += 1) } }));
    const seen: string[] = [];
    publisher.subscribe((snapshot) => seen.push(String(snapshot.state)));
    await flush();

    // Three samples over a brain whose only movement is its request counter.
    publisher.notify();
    await flush();
    publisher.notify();
    await flush();
    expect(seen).toEqual(["starting"]);

    state = "ready";
    publisher.notify();
    await flush();
    expect(seen).toEqual(["starting", "ready"]);
  });

  it("stops sampling once the last listener goes away", async () => {
    const source = vi.fn(async () => ({ state: "ready" }));
    const publisher = new BrainStatusPublisher();
    publisher.setSource(source);
    const unsubscribe = publisher.subscribe(() => {});
    await flush();
    const sampledWhileSubscribed = source.mock.calls.length;
    expect(sampledWhileSubscribed).toBeGreaterThan(0);

    unsubscribe();
    publisher.notify();
    await flush();
    expect(source.mock.calls.length).toBe(sampledWhileSubscribed);
  });

  it("replays the last snapshot to a second subscriber without waiting for a change", async () => {
    const publisher = new BrainStatusPublisher();
    publisher.setSource(async () => ({ state: "ready" }));
    publisher.subscribe(() => {});
    await flush();

    const seen: unknown[] = [];
    publisher.subscribe((snapshot) => seen.push(snapshot));
    expect(seen).toEqual([{ state: "ready" }]);
  });

  it("ends every stream on close, so the host can stop", async () => {
    const publisher = new BrainStatusPublisher();
    publisher.setSource(async () => ({ state: "ready" }));
    const closed: string[] = [];
    publisher.subscribe(
      () => {},
      () => closed.push("first"),
    );
    publisher.subscribe(
      () => {},
      () => closed.push("second"),
    );
    await flush();

    publisher.close();
    expect(closed).toEqual(["first", "second"]);
    expect(publisher.ready).toBe(false);
    expect(publisher.listenerCount).toBe(0);
  });

  it("closes a subscriber that arrives after shutdown rather than leaving it open", () => {
    const publisher = new BrainStatusPublisher();
    publisher.setSource(async () => ({ state: "ready" }));
    publisher.close();
    const closed = vi.fn();
    publisher.subscribe(() => {}, closed);
    expect(closed).toHaveBeenCalledOnce();
  });

  it("survives a listener that throws", async () => {
    const publisher = new BrainStatusPublisher();
    publisher.setSource(async () => ({ state: "ready" }));
    const seen: unknown[] = [];
    publisher.subscribe(() => {
      throw new Error("boom");
    });
    publisher.subscribe((snapshot) => seen.push(snapshot));
    await flush();
    expect(seen).toEqual([{ state: "ready" }]);
  });
});

describe("BrainStatusPublisher sampling cadence", () => {
  /**
   * The brain is the heaviest process on the machine and `/slots` is served off
   * llama-server's own task queue, so an idle engine must not be polled at the
   * cadence a generating one needs.
   */
  it("backs off while idle and speeds up again when work arrives", async () => {
    vi.useFakeTimers();
    try {
      let snapshot: Record<string, unknown> = { state: "ready", queued: 0 };
      let samples = 0;
      const publisher = new BrainStatusPublisher({
        sampleIntervalMs: 100,
        idleIntervalMs: 1_000,
      });
      publisher.setSource(async () => {
        samples += 1;
        return snapshot;
      });
      publisher.subscribe(() => {});
      await vi.advanceTimersByTimeAsync(0);

      samples = 0;
      await vi.advanceTimersByTimeAsync(1_000);
      // An idle brain: one sample for the second that passed, not ten.
      expect(samples).toBeLessThanOrEqual(2);

      // Work arrives. The stage change pushes a notify rather than waiting for
      // the timer, and the cadence tightens from that sample on.
      snapshot = { state: "ready", queued: 0, inference: { activeRequests: 1, generating: 1 } };
      publisher.notify();
      await vi.advanceTimersByTimeAsync(0);
      samples = 0;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(samples).toBeGreaterThanOrEqual(8);

      // Back to idle: the cadence relaxes again rather than staying hot.
      snapshot = { state: "ready", queued: 0 };
      publisher.notify();
      await vi.advanceTimersByTimeAsync(0);
      samples = 0;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(samples).toBeLessThanOrEqual(2);

      publisher.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats a queued job and a running operation as busy", async () => {
    vi.useFakeTimers();
    try {
      for (const busy of [
        { state: "ready", queued: 2 },
        { state: "ready", queued: 0, activity: { kind: "calibrate" } },
        { state: "starting", queued: 0 },
      ]) {
        let samples = 0;
        const publisher = new BrainStatusPublisher({
          sampleIntervalMs: 100,
          idleIntervalMs: 1_000,
        });
        publisher.setSource(async () => {
          samples += 1;
          return busy;
        });
        publisher.subscribe(() => {});
        await vi.advanceTimersByTimeAsync(0);
        samples = 0;
        await vi.advanceTimersByTimeAsync(1_000);
        expect(samples, JSON.stringify(busy)).toBeGreaterThanOrEqual(8);
        publisher.close();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops sampling entirely once the last subscriber leaves", async () => {
    vi.useFakeTimers();
    try {
      let samples = 0;
      const publisher = new BrainStatusPublisher({ sampleIntervalMs: 100, idleIntervalMs: 1_000 });
      publisher.setSource(async () => {
        samples += 1;
        return { state: "ready", queued: 0, inference: { activeRequests: 1 } };
      });
      const unsubscribe = publisher.subscribe(() => {});
      await vi.advanceTimersByTimeAsync(0);
      unsubscribe();
      samples = 0;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(samples).toBe(0);
      publisher.close();
    } finally {
      vi.useRealTimers();
    }
  });
});
