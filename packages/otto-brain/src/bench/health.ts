import os from "node:os";
import { execFile } from "node:child_process";

import { createCpuSampler } from "../sysmon.js";

/**
 * System-health sampling for a benchmark run.
 *
 * A score is only trustworthy if the machine was in a comparable state when it
 * was measured - a thermal-throttled or power-capped GPU produces a slower,
 * lower run that says nothing about the model. So we sample GPU/CPU/RAM through
 * the run and summarise it alongside the result, and flag when nvidia-smi itself
 * reports a thermal or power slowdown (more reliable than inferring one from a
 * clock dip, since the GPU also idles between tasks).
 */

const FIELDS = [
  "utilization.gpu",
  "temperature.gpu",
  "power.draw",
  "clocks.sm",
  "memory.used",
  "clocks_throttle_reasons.sw_thermal_slowdown",
  "clocks_throttle_reasons.hw_thermal_slowdown",
  "clocks_throttle_reasons.hw_power_brake_slowdown",
];

/** One nvidia-smi sample. */
export interface GpuSample {
  util: number | null;
  temp: number | null;
  power: number | null;
  clock: number | null;
  vramMiB: number | null;
  thermal: boolean;
  powerBrake: boolean;
}

/** Aggregate of a series of numeric samples. */
export interface Aggregate {
  avg: number;
  min: number;
  max: number;
}

/** Raw samples collected during a run. */
export interface HealthSamples {
  gpu: GpuSample[];
  cpu: number[];
  ram: number[];
}

/** Summary of system health across a run. */
export interface HealthSummary {
  samples: number;
  gpuUtilPct: Aggregate | null;
  tempC: Aggregate | null;
  powerW: Aggregate | null;
  clockMHz: Aggregate | null;
  vramUsedMiB: Aggregate | null;
  cpuPct: Aggregate | null;
  ramUsedBytes: Aggregate | null;
  thermalThrottle: boolean;
  powerThrottle: boolean;
}

/** A running sampler; call stop() to end it and get the summary. */
export interface HealthHandle {
  stop(): HealthSummary;
}

function sampleGpu(signal: AbortSignal): Promise<GpuSample | null> {
  return new Promise((resolve) => {
    execFile(
      "nvidia-smi",
      [`--query-gpu=${FIELDS.join(",")}`, "--format=csv,noheader,nounits"],
      { timeout: 4000, windowsHide: true, signal, maxBuffer: 64 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const line = String(stdout).trim().split(/\r?\n/)[0];
        if (!line) {
          resolve(null);
          return;
        }
        const c = line.split(",").map((s) => s.trim());
        const num = (v: string): number | null => {
          const n = Number(v);
          return Number.isFinite(n) ? n : null;
        };
        const active = (v: string): boolean => /active/i.test(v) && !/not\s*active/i.test(v);
        resolve({
          util: num(c[0]),
          temp: num(c[1]),
          power: num(c[2]),
          clock: num(c[3]),
          vramMiB: num(c[4]),
          thermal: active(c[5]) || active(c[6]),
          powerBrake: active(c[7]),
        });
      },
    );
  });
}

function agg(values: Array<number | null>): Aggregate | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return {
    avg: Math.round((sum / nums.length) * 10) / 10,
    min: Math.min(...nums),
    max: Math.max(...nums),
  };
}

/** Collapse raw samples into the summary stored on the result. */
export function summarize(samples: HealthSamples): HealthSummary {
  const gpu = samples.gpu || [];
  return {
    samples: gpu.length,
    gpuUtilPct: agg(gpu.map((s) => s.util)),
    tempC: agg(gpu.map((s) => s.temp)),
    powerW: agg(gpu.map((s) => s.power)),
    clockMHz: agg(gpu.map((s) => s.clock)),
    vramUsedMiB: agg(gpu.map((s) => s.vramMiB)),
    cpuPct: agg(samples.cpu || []),
    ramUsedBytes: agg(samples.ram || []),
    thermalThrottle: gpu.some((s) => s.thermal),
    powerThrottle: gpu.some((s) => s.powerBrake),
  };
}

/**
 * Begin sampling; returns a handle with stop() that returns the summary.
 * Sampling failures (no GPU, nvidia-smi missing) degrade to empty aggregates
 * rather than throwing - health is diagnostic, never a reason to fail a bench.
 */
export interface HealthOptions {
  intervalMs?: number;
  gpu?(signal: AbortSignal): Promise<GpuSample | null>;
  cpu?: ReturnType<typeof createCpuSampler>;
  ram?(): number;
}

export function start({
  intervalMs = 1000,
  gpu: readGpu = sampleGpu,
  cpu = createCpuSampler(),
  ram = () => os.totalmem() - os.freemem(),
}: HealthOptions = {}): HealthHandle {
  if (!Number.isFinite(intervalMs) || intervalMs < 100)
    throw new Error("Brain health sampling interval must be at least 100ms");
  const samples: HealthSamples = { gpu: [], cpu: [], ram: [] };
  cpu(); // establish the CPU baseline

  let stopped = false;
  let inFlight = false;
  const cancellation = new AbortController();
  const tick = async (): Promise<void> => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const gpu = await readGpu(cancellation.signal);
      if (stopped) return;
      if (gpu) samples.gpu.push(gpu);
      const busy = cpu();
      if (typeof busy === "number") samples.cpu.push(busy * 100);
      samples.ram.push(ram());
    } catch {
      // Diagnostic failure must not become a detached rejection or fail the job.
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick();

  return {
    stop(): HealthSummary {
      stopped = true;
      clearInterval(timer);
      cancellation.abort();
      return summarize(samples);
    },
  };
}
