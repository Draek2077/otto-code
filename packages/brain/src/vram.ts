/**
 * VRAM budgeting.
 *
 * A purely theoretical KV-cache formula is not trustworthy here. For a dense
 * model, KV bytes/token = layers * kv_heads * (k_dim + v_dim) * bytes_per_elem.
 * Measured against Qwen3.6-27B (`qwen35`) that formula overestimates by ~4x,
 * because the architecture only carries a full KV cache on a subset of its
 * layers. Guessing the ratio per architecture would be fragile, so the
 * theoretical value is treated as a worst-case bound and a measured
 * bytes-per-token from `calibrate` is preferred whenever one exists.
 */
import type { Calibration, Profile } from "./config/schema.js";
import type { Model, ModelMetadata } from "./types.js";

export const GIB = 1024 ** 3;

// Bytes per element for each KV cache type (block size / elements per block).
export const CACHE_TYPE_BYTES: Record<string, number> = {
  f32: 4,
  f16: 2,
  bf16: 2,
  q8_0: 34 / 32,
  q5_1: 24 / 32,
  q5_0: 22 / 32,
  q4_1: 20 / 32,
  q4_0: 18 / 32,
};

export function cacheTypeBytes(type: string): number {
  const bytes = CACHE_TYPE_BYTES[String(type).toLowerCase()];
  if (bytes === undefined) throw new Error(`unknown KV cache type "${type}"`);
  return bytes;
}

export function listCacheTypes(): string[] {
  return Object.keys(CACHE_TYPE_BYTES);
}

/** Worst-case KV bytes per token, assuming every layer holds a full cache. */
export function theoreticalKvBytesPerToken(
  metadata: ModelMetadata | null,
  cacheTypeK: string,
  cacheTypeV: string,
): number | null {
  if (!metadata) return null;
  const { blockCount, headCountKv, keyLength, valueLength } = metadata;
  if (
    ![blockCount, headCountKv, keyLength, valueLength].every((v) => typeof v === "number" && v > 0)
  ) {
    return null;
  }
  return (
    (blockCount as number) *
    (headCountKv as number) *
    ((keyLength as number) * cacheTypeBytes(cacheTypeK) +
      (valueLength as number) * cacheTypeBytes(cacheTypeV))
  );
}

export type BudgetSource = "measured" | "theoretical" | "unknown";

export interface Budget {
  weightsBytes: number;
  mmprojBytes: number;
  componentBytes: number;
  drafterKvBytes: number;
  imageProcessingBytes: number;
  kvBytes: number;
  overheadBytes: number;
  totalBytes: number;
  usableBytes: number;
  totalVramBytes: number;
  reserveBytes: number;
  kvBytesPerToken: number;
  source: BudgetSource;
  theoreticalKvBytesPerToken: number | null;
  fits: boolean;
  headroomBytes: number;
  utilization: number;
}

export interface BudgetOptions {
  model: Model;
  profile: Profile;
  calibration?: Calibration | null;
  totalVramBytes: number;
  reserveBytes?: number;
}

/** Compute a VRAM budget for a profile. */
export function budget({
  model,
  profile,
  calibration = null,
  totalVramBytes,
  reserveBytes = 1.5 * GIB,
}: BudgetOptions): Budget {
  const weights = model.sizeBytes;
  const enabled = new Set(profile.enabledComponents ?? []);
  const components = model.components ?? [];
  const projector = components.filter(
    (component) =>
      component.role === "vision_projector" && enabled.has(component.id) && component.available,
  );
  const drafters = components.filter(
    (component) =>
      component.role === "speculative_drafter" && enabled.has(component.id) && component.available,
  );
  const componentBytes = components.length
    ? [...projector, ...drafters].reduce((total, component) => total + component.bytes, 0)
    : profile.vision && model.mmprojPath
      ? model.mmprojBytes
      : 0;
  const mmproj =
    projector.reduce((total, component) => total + component.bytes, 0) ||
    (components.length ? 0 : componentBytes);

  const theoretical = theoreticalKvBytesPerToken(
    model.metadata,
    profile.cacheTypeK,
    profile.cacheTypeV,
  );

  let kvBytesPerToken: number;
  let source: BudgetSource;
  if (calibration && calibration.kvBytesPerToken > 0) {
    kvBytesPerToken = calibration.kvBytesPerToken;
    source = "measured";
  } else if (theoretical !== null) {
    kvBytesPerToken = theoretical;
    source = "theoretical";
  } else {
    kvBytesPerToken = 0;
    source = "unknown";
  }

  const kv = kvBytesPerToken * profile.contextSize;
  // The speculative decoder keeps its own KV cache. Until component-specific
  // calibration exists, reserve the same conservative per-token cost.
  const drafterKv = drafters.length * kv;
  // Vision preprocessing needs transient GPU buffers in addition to weights.
  const imageProcessing = projector.length * 256 * 1024 * 1024;
  // Compute buffers and the CUDA context; measured at ~0.6 GB for a 27B and
  // superseded by the calibrated value when available.
  const overhead =
    calibration && calibration.baseOverheadBytes > 0 ? calibration.baseOverheadBytes : 0.6 * GIB;

  const total = weights + componentBytes + kv + drafterKv + imageProcessing + overhead;
  const usable = totalVramBytes - reserveBytes;

  return {
    weightsBytes: weights,
    mmprojBytes: mmproj,
    componentBytes,
    drafterKvBytes: drafterKv,
    imageProcessingBytes: imageProcessing,
    kvBytes: kv,
    overheadBytes: overhead,
    totalBytes: total,
    usableBytes: usable,
    totalVramBytes,
    reserveBytes,
    kvBytesPerToken,
    source,
    theoreticalKvBytesPerToken: theoretical,
    fits: total <= usable,
    headroomBytes: usable - total,
    utilization: total / usable,
  };
}

export interface MaxContextOptions extends BudgetOptions {
  step?: number;
}

/** Largest context that still fits, rounded down to a friendly step. */
export function maxContextThatFits({
  model,
  profile,
  calibration,
  totalVramBytes,
  reserveBytes = 1.5 * GIB,
  step = 4096,
}: MaxContextOptions): number | null {
  const probe = budget({
    model,
    profile: { ...profile, contextSize: step },
    calibration,
    totalVramBytes,
    reserveBytes,
  });
  if (probe.kvBytesPerToken <= 0) return null;

  const fixed =
    probe.weightsBytes + probe.componentBytes + probe.imageProcessingBytes + probe.overheadBytes;
  const room = probe.usableBytes - fixed;
  if (room <= 0) return null;

  const tokens = Math.floor(room / probe.kvBytesPerToken);
  const native = model.metadata?.contextLength;
  const contextLimit =
    typeof native === "number" && native > 0 ? native * profile.contextMultiplier : tokens;
  const capped = Math.min(tokens, contextLimit);
  return Math.max(0, Math.floor(capped / step) * step);
}

export interface FitResult {
  profile: Profile;
  adjusted: boolean;
  reason: string | null;
  budget: Budget;
  /**
   * The context the caller asked for, before any adjustment. `profile` is the
   * one that will actually run, so once a fit has been applied the original is
   * unrecoverable from it - and a benchmark that does not record what it asked
   * for cannot later explain why it scored the way it did.
   */
  requestedContextSize: number;
}

/**
 * Adapt a profile to the hardware it is about to run on.
 *
 * Refusing to load because a saved profile asks for more context than this
 * machine has is unhelpful when a slightly smaller context would work - and it
 * is the difference between a model being usable on a 32GB desktop and a 24GB
 * laptop. Clamp the context instead, and report what changed.
 */
export function fitToBudget({
  model,
  profile,
  calibration,
  totalVramBytes,
  reserveBytes = 1.5 * GIB,
}: BudgetOptions): FitResult {
  const requestedContextSize = profile.contextSize;
  const initial = budget({ model, profile, calibration, totalVramBytes, reserveBytes });
  if (initial.fits) {
    return { profile, adjusted: false, reason: null, budget: initial, requestedContextSize };
  }

  const max = maxContextThatFits({ model, profile, calibration, totalVramBytes, reserveBytes });
  if (!max || max < 4096) {
    return {
      profile,
      adjusted: false,
      reason:
        `does not fit at any usable context (needs ${formatGiB(initial.totalBytes)}, ` +
        `${formatGiB(initial.usableBytes)} usable)`,
      budget: initial,
      requestedContextSize,
    };
  }

  const fitted: Profile = { ...profile, contextSize: max };
  return {
    profile: fitted,
    adjusted: true,
    reason: `context reduced ${requestedContextSize.toLocaleString()} -> ${max.toLocaleString()} to fit ${formatGiB(totalVramBytes)} of VRAM`,
    budget: budget({ model, profile: fitted, calibration, totalVramBytes, reserveBytes }),
    requestedContextSize,
  };
}

export function formatGiB(bytes: number, digits = 1): string {
  return `${(bytes / GIB).toFixed(digits)}G`;
}
