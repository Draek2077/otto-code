/**
 * Per-model hosting profiles and the measured-calibration lookup, ported from the
 * original profiles.js. Only settings with a demonstrated effect on stability or
 * throughput are stored - notably `reasoningBudget`, which defaults to -1
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
  const enabledComponents = model?.components
    ? model.components
        .filter((component) => component.available && component.defaultLoad)
        .map((component) => component.id)
    : [];
  const componentPaths = Object.fromEntries(
    (model?.components ?? [])
      .filter((component) => enabledComponents.includes(component.id) && component.path)
      .map((component) => [component.role, component.path!]),
  );
  return {
    modelId: model?.id ?? null,
    modelPath: model?.modelPath ?? null,
    mmprojPath: model?.mmprojPath ?? null,
    // Long context is the point of this hardware; start at the native limit and
    // let the VRAM budget pull it down.
    contextSize: Math.min(nativeContext, contextCap),
    contextMultiplier: 1,
    calibrationRequired: true,
    cacheTypeK: defaults?.cacheTypeK ?? "q8_0",
    cacheTypeV: defaults?.cacheTypeV ?? "q8_0",
    flashAttention: defaults?.flashAttention ?? true, // required for a quantised V cache
    gpuLayers: 999, // everything on GPU; the budget check guards this
    // Existing hand-scanned models keep the historical vision default. Bundles
    // instead opt in only to installed components whose manifest says so.
    enabledComponents,
    componentPaths,
    vision: model?.components
      ? model.components.some(
          (component) =>
            component.role === "vision_projector" && component.available && component.defaultLoad,
        )
      : Boolean(model?.mmprojPath),
    reasoningBudget: defaults?.reasoningBudget ?? 1536,
    reasoningBudgetMessage: DEFAULT_REASONING_MESSAGE,
    parallelSlots: defaults?.parallelSlots ?? 1, // one agent at a time: max context per request
    batchSize: null,
    ubatchSize: null,
    extraArgs: [],
    hostingProfileId: null,
    // Inherit, not off: a new model in a family that has a default should use
    // it. With no family default configured this resolves to nothing anyway.
    hostingProfileMode: "inherit",
    chatTemplateFile: null,
    chatTemplateKwargs: {},
    chatSystemAddendum: null,
  };
}

/** Stored profile for a model, falling back to computed defaults. */
export function forModel(store: ProfilesStore, model: Model, defaults?: ProfileDefaults): Profile {
  const stored = store.profiles[model.id];
  const base = defaultProfile(model, defaults);
  if (!stored) return base;
  // Paths are re-derived so a moved model library does not break the profile.
  const enabledComponents = (stored.enabledComponents ?? []).filter((id) =>
    model.components?.some((component) => component.id === id && component.available),
  );
  // COMPAT(bundleProfiles): added in v0.8.7, remove after 2027-02-11.
  // Old vision profiles become the manifest's vision component when it exists.
  if (model.components && enabledComponents.length === 0 && stored.vision) {
    enabledComponents.push(
      ...model.components
        .filter((component) => component.role === "vision_projector" && component.available)
        .map((component) => component.id),
    );
  }
  const mmproj = model.components?.find(
    (component) =>
      component.role === "vision_projector" && enabledComponents.includes(component.id),
  );
  const componentPaths = Object.fromEntries(
    (model.components ?? [])
      .filter((component) => enabledComponents.includes(component.id) && component.path)
      .map((component) => [component.role, component.path!]),
  );
  return {
    ...base,
    ...stored,
    // COMPAT(hostingProfileMode): added in v0.8.8, remove after 2027-02-12.
    // The first hosting-profile store only had an id, and a non-null id there
    // was an explicit custom choice. Such a profile parses as `inherit` (the
    // schema default), so promote it. Writers hold the inverse invariant - the
    // id is nulled whenever the mode is not `custom` - so a stored id can only
    // mean a legacy record, never a stale leftover of a newer explicit choice.
    hostingProfileMode:
      stored.hostingProfileId && stored.hostingProfileMode === "inherit"
        ? "custom"
        : stored.hostingProfileMode,
    enabledComponents,
    modelPath: model.modelPath,
    mmprojPath: mmproj?.path ?? (model.components ? null : model.mmprojPath),
    componentPaths,
    vision: model.components ? Boolean(mmproj) : stored.vision,
  };
}

export function put(store: ProfilesStore, model: Model, profile: Profile): ProfilesStore {
  store.profiles[model.id] = { ...profile, modelId: model.id };
  return store;
}

/** Calibration is keyed by cache types, since those change bytes/token. */
export function calibrationKey(profile: Profile): string {
  const components = [...(profile.enabledComponents ?? [])].sort();
  const multiplier =
    profile.contextMultiplier > 1 ? `:contextMultiplier=${profile.contextMultiplier}` : "";
  // COMPAT(bundleCalibrationKey): added in v0.8.7, remove after 2027-02-11.
  // A main-model-only load remains the historical identity; any enabled bundle
  // artifact gets a distinct key and therefore cannot claim that measurement.
  return components.length
    ? `${profile.cacheTypeK}:${profile.cacheTypeV}${multiplier}:components=${components.join(",")}`
    : `${profile.cacheTypeK}:${profile.cacheTypeV}${multiplier}`;
}

/**
 * True when this model has a stored calibration, but for different cache types
 * than the profile currently uses - i.e. the measurement is stale and the budget
 * has fallen back to the theoretical estimate. Drives the "recalibrate" prompt.
 */
export function hasStaleCalibration(store: ProfilesStore, model: Model, profile: Profile): boolean {
  const measured = store.calibrations?.[model.id];
  if (!measured) return false;
  const key = calibrationKey(profile);
  return Object.keys(measured).some((k) => k !== key);
}

/**
 * KV cost per token is a property of the attention geometry, not of the particular
 * file: two models sharing an architecture and head dimensions cost the same per
 * layer regardless of quantisation or fine-tuning. Storing the measurement *per
 * layer* and keying it without the layer count lets one calibration serve a whole
 * family - which matters on a library holding a dozen variants of one base, and is
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
  const calibrations = store.calibrations;
  if (!Object.hasOwn(calibrations, model.id)) {
    Object.defineProperty(calibrations, model.id, {
      configurable: true,
      enumerable: true,
      value: {},
    });
  }
  Object.defineProperty(calibrations[model.id], calibrationKey(profile), {
    configurable: true,
    enumerable: true,
    value: measurement,
    writable: true,
  });

  const key = geometryKey(model, profile);
  const layers = model?.metadata?.blockCount;
  if (key && layers) {
    if (!store.geometryCalibrations) store.geometryCalibrations = {};
    Object.defineProperty(store.geometryCalibrations, key, {
      configurable: true,
      enumerable: true,
      value: {
        kvBytesPerTokenPerLayer: measurement.kvBytesPerToken / layers,
        baseOverheadBytes: measurement.baseOverheadBytes,
        measuredAt: measurement.measuredAt,
        measuredOn: model.displayName,
        measuredLayers: layers,
      },
      writable: true,
    });
  }
  // Calibration is a durable verdict about the persisted model profile, not a
  // transient UI hint. Every completion path (CLI, TUI, and host job) shares
  // this helper, so clearing it here keeps the state consistent everywhere.
  put(store, model, { ...profile, calibrationRequired: false });
  return store;
}
