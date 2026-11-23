import { afterEach, test, vi } from "vitest";
import assert from "node:assert/strict";

import { start, summarize, type GpuSample } from "./health.js";

afterEach(() => vi.useRealTimers());

test("summarize aggregates GPU/CPU/RAM and flags throttling", () => {
  const s = summarize({
    gpu: [
      {
        util: 90,
        temp: 60,
        power: 400,
        clock: 2500,
        vramMiB: 20000,
        thermal: false,
        powerBrake: false,
      },
      {
        util: 100,
        temp: 72,
        power: 500,
        clock: 2400,
        vramMiB: 21000,
        thermal: true,
        powerBrake: false,
      },
    ],
    cpu: [20, 40],
    ram: [8e9, 9e9],
  });

  assert.equal(s.samples, 2);
  assert.equal(s.gpuUtilPct!.max, 100);
  assert.equal(s.tempC!.max, 72);
  assert.equal(s.powerW!.avg, 450);
  assert.equal(s.clockMHz!.min, 2400);
  assert.equal(s.cpuPct!.avg, 30);
  assert.equal(s.thermalThrottle, true, "a thermal-active sample flags throttling");
  assert.equal(s.powerThrottle, false);
});

test("summarize degrades to empty aggregates with no samples", () => {
  const s = summarize({ gpu: [], cpu: [], ram: [] });
  assert.equal(s.samples, 0);
  assert.equal(s.tempC, null);
  assert.equal(s.thermalThrottle, false);
});

test("sampling never overlaps slow probes or publishes after stop", async () => {
  vi.useFakeTimers();
  let finish!: (sample: GpuSample | null) => void;
  let calls = 0;
  let signal: AbortSignal | undefined;
  const handle = start({
    intervalMs: 100,
    cpu: () => 0.5,
    ram: () => 100,
    gpu: (cancellation) => {
      calls++;
      signal = cancellation;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  await vi.advanceTimersByTimeAsync(1000);
  assert.equal(calls, 1);
  assert.equal(handle.stop().samples, 0);
  assert.equal(signal?.aborted, true);
  finish({
    util: 50,
    temp: 60,
    power: 100,
    clock: 1000,
    vramMiB: 100,
    thermal: false,
    powerBrake: false,
  });
  await vi.advanceTimersByTimeAsync(1000);
  assert.equal(handle.stop().samples, 0);
  assert.equal(calls, 1);
});

test("failed diagnostic probes are contained and later ticks recover", async () => {
  vi.useFakeTimers();
  let calls = 0;
  const handle = start({
    intervalMs: 100,
    cpu: () => 0.5,
    ram: () => 100,
    gpu: async () => {
      if (calls++ === 0) throw new Error("fixture unavailable");
      return null;
    },
  });
  await vi.advanceTimersByTimeAsync(100);
  const summary = handle.stop();
  assert.equal(calls, 2);
  assert.equal(summary.cpuPct?.avg, 50);
  assert.equal(summary.ramUsedBytes?.avg, 100);
});
