import { usedBytes } from "../gpu.js";
import * as vram from "../vram.js";
import { Supervisor } from "../service/supervisor.js";

import type { Model, Runtime } from "../types.js";
import type { Profile } from "../config/schema.js";

/**
 * Measure a model's real KV-cache cost per token.
 *
 * The theoretical formula (layers x kv_heads x dims x bytes) overestimates
 * badly on architectures that only keep a full cache on some layers - by ~4x
 * on `qwen35`. So we load the model twice at two context sizes and take the
 * slope: bytes/token = (vram_b - vram_a) / (ctx_b - ctx_a). Everything that
 * does not scale with context (weights, projector, CUDA context, compute
 * buffers) cancels out of the difference.
 */

export const DEFAULT_SAMPLES = [8192, 65536];

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

export interface CalibrateOptions {
  runtime: Runtime;
  model: Model;
  profile: Profile;
  samples?: number[];
  internalPort?: number;
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
  samples = DEFAULT_SAMPLES,
  internalPort = 8082,
  onProgress = () => {},
}: CalibrateOptions): Promise<CalibrationMeasurement> {
  if (samples.length < 2) throw new Error("calibration needs at least two context sizes");

  const native = model.metadata?.contextLength || Math.max(...samples);
  const points: CalibrationSample[] = [];

  for (const contextSize of samples) {
    if (contextSize > native) {
      onProgress({ phase: "skip", contextSize, reason: `exceeds native context ${native}` });
      continue;
    }

    const supervisor = new Supervisor({ runtime, internalPort });
    onProgress({ phase: "loading", contextSize });

    const baseline = await usedBytes();
    try {
      await supervisor.start(model, { ...profile, contextSize });
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
      await supervisor.stop();
      // Let the driver actually release the allocation before the next sample.
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  if (points.length < 2) {
    throw new Error("calibration produced fewer than two usable samples");
  }

  points.sort((a, b) => a.contextSize - b.contextSize);
  const low = points[0];
  const high = points[points.length - 1];

  const kvBytesPerToken = (high.deltaBytes - low.deltaBytes) / (high.contextSize - low.contextSize);
  if (!(kvBytesPerToken > 0)) {
    throw new Error("measured a non-positive bytes-per-token; results are unusable");
  }

  const fixedBytes = model.sizeBytes + (profile.vision && model.mmprojPath ? model.mmprojBytes : 0);
  const baseOverheadBytes = Math.max(
    0,
    low.deltaBytes - fixedBytes - kvBytesPerToken * low.contextSize,
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
