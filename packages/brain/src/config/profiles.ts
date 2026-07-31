/**
 * Per-model hosting profiles and the measured-calibration lookup, ported from the
 * original profiles.js. Only settings with a demonstrated effect on stability or
 * throughput are stored — notably `reasoningBudget`, which defaults to -1
 * (unrestricted) in llama-server and in that state makes thinking models spend an
 * entire token allowance reasoning and return no content at all.
 */
import type { Model } from "../types.js";
import {
  DEFAULT_REASONING_MESSAGE,
  type Calibration,
  type Profile,
  type ProfileDefaults,
  type ProfilesStore,
} from "./schema.js";

export function defaultProfile(model: Model | null, defaults?: ProfileDefaults): Profile {
  const nativeContext = model?.metadata?.contextLength || 32768;
  const contextCap = defaults?.contextCap ?? 225000;
  return {
    modelId: model?.id ?? null,
    modelPath: model?.modelPath ?? null,
    mmprojPath: model?.mmprojPath ?? null,
    // Long context is the point of this hardware; start at the native limit and
    // let the VRAM budget pull it down.
    contextSize: Math.min(nativeContext, contextCap),
    cacheTypeK: defaults?.cacheTypeK ?? "q8_0",
    cacheTypeV: defaults?.cacheTypeV ?? "q8_0",
    flashAttention: defaults?.flashAttention ?? true, // required for a quantised V cache
    gpuLayers: 999, // everything on GPU; the budget check guards this
    vision: Boolean(model?.mmprojPath),
    reasoningBudget: defaults?.reasoningBudget ?? 1536,
    reasoningBudgetMessage: DEFAULT_REASONING_MESSAGE,
    parallelSlots: defaults?.parallelSlots ?? 1, // one agent at a time: max context per request
    batchSize: null,
    ubatchSize: null,
    extraArgs: [],
  };
}

/** Stored profile for a model, falling back to computed defaults. */
export function forModel(store: ProfilesStore, model: Model, defaults?: ProfileDefaults): Profile {
  const stored = store.profiles[model.id];
  const base = defaultProfile(model, defaults);
  if (!stored) return base;
  // Paths are re-derived so a moved model library does not break the profile.
  return { ...base, ...stored, modelPath: model.modelPath, mmprojPath: model.mmprojPath };
}

export function put(store: ProfilesStore, model: Model, profile: Profile): ProfilesStore {
  store.profiles[model.id] = { ...profile, modelId: model.id };
  return store;
}

/** Calibration is keyed by cache types, since those change bytes/token. */
export function calibrationKey(profile: Profile): string {
  return `${profile.cacheTypeK}:${profile.cacheTypeV}`;
}

/**
 * KV cost per token is a property of the attention geometry, not of the particular
 * file: two models sharing an architecture and head dimensions cost the same per
 * layer regardless of quantisation or fine-tuning. Storing the measurement *per
 * layer* and keying it without the layer count lets one calibration serve a whole
 * family — which matters on a library holding a dozen variants of one base, and is
 * necessary because MTP builds carry an extra multi-token-prediction layer (65
 * blocks where the base has 64) and would otherwise never match.
 */
export function geometryKey(model: Model, profile: Profile): string | null {
  const md = model?.metadata;
  if (!md || !md.headCountKv || !md.keyLength) return null;
  return [
    md.arch,
    md.headCountKv,
    md.keyLength,
    md.valueLength,
    profile.cacheTypeK,
    profile.cacheTypeV,
  ].join(":");
}

export function getCalibration(
  store: ProfilesStore,
  model: Model,
  profile: Profile,
): Calibration | null {
  const exact = store.calibrations?.[model.id]?.[calibrationKey(profile)];
  if (exact) return exact;

  // Fall back to a relative with the same geometry, rescaled to this model's layer
  // count. Flagged as inherited so the UI never implies it was measured on this file.
  const key = geometryKey(model, profile);
  const family = key ? store.geometryCalibrations?.[key] : null;
  const layers = model?.metadata?.blockCount;
  if (!family || !layers || !family.kvBytesPerTokenPerLayer) return null;

  return {
    kvBytesPerToken: family.kvBytesPerTokenPerLayer * layers,
    baseOverheadBytes: family.baseOverheadBytes,
    measuredAt: family.measuredAt,
    measuredOn: family.measuredOn,
    inherited: true,
  };
}

export function putCalibration(
  store: ProfilesStore,
  model: Model,
  profile: Profile,
  measurement: Calibration,
): ProfilesStore {
  if (!store.calibrations) store.calibrations = {};
  if (!store.calibrations[model.id]) store.calibrations[model.id] = {};
  store.calibrations[model.id][calibrationKey(profile)] = measurement;

  const key = geometryKey(model, profile);
  const layers = model?.metadata?.blockCount;
  if (key && layers) {
    if (!store.geometryCalibrations) store.geometryCalibrations = {};
    store.geometryCalibrations[key] = {
      kvBytesPerTokenPerLayer: measurement.kvBytesPerToken / layers,
      baseOverheadBytes: measurement.baseOverheadBytes,
      measuredAt: measurement.measuredAt,
      measuredOn: model.displayName,
      measuredLayers: layers,
    };
  }
  return store;
}
