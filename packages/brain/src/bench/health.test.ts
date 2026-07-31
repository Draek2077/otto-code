import { test } from "vitest";
import assert from "node:assert/strict";

import { summarize } from "./health.js";

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
