import { query, usedBytes } from "../gpu.js";
import * as vram from "../vram.js";
import { DEFAULT_INTERNAL_PORT, Supervisor } from "../service/supervisor.js";

import type { Model, Runtime } from "../types.js";
import type { GpuInfo } from "../types.js";
import type { Calibration, Profile } from "../config/schema.js";

/**
 * Measure a model's real KV-cache cost per token.
 *
 * The theoretical formula (layers x kv_heads x dims x bytes) overestimates
 * badly on architectures that only keep a full cache on some layers - by ~4x
 * on `qwen35`. So we load the model twice at two context sizes and take the
 * slope: bytes/token = (vram_b - vram_a) / (ctx_b - ctx_a). Everything that
 * does not scale with context (weights, projector, CUDA context, compute
 * buffers) cancels out of the difference.
 *
 * Two invariants keep that slope honest. The high sample is the profile's
 * configured context (the depth the user will actually serve at) capped by
 * what fits in VRAM - never the raw native × multiplier ceiling, which on a
 * tight card loads a cache that spills to system RAM and biases the slope low.
 * A sample whose load split the KV cache to CPU is unusable: the GPU delta
 * misses the spilled share, the bytes/token comes out understated, and the
 * budget then declares a context "fits" that actually runs on a RAM cache.
 */

/** A single context-size measurement collected during calibration. */
export interface CalibrationSample {
  contextSize: number;
  deltaBytes: number;
  loadSeconds: number | null;
}

/** Progress event emitted while calibrating. */
export interface CalibrateProgress {
  phase: "skip" | "loading" | "measured" | "failed";
  contextSize: number;
  reason?: string;
  deltaBytes?: number;
  error?: string;
}

/**
 * Detect that a load split its KV cache onto system RAM.
 *
 * `usedBytes()` reads nvidia-smi, which only sees the GPU share of the cache.
 * When llama-server cannot hold the whole allocation in VRAM it does not fail
 * the load - it offloads the overflow to CPU and the load "succeeds" at a
 * fraction of the VRAM the context should cost. The startup banner is the
 * only place the split is stated.
 */
export function kvSpilledToCpu(logLines: string[]): boolean {
  return logLines.some((line) =>
    /KV .*split|CPU buffer size|KV cache.*offload|offloading \d+ layers? to cpu/i.test(line),
  );
}

/**
 * The largest context size the static VRAM budget allows, or null when the
 * cost per token is unknown and the budget cannot answer. Used to keep the
 * calibration samples inside the region where the GPU sees the whole cache.
 */
export function maxContextForCalibration(
  model: Model,
  profile: Profile,
  calibration: Calibration | null,
  totalVramBytes: number,
): number | null {
  const max = vram.maxContextThatFits({
    model,
    profile,
    calibration,
    totalVramBytes,
  });
  return max && max >= 4096 ? max : null;
}

export interface CalibrateOptions {
  runtime: Runtime;
  model: Model;
  profile: Profile;
  /** Explicit context sizes to measure. Replaces the default strategy entirely. */
  samples?: number[];
  /**
   * The calibration being replaced, if one exists. The best prior on bytes/token
   * for this exact profile shape, so the sample cap can use the measured figure
   * instead of the (over-estimating) theoretical one.
   */
  priorCalibration?: Calibration | null;
  internalPort?: number;
  /** Reuse the host's resident supervisor instead of creating a sidecar server. */
  supervisor?: Supervisor;
  /**
   * Pool-owned lifecycle for a hosted operation. Both callbacks must be
   * supplied together; standalone CLI/TUI runs keep using their local
   * supervisor.
   */
  lifecycle?: {
    start: (profile: Profile) => Promise<void>;
    stop: () => Promise<void>;
  };
  /**
   * Pause after stopping each sample so the driver releases its allocation
   * before the next load. Tests run with zero.
   */
  releaseDelayMs?: number;
  onProgress?: (event: CalibrateProgress) => void;
}

/** The measured KV-cache profile calibration produces. */
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

export async function calibrate({
  runtime,
  model,
  profile,
  samples,
  priorCalibration = null,
  internalPort = DEFAULT_INTERNAL_PORT + 1,
  supervisor: optionsSupervisor,
  lifecycle,
  releaseDelayMs = 3000,
  onProgress = () => {},
}: CalibrateOptions): Promise<CalibrationMeasurement> {
  const nativeContext = model.metadata?.contextLength ?? null;
  const nativeCeiling = nativeContext ? nativeContext * profile.contextMultiplier : null;
  const gpu = (await query()) as GpuInfo | null;

  // The high sample is the depth the profile will actually serve at - its
  // configured context, clamped to the native × multiplier ceiling - not the
  // raw ceiling itself. On a card where that depth does not fit, the static
  // budget caps it at the largest context that does. Measuring at a context
  // whose KV spills to CPU understates bytes/token and poisons the budget.
  const configured = Math.max(4096, profile.contextSize);
  let high = configured;
  if (nativeCeiling !== null && high > nativeCeiling) high = nativeCeiling;

  if (gpu !== null) {
    const maxFits = maxContextForCalibration(model, profile, priorCalibration, gpu.totalBytes);
    if (maxFits !== null && high > maxFits) {
      high = maxFits;
      onProgress({
        phase: "skip",
        contextSize: configured,
        reason: `configured context exceeds what fits in VRAM; measuring at ${high.toLocaleString()}`,
      });
    }
  }

  // The low sample is a fixed small context far enough below the serving depth
  // that the KV delta dominates the fixed terms (weights, CUDA context). The
  // high sample never drops below it: a VRAM cap that pushed the two together
  // would make the slope a difference of near-equal numbers, and at high == low
  // a division by zero.
  const lowContext = 4096;
  const highContext = Math.max(high, lowContext * 2);
  const effectiveSamples = samples ?? [lowContext, highContext];
  if (effectiveSamples.length < 2) throw new Error("calibration needs at least two context sizes");

  const native = nativeCeiling ?? Math.max(...effectiveSamples);
  const points: CalibrationSample[] = [];

  if (lifecycle && !optionsSupervisor) {
    throw new Error("a managed calibration lifecycle requires its resident supervisor");
  }

  for (const contextSize of effectiveSamples) {
    if (contextSize > native) {
      onProgress({ phase: "skip", contextSize, reason: `exceeds configured context ${native}` });
      continue;
    }

    const supervisor = optionsSupervisor ?? new Supervisor({ runtime, internalPort });
    onProgress({ phase: "loading", contextSize });

    const baseline = await usedBytes();
    try {
      const sampleProfile = { ...profile, contextSize };
      if (lifecycle) await lifecycle.start(sampleProfile);
      else await supervisor.start(model, sampleProfile);
      if (kvSpilledToCpu(supervisor.logLines)) {
        const reason = `KV cache split to CPU at ${contextSize.toLocaleString()} context`;
        onProgress({ phase: "failed", contextSize, reason });
        throw new Error(
          `${reason} - the context does not fit in VRAM. Lower the context or use a smaller KV cache type before calibrating.`,
        );
      }
      const used = supervisor.vramAtReadyBytes ?? (await usedBytes());
      const delta = Number(used) - Number(supervisor.vramBaselineBytes ?? baseline);
      points.push({ contextSize, deltaBytes: delta, loadSeconds: supervisor.loadSeconds });
      onProgress({ phase: "measured", contextSize, deltaBytes: delta });
    } catch (error) {
      onProgress({
        phase: "failed",
        contextSize,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      if (lifecycle) await lifecycle.stop();
      else await supervisor.stop();
      // Let the driver actually release the allocation before the next sample.
      if (releaseDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, releaseDelayMs));
    }
  }

  if (points.length < 2) {
    throw new Error("calibration produced fewer than two usable samples");
  }

  points.sort((a, b) => a.contextSize - b.contextSize);
  const lowPoint = points[0];
  const highPoint = points[points.length - 1];

  const kvBytesPerToken =
    (highPoint.deltaBytes - lowPoint.deltaBytes) / (highPoint.contextSize - lowPoint.contextSize);
  if (!(kvBytesPerToken > 0)) {
    throw new Error("measured a non-positive bytes-per-token; results are unusable");
  }

  const fixedBytes = model.sizeBytes + (profile.vision && model.mmprojPath ? model.mmprojBytes : 0);
  const baseOverheadBytes = Math.max(
    0,
    lowPoint.deltaBytes - fixedBytes - kvBytesPerToken * lowPoint.contextSize,
  );

  const theoretical = vram.theoreticalKvBytesPerToken(
    model.metadata,
    profile.cacheTypeK,
    profile.cacheTypeV,
  );

  return {
    kvBytesPerToken,
    baseOverheadBytes,
    theoreticalKvBytesPerToken: theoretical,
    theoreticalRatio: theoretical ? theoretical / kvBytesPerToken : null,
    samples: points,
    cacheTypeK: profile.cacheTypeK,
    cacheTypeV: profile.cacheTypeV,
    vision: Boolean(profile.vision && model.mmprojPath),
    measuredAt: new Date().toISOString(),
  };
}
