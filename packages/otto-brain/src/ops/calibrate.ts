import { setTimeout as delay } from "node:timers/promises";
import { metalAllocatedBytes } from "../gpu.js";
import * as vram from "../vram.js";
import type { Calibration, Profile } from "../config/schema.js";
import type { GpuInfo, Model } from "../types.js";
import type { ModelOperationProcess } from "./process.js";

export interface CalibrationSample {
  contextSize: number;
  deltaBytes: number;
  loadSeconds: number | null;
}
export interface CalibrateProgress {
  phase: "skip" | "loading" | "measured" | "failed";
  contextSize: number;
  reason?: string;
  deltaBytes?: number;
  error?: string;
}
export interface CalibrateOptions {
  model: Model;
  profile: Profile;
  process: ModelOperationProcess;
  gpu: GpuInfo | null;
  readUsedBytes(signal?: AbortSignal): Promise<number | null>;
  samples?: number[];
  priorCalibration?: Calibration | null;
  releaseDelayMs?: number;
  signal?: AbortSignal;
  onProgress?(event: CalibrateProgress): void;
}
export interface CalibrationMeasurement {
  kvBytesPerToken: number;
  baseOverheadBytes: number;
  theoreticalKvBytesPerToken: number | null;
  theoreticalRatio: number | null;
  samples: CalibrationSample[];
  cacheTypeK: string;
  cacheTypeV: string;
  vision: boolean;
  measuredAt: string;
}

export function kvSpilledToCpu(lines: string[]): boolean {
  return lines.some((line) => {
    if (
      /KV .*split|CPU KV buffer size|KV cache.*offload|offloading \d+ layers? to cpu/iu.test(line)
    )
      return true;
    const host =
      /\|\s*-\s*(?:Host|CPU)\b[^|]*\|\s*[\d.]+\s*=\s*[\d.]+\s*\+\s*\(\s*[\d.]+\s*=\s*[\d.]+\s*\+\s*([\d.]+)\s*\+/iu.exec(
        line,
      );
    return host !== null && Number(host[1]) > 0;
  });
}

export function maxContextForCalibration(
  model: Model,
  profile: Profile,
  calibration: Calibration | null,
  totalVramBytes: number,
  reserveBytes?: number,
): number | null {
  const options = { model, profile, calibration, totalVramBytes, reserveBytes };
  const coarse = vram.maxContextThatFits(options);
  if (coarse && coarse >= 4096) return coarse;
  const fine = vram.maxContextThatFits({ ...options, step: 1024 });
  return fine && fine >= 1024 ? fine : null;
}

function samplePlan(options: CalibrateOptions): number[] {
  const { model, profile, gpu, priorCalibration = null } = options;
  const native = model.metadata?.contextLength;
  const ceiling = native ? native * profile.contextMultiplier : Number.POSITIVE_INFINITY;
  const configured = Math.max(1024, profile.contextSize);
  let high = Math.min(configured, ceiling);
  const reserveBytes = gpu ? vram.reserveBytesForGpu(gpu) : undefined;
  const fit = gpu
    ? maxContextForCalibration(model, profile, priorCalibration, gpu.totalBytes, reserveBytes)
    : null;
  if (fit !== null && high > fit) {
    high = fit;
    options.onProgress?.({
      phase: "skip",
      contextSize: configured,
      reason: `configured context exceeds what fits in VRAM; measuring at ${high.toLocaleString()}`,
    });
  }
  const upper = Math.min(Math.max(high, 8192), fit ?? Number.POSITIVE_INFINITY, ceiling);
  const lower = Math.min(4096, Math.floor(upper / 2));
  const samples = options.samples ?? [lower, upper];
  if (samples.some((value) => !Number.isSafeInteger(value) || value < 1024))
    throw new Error("calibration context sizes must be integers of at least 1024 tokens");
  const usable = [...new Set(samples)].filter((contextSize) => {
    if (contextSize <= ceiling) return true;
    options.onProgress?.({
      phase: "skip",
      contextSize,
      reason: `exceeds configured context ${ceiling}`,
    });
    return false;
  });
  if (usable.length < 2)
    throw new Error("calibration needs at least two distinct usable context sizes");
  return usable;
}

function assertNoSpill(lines: string[], contextSize: number): void {
  if (kvSpilledToCpu(lines))
    throw new Error(
      `KV cache split to CPU at ${contextSize.toLocaleString()} context; lower the context or use a smaller KV cache type before calibrating`,
    );
}

async function sampleAllocation(
  options: CalibrateOptions,
  contextSize: number,
  baseline: number | null,
  stop: () => Promise<void>,
): Promise<number> {
  const { supervisor } = options.process;
  const { signal } = options;
  const isMetal = options.gpu?.driver === "Metal";
  let deltaBytes: number | null;
  if (isMetal) {
    deltaBytes = metalAllocatedBytes(supervisor.allocationLogLines);
    if (deltaBytes === null) {
      await stop();
      assertNoSpill(supervisor.allocationLogLines, contextSize);
      deltaBytes = metalAllocatedBytes(supervisor.allocationLogLines);
    }
    if (deltaBytes === null)
      throw new Error(
        "Metal allocation lines are missing from the runtime log; cannot calibrate safely",
      );
  } else {
    const used = supervisor.vramAtReadyBytes ?? (await options.readUsedBytes(signal));
    const before = supervisor.vramBaselineBytes ?? baseline;
    if (used === null || before === null)
      throw new Error("GPU allocation measurements are unavailable; cannot calibrate safely");
    deltaBytes = used - before;
  }
  if (!Number.isFinite(deltaBytes) || deltaBytes <= 0)
    throw new Error("GPU allocation sample was not positive; cannot calibrate safely");
  return deltaBytes;
}

async function measureSample(
  options: CalibrateOptions,
  contextSize: number,
): Promise<CalibrationSample> {
  const { process: lease, signal, gpu } = options;
  const supervisor = lease.supervisor;
  const verbosity = supervisor.logVerbosity;
  const isMetal = gpu?.driver === "Metal";
  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    await lease.stop();
    stopped = true;
  };
  if (isMetal) supervisor.logVerbosity = Math.max(verbosity, 5);
  try {
    signal?.throwIfAborted();
    options.onProgress?.({ phase: "loading", contextSize });
    const baseline = isMetal ? null : await options.readUsedBytes(signal);
    signal?.throwIfAborted();
    await lease.start({ ...options.profile, contextSize });
    signal?.throwIfAborted();
    assertNoSpill(supervisor.allocationLogLines, contextSize);
    const deltaBytes = await sampleAllocation(options, contextSize, baseline, stop);
    options.onProgress?.({ phase: "measured", contextSize, deltaBytes });
    return { contextSize, deltaBytes, loadSeconds: supervisor.loadSeconds };
  } catch (error) {
    options.onProgress?.({
      phase: "failed",
      contextSize,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    try {
      await stop();
    } finally {
      supervisor.logVerbosity = verbosity;
    }
    const pause = options.releaseDelayMs ?? 3000;
    if (pause > 0 && !signal?.aborted) await delay(pause, undefined, { signal });
  }
}

function measurement(
  options: CalibrateOptions,
  samples: CalibrationSample[],
): CalibrationMeasurement {
  const { model, profile } = options;
  samples.sort((a, b) => a.contextSize - b.contextSize);
  const low = samples[0];
  const high = samples[samples.length - 1];
  const kvBytesPerToken = (high.deltaBytes - low.deltaBytes) / (high.contextSize - low.contextSize);
  if (!(kvBytesPerToken > 0))
    throw new Error("measured a non-positive bytes-per-token; results are unusable");
  const budget = vram.budget({ model, profile, totalVramBytes: Number.MAX_SAFE_INTEGER });
  const fixedBytes = budget.weightsBytes + budget.componentBytes;
  const theoretical = vram.theoreticalKvBytesPerToken(
    model.metadata,
    profile.cacheTypeK,
    profile.cacheTypeV,
  );
  return {
    kvBytesPerToken,
    baseOverheadBytes: Math.max(0, low.deltaBytes - fixedBytes - kvBytesPerToken * low.contextSize),
    theoreticalKvBytesPerToken: theoretical,
    theoreticalRatio: theoretical ? theoretical / kvBytesPerToken : null,
    samples,
    cacheTypeK: profile.cacheTypeK,
    cacheTypeV: profile.cacheTypeV,
    vision: Boolean(profile.vision && model.mmprojPath),
    measuredAt: new Date().toISOString(),
  };
}

export async function calibrate(options: CalibrateOptions): Promise<CalibrationMeasurement> {
  options.signal?.throwIfAborted();
  const points: CalibrationSample[] = [];
  for (const context of samplePlan(options)) points.push(await measureSample(options, context));
  options.signal?.throwIfAborted();
  return measurement(options, points);
}
