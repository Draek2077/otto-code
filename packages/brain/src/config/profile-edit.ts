/**
 * The editable surface of a per-model profile: which fields a UI may change,
 * what values each accepts, and what warnings a given combination earns.
 *
 * This exists so the ranges live in exactly one place. The TUI enforced them
 * inline in its field table (`tui/app.ts`), which was fine while the TUI was the
 * only editor. Now `/__host/models/:id/profile` accepts writes from Otto's Brain
 * page too, and a validator that disagreed with the editor would either reject
 * something the UI offered or accept something that cannot start.
 *
 * The warnings are the empirical part and must survive edits:
 *  - A quantised V cache requires flash attention. Without it llama-server
 *    refuses to allocate the cache and the model never reaches ready.
 *  - An unrestricted reasoning budget (-1) is the failure this package exists to
 *    prevent: thinking models spend an entire token allowance reasoning and
 *    return no content at all.
 *  - Changing a cache type invalidates a measured calibration, because KV
 *    bytes/token is a function of the cache types (see `vram.ts`).
 */
import os from "node:os";

import { CACHE_TYPE_BYTES, formatGiB, promptCacheSize } from "../vram.js";
import type { Model } from "../types.js";
import { getCalibration, hasStaleCalibration } from "./profiles.js";
import type { Calibration, Profile, ProfilesStore } from "./schema.js";

/** How a client should render a field. */
export type ProfileFieldKind = "number" | "toggle" | "cycle";

export interface ProfileFieldDescriptor {
  key: string;
  label: string;
  kind: ProfileFieldKind;
  /**
   * One sentence on what the field does, for the client's tooltip. It lives
   * here rather than in the UI for the same reason the ranges do: a client that
   * wrote its own copy would describe a setting the brain had since changed.
   */
  description?: string;
  /** For `number`: the increment a stepper should use. */
  step?: number;
  min?: number;
  max?: number;
  /**
   * For `number`: decimal places the value carries. Absent means an integer.
   * A stepper MUST round to this after adding `step`, or repeated presses walk
   * a sampler into 0.30000000000000004 and the profile stores that.
   */
  precision?: number;
  /** For `cycle`: the values to offer, in order. */
  options?: (string | number)[];
  /** Labels for `options`, index-aligned, when the raw value is not presentable. */
  optionLabels?: string[];
  /**
   * For `cycle`: what each option actually stores, index-aligned. Absent means
   * the option IS the stored value, which is true of every cycle but the
   * tri-states: `options` is limited to strings and numbers on the wire, so a
   * field storing `true`/`false`/`null` needs somewhere to say so. A client
   * matches the current value here first, then falls back to `options`.
   */
  optionValues?: (string | number | boolean | null)[];
  /** False when this model cannot use the field at all (vision with no projector). */
  available: boolean;
  /** Why it is unavailable, for the disabled-state hint. */
  unavailableReason?: string;
}

/**
 * Sampler ranges. llama.cpp itself bounds almost none of these - it will take a
 * temperature of 50 - so the bounds are the useful range rather than the legal
 * one, which is what a stepper wants. The write path clamps to exactly these,
 * so a value the editor cannot reach is a value the brain will not store.
 */
export const SAMPLING_RANGES = {
  temperature: { min: 0, max: 2, step: 0.05, precision: 2 },
  topP: { min: 0, max: 1, step: 0.05, precision: 2 },
  topK: { min: 0, max: 200, step: 1 },
  minP: { min: 0, max: 1, step: 0.01, precision: 2 },
  presencePenalty: { min: -2, max: 2, step: 0.05, precision: 2 },
  repeatPenalty: { min: 0.5, max: 2, step: 0.01, precision: 2 },
} as const;

/** Tri-state preservation, in the order a cycle should offer it. */
export const PRESERVE_REASONING_CYCLE = ["default", "on", "off"] as const;

/** The stored value a cycle option maps to. */
export function preserveReasoningFromOption(option: string): boolean | null {
  return option === "on" ? true : option === "off" ? false : null;
}

/** The cycle option a stored value maps to. */
export function preserveReasoningOption(value: boolean | null | undefined): string {
  return value === true ? "on" : value === false ? "off" : "default";
}

/**
 * The cache types the editor cycles through. `CACHE_TYPE_BYTES` knows more
 * (f32, bf16, q5_0, q4_1) and a write naming one of those is accepted; these
 * four are the ones worth offering, matching the TUI's cycle.
 */
export const CACHE_TYPE_CYCLE = ["q4_0", "q5_1", "q8_0", "f16"];

/**
 * Reasoning budgets worth offering. 0 disables thinking; -1 is unrestricted and
 * is the documented failure mode, so it is last and carries a warning. A sweep
 * may persist any value, so the write path accepts any integer >= -1.
 */
export const REASONING_BUDGET_CYCLE = [0, 512, 1024, 1536, 3072, -1];

/** The sentinel llama-server reads as "do not cap thinking at all". */
export const UNRESTRICTED_REASONING_BUDGET = -1;

/**
 * The user-facing name for a budget. `-1` is never shown raw: it is a sentinel,
 * not a token count, and printing it next to a `0` row invites the reading that
 * one of them means "less thinking" than the other when `-1` means the most
 * possible. "unrestricted" is the one word for it everywhere (TUI, sweep table,
 * warnings) - do not introduce a synonym.
 */
export function formatReasoningBudget(budget: number): string {
  return budget === UNRESTRICTED_REASONING_BUDGET ? "unrestricted" : String(budget);
}

export const MAX_PARALLEL_SLOTS = 16;
/**
 * Ceiling on `cachedChats`. Generous on purpose: entries are small for a small
 * model and huge for a large one, so the honest guard is the RAM figure the
 * warning shows, not an arbitrary count.
 */
export const MAX_CACHED_CHATS = 64;
/**
 * What llama.cpp allows by default when no `--cache-ram` is emitted, in bytes.
 * `cachedChats` of 0 emits no flag, so the estimate for the Default option is
 * this fixed figure against the installed RAM - not the model's measured KV
 * cost, which is irrelevant here because the size does not depend on the model.
 */
export const ENGINE_DEFAULT_CACHE_RAM_BYTES = 8192 * 1024 * 1024;
export const MAX_GPU_LAYERS = 999;
export const MIN_CONTEXT_SIZE = 1024;
export const CONTEXT_STEP = 8192;
export const CONTEXT_MULTIPLIERS = [1, 2, 4];

/** The context ceiling: the model's native window, or a generous bound if unknown. */
export function nativeContextLimit(model: Model | null): number {
  const native = model?.metadata?.contextLength;
  return typeof native === "number" && native > 0 ? native : 1_000_000;
}

export function contextLimit(model: Model | null, multiplier = 1): number {
  return nativeContextLimit(model) * multiplier;
}

/** The editable fields, resolved against one model's capabilities. */
export function profileFieldDescriptors(
  model: Model | null,
  profile?: Profile | null,
): ProfileFieldDescriptor[] {
  const projector = model?.components?.find((component) => component.role === "vision_projector");
  const hasProjector = model?.components
    ? Boolean(projector?.available)
    : Boolean(model?.mmprojPath);
  // The template exposes a thinking channel at all - the gate for both reasoning
  // controls. Preservation used to be gated on `reasoningPreservation
  // .templateArgument` instead, which is detected by grepping the chat template
  // for a literal `preserve_thinking`/`preserve_reasoning` kwarg. Almost no
  // template spells it that way: llama.cpp decides the same question by probing
  // the rendered template, so it happily logs "chat template supports preserving
  // reasoning, consider enabling it via --reasoning-preserve" for a model whose
  // toggle Otto was hiding. The flag exists on every build we ship and defaults
  // to the template's own behavior when absent, so offering it wherever there is
  // reasoning to preserve costs nothing and stops hiding a working setting.
  const hasReasoning = Boolean(model?.metadata?.reasoning || model?.reasoningPreservation);
  const fields: ProfileFieldDescriptor[] = [
    {
      key: "contextMultiplier",
      label: "Context multiplier",
      kind: "cycle",
      description: "Stretches the context window past the model's native size with RoPE scaling.",
      options: CONTEXT_MULTIPLIERS,
      optionLabels: ["Off", "2×", "4×"],
      available: Boolean(model?.metadata?.contextLength),
      ...(model?.metadata?.contextLength ? {} : { unavailableReason: "native context unknown" }),
    },
    {
      key: "contextSize",
      label: "Context",
      kind: "number",
      description: "How many tokens of conversation the model can hold at once.",
      step: CONTEXT_STEP,
      min: MIN_CONTEXT_SIZE,
      max: contextLimit(model, profile?.contextMultiplier ?? 1),
      available: true,
    },
    {
      key: "cacheTypeK",
      label: "KV cache K",
      kind: "cycle",
      description: "Precision of the cached keys; lower saves VRAM and costs a little accuracy.",
      options: CACHE_TYPE_CYCLE,
      available: true,
    },
    {
      key: "cacheTypeV",
      label: "KV cache V",
      kind: "cycle",
      description: "Precision of the cached values; lower saves VRAM and costs a little accuracy.",
      options: CACHE_TYPE_CYCLE,
      available: true,
    },
    // The five KV/context settings that size and split the cache sit together,
    // in the order the math reads them: the window (multiplier, size), its
    // quantisation (K, V), how it is split (slots), and the RAM fallback
    // (cached chats). Flash attention is related but leaves the KV byte total
    // untouched, so it stays with the remaining options below.
    {
      key: "parallelSlots",
      label: "Parallel slots",
      kind: "number",
      description: "How many chats the model serves at once, each taking a share of the context.",
      step: 1,
      min: 1,
      max: MAX_PARALLEL_SLOTS,
      available: true,
    },
    {
      key: "cachedChats",
      label: "Cached KVs",
      kind: "number",
      description:
        "How many idle chats keep their state in system RAM so returning to one skips a re-read.",
      step: 1,
      min: 0,
      max: MAX_CACHED_CHATS,
      available: true,
    },
    {
      key: "flashAttention",
      label: "Flash attention",
      kind: "toggle",
      description: "A faster attention kernel, and what a quantised value cache requires.",
      available: true,
    },
    // Bundle models expose the projector in the component section below. Keep
    // the legacy profile field for hand-scanned single-file models, but do not
    // render two controls that write the same vision setting for bundles. It
    // belongs with the other options, right after flash attention.
    ...(model?.components
      ? []
      : [
          {
            key: "vision",
            label: "Vision",
            kind: "toggle" as const,
            description: "Loads the vision projector so the model can read images.",
            available: hasProjector,
            ...(hasProjector
              ? {}
              : {
                  unavailableReason: projector
                    ? "download the vision component first"
                    : "no projector",
                }),
          },
        ]),
    {
      key: "reasoningBudget",
      label: "Reasoning budget",
      kind: "cycle",
      description: "Caps how many tokens the model may think before it is told to answer.",
      options: REASONING_BUDGET_CYCLE,
      optionLabels: ["Thinking Off", "512", "1024", "1536", "3072", "Unrestricted"],
      min: -1,
      available: true,
    },
    // Extends the reasoning group, immediately after the budget it qualifies.
    {
      key: "preserveReasoning",
      label: "Preserve reasoning",
      kind: "cycle",
      description: "Keeps earlier thinking in the history instead of only the latest reply's.",
      options: [...PRESERVE_REASONING_CYCLE],
      optionLabels: ["Template default", "On", "Off"],
      optionValues: PRESERVE_REASONING_CYCLE.map(preserveReasoningFromOption),
      available: hasReasoning,
      ...(hasReasoning ? {} : { unavailableReason: "no thinking channel in this template" }),
    },
    {
      key: "gpuLayers",
      label: "GPU layers",
      kind: "number",
      description: "How many layers run on the GPU; any remainder runs on the CPU.",
      step: 1,
      min: 0,
      max: MAX_GPU_LAYERS,
      available: true,
    },
    // Sampling. These change what the model writes rather than what it costs, so
    // they sit after the hosting fields and contribute nothing to the budget.
    {
      key: "temperature",
      label: "Temperature",
      kind: "number",
      description: "How adventurous each next-token choice is; lower is more predictable.",
      ...SAMPLING_RANGES.temperature,
      available: true,
    },
    {
      key: "topP",
      label: "Top P",
      kind: "number",
      description: "Considers only the likeliest tokens whose probabilities add up to this share.",
      ...SAMPLING_RANGES.topP,
      available: true,
    },
    {
      key: "topK",
      label: "Top K",
      kind: "number",
      description: "Considers only this many of the likeliest tokens; 0 turns the limit off.",
      ...SAMPLING_RANGES.topK,
      available: true,
    },
    {
      key: "minP",
      label: "Min P",
      kind: "number",
      description: "Drops tokens less likely than this fraction of the best one; 0 turns it off.",
      ...SAMPLING_RANGES.minP,
      available: true,
    },
    {
      key: "presencePenalty",
      label: "Presence penalty",
      kind: "number",
      description: "Pushes toward new subjects by penalising tokens already used; 0 turns it off.",
      ...SAMPLING_RANGES.presencePenalty,
      available: true,
    },
    {
      key: "repeatPenalty",
      label: "Repetition penalty",
      kind: "number",
      description: "Discourages repeating recent tokens; 1 turns it off.",
      ...SAMPLING_RANGES.repeatPenalty,
      available: true,
    },
  ];

  return fields;
}

/** A note attached to a field, or to the profile as a whole when `field` is null. */
export interface ProfileWarning {
  field: string | null;
  /**
   * `info` renders as muted text, `warn` as yellow. `error` is red: the
   * Cached KVs estimate earns it when the parked state would use at least the
   * machine's whole RAM.
   */
  severity: "info" | "warn" | "error";
  message: string;
  /** True when this combination cannot start, as opposed to merely being unwise. */
  blocksStart: boolean;
}

/** Whether a KV cache type is quantised (anything that is not a float type). */
function isQuantised(cacheType: string): boolean {
  return /^q/i.test(cacheType);
}

/** The notes a UI shows beside the fields, and the reason a load would be refused. */
export function profileWarnings(
  profile: Profile,
  model: Model | null,
  store?: ProfilesStore | null,
): ProfileWarning[] {
  const warnings: ProfileWarning[] = [];

  if (!profile.flashAttention && isQuantised(profile.cacheTypeV)) {
    warnings.push({
      field: "flashAttention",
      severity: "warn",
      message: "A quantised V cache requires flash attention.",
      blocksStart: true,
    });
  }

  if (profile.reasoningBudget === -1) {
    warnings.push({
      field: "reasoningBudget",
      severity: "warn",
      message:
        "Unrestricted: a thinking model can spend its whole token allowance reasoning and return no content.",
      blocksStart: false,
    });
  }

  if (profile.parallelSlots > 1) {
    const perSlot =
      profile.contextSize > 0 ? Math.floor(profile.contextSize / profile.parallelSlots) : null;
    warnings.push({
      field: "parallelSlots",
      severity: "info",
      message:
        perSlot !== null
          ? `${profile.parallelSlots} concurrent chats: ~${Math.round(
              perSlot / 1000,
            )}K context each, all resident.`
          : `${profile.parallelSlots} concurrent requests, sharing one KV pool.`,
      blocksStart: false,
    });
  }

  // The estimate is shown whenever this field is available, including at the
  // Default of 0. That is the one value the user could not otherwise price:
  // 0 emits no flag, and llama.cpp then parks up to its own 8 GiB cache-ram
  // default in system RAM, which is not the same as caching nothing.
  //
  // A count above 0 can only be priced from a measurement: without one the
  // theoretical KV cost runs to multiples of the real one, and naming a figure
  // derived from it would invite reserving several times the RAM actually
  // needed. So the unmeasured count falls back to the calibration request.
  const calibration = model && store ? getCalibration(store, model, profile) : null;
  const cache = model ? promptCacheSize(model, profile, calibration) : null;
  const hasCount = (profile.cachedChats ?? 0) > 0;
  if (hasCount && (!cache || cache.source !== "measured")) {
    warnings.push({
      field: "cachedChats",
      severity: "warn",
      message:
        "Calibrate this model first: without a measured KV cost the RAM this needs cannot be sized, so llama.cpp's own cache limit stays in effect.",
      blocksStart: false,
    });
  } else {
    const totalBytes = hasCount ? cache!.totalBytes : ENGINE_DEFAULT_CACHE_RAM_BYTES;
    const installed = formatGiB(os.totalmem());
    warnings.push({
      field: "cachedChats",
      // Yellow at half the machine's RAM, red once the parked state would use
      // at least all of it.
      severity:
        totalBytes >= os.totalmem() ? "error" : totalBytes >= os.totalmem() / 2 ? "warn" : "info",
      message: hasCount
        ? `${formatGiB(cache!.perChatBytes)} each becomes ${formatGiB(totalBytes)} of ${installed}.`
        : `llama.cpp's own limit applies: about ${formatGiB(totalBytes)} of ${installed}.`,
      blocksStart: false,
    });
  }

  if (profile.contextMultiplier > 1) {
    warnings.push({
      field: "contextMultiplier",
      severity: "warn",
      message: `YaRN ×${profile.contextMultiplier} extrapolates beyond the native context. Recalibrate before relying on this profile.`,
      blocksStart: false,
    });
  }

  // Distinct from `calibrationRequired`, which says this profile has never been
  // measured in its current shape. This says a measurement exists but was taken
  // for other cache types, so it names the reason rather than just the verdict.
  if (model && store && hasStaleCalibration(store, model, profile)) {
    warnings.push({
      field: "cacheTypeK",
      severity: "info",
      message: "Cache types changed since the last measurement. Recalibrate for a real budget.",
      blocksStart: false,
    });
  }

  return warnings;
}

/** Where a model's KV bytes/token figure came from. */
export type CalibrationState = "measured" | "inherited" | "stale" | "theoretical" | "unknown";

export interface CalibrationInfo {
  state: CalibrationState;
  kvBytesPerToken: number | null;
  measuredAt: string | null;
  /** For `inherited`, the relative the measurement came from. */
  measuredOn: string | null;
}

/**
 * Classify the calibration backing this profile's budget. `inherited` means the
 * figure came from a relative with the same attention geometry rescaled to this
 * model's layer count, which the UI must never present as measured on this file.
 */
export function calibrationInfo(
  store: ProfilesStore,
  model: Model,
  profile: Profile,
): CalibrationInfo {
  // A historical measurement is invalid as soon as any VRAM-affecting setting
  // changes. Keep the data for comparison, but do not present or use it as the
  // current model budget until a calibration commits the new profile.
  if (profile.calibrationRequired) {
    return {
      state: "theoretical",
      kvBytesPerToken: null,
      measuredAt: null,
      measuredOn: null,
    };
  }
  const calibration: Calibration | null = getCalibration(store, model, profile);
  if (!calibration) {
    return {
      state: hasStaleCalibration(store, model, profile) ? "stale" : "theoretical",
      kvBytesPerToken: null,
      measuredAt: null,
      measuredOn: null,
    };
  }
  return {
    state: calibration.inherited ? "inherited" : "measured",
    kvBytesPerToken: calibration.kvBytesPerToken,
    measuredAt: calibration.measuredAt ?? null,
    measuredOn: calibration.measuredOn ?? null,
  };
}

export interface SanitizeResult {
  profile: Profile;
  /** Fields the patch named that were clamped, coerced, or dropped. */
  adjustments: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * The settings whose value changes what a calibration would measure - the KV
 * cache system (cache types, attention configuration, loaded components) or the
 * evaluation (the extended RoPE shape). Only these may set
 * `calibrationRequired`.
 *
 * `contextSize` is deliberately absent. A calibration measures bytes *per
 * token* - the context size is the independent variable it varies to get the
 * slope, so the result is by construction the same at any context, and
 * `calibrationKey` does not record it either. Listing it here invalidated the
 * measurement on every context edit, including the one "Fit to VRAM" makes
 * itself: the fit picked a context from the measured figure, the write that
 * saved it dropped back to the (~4x higher) theoretical estimate, and the
 * saved context was then far past the budget it had just been sized against.
 *
 * `gpuLayers` and `parallelSlots` are absent for the same differential reason:
 * they only move weights between devices or split the one KV pool across slots.
 * The calibration is the GPU-delta between two loads at different contexts, so
 * every fixed term - weights wherever they sit, the CUDA context, compute
 * buffers - cancels out of the slope, and a load whose KV split to CPU is
 * rejected as unusable rather than measured low. Neither the bytes/token nor the
 * evaluation changes, so neither may discard a real measurement.
 *
 * `cachedChats` is absent because it spends host RAM, not VRAM, and never
 * reaches the load a calibration measures.
 */
const CALIBRATION_INPUTS = [
  "contextMultiplier",
  "cacheTypeK",
  "cacheTypeV",
  "flashAttention",
  "vision",
  "enabledComponents",
] as const;

/** Every calibration input is a scalar except the component id list, which is a set. */
function sameCalibrationInput(before: unknown, after: unknown): boolean {
  if (Array.isArray(before) && Array.isArray(after)) {
    return [...before].sort().join("\0") === [...after].sort().join("\0");
  }
  return before === after;
}

/**
 * Apply an editable patch to a profile, clamping every field to its range and
 * dropping anything the model cannot use.
 *
 * Only the supported editable keys are honoured. `modelPath`/`mmprojPath`/`modelId`
 * are re-derived from the model on every read (`profiles.forModel`), so letting
 * a caller set them would be a lie at best and a path-traversal at worst.
 * `reasoningBudgetMessage`, `batchSize`, `ubatchSize` and `extraArgs` stay
 * CLI-only: they have no measured effect worth exposing and `extraArgs` is
 * arbitrary process arguments.
 */
export function sanitizeProfilePatch(
  current: Profile,
  patch: unknown,
  model: Model | null,
  runtimeBuild: number | null = null,
): SanitizeResult {
  const adjustments: string[] = [];
  const next: Profile = { ...current };
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    throw new Error("profile patch must be an object");
  }
  const p = patch as Record<string, unknown>;

  const takeNumber = (key: string, min: number, max: number): void => {
    if (!(key in p)) return;
    const raw = p[key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      throw new Error(`${key} must be a number`);
    }
    const rounded = Math.round(raw);
    const clamped = clamp(rounded, min, max);
    if (clamped !== rounded) adjustments.push(`${key} clamped to ${clamped}`);
    (next as Record<string, unknown>)[key] = clamped;
  };

  const takeBoolean = (key: string): void => {
    if (!(key in p)) return;
    if (typeof p[key] !== "boolean") throw new Error(`${key} must be a boolean`);
    (next as Record<string, unknown>)[key] = p[key];
  };

  /**
   * A sampler value: clamped to its useful range and rounded to the precision
   * the editor advertises. Rounding matters as much as clamping - a stepper that
   * added 0.05 six times sends 0.30000000000000004, and without this the profile
   * would store that and hand it to llama-server on the command line.
   */
  const takeSampling = (key: keyof typeof SAMPLING_RANGES): void => {
    if (!(key in p)) return;
    const raw = p[key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      throw new Error(`${key} must be a number`);
    }
    const range = SAMPLING_RANGES[key];
    const precision = "precision" in range ? range.precision : 0;
    const rounded = Number(raw.toFixed(precision));
    const clamped = clamp(rounded, range.min, range.max);
    if (clamped !== rounded) adjustments.push(`${key} clamped to ${clamped}`);
    (next as Record<string, unknown>)[key] = clamped;
  };

  const takeCacheType = (key: string): void => {
    if (!(key in p)) return;
    const raw = p[key];
    if (typeof raw !== "string") throw new Error(`${key} must be a string`);
    const value = raw.toLowerCase();
    if (!(value in CACHE_TYPE_BYTES)) {
      throw new Error(`unknown KV cache type "${raw}"`);
    }
    (next as Record<string, unknown>)[key] = value;
  };

  if ("contextMultiplier" in p) {
    const raw = p.contextMultiplier;
    if (typeof raw !== "number" || !CONTEXT_MULTIPLIERS.includes(raw)) {
      throw new Error("contextMultiplier must be one of 1, 2, or 4");
    }
    next.contextMultiplier = raw;
  }
  takeNumber("contextSize", MIN_CONTEXT_SIZE, contextLimit(model, next.contextMultiplier));
  takeCacheType("cacheTypeK");
  takeCacheType("cacheTypeV");
  takeBoolean("flashAttention");
  takeNumber("gpuLayers", 0, MAX_GPU_LAYERS);
  takeNumber("parallelSlots", 1, MAX_PARALLEL_SLOTS);
  takeNumber("cachedChats", 0, MAX_CACHED_CHATS);

  // -1 (unrestricted) is the floor; anything below it is meaningless to
  // llama-server. There is no upper bound worth inventing: a budget larger than
  // the context is simply never reached.
  if ("reasoningBudget" in p) {
    const raw = p.reasoningBudget;
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      throw new Error("reasoningBudget must be a number");
    }
    const rounded = Math.round(raw);
    const value = rounded < -1 ? -1 : rounded;
    if (value !== rounded) adjustments.push(`reasoningBudget clamped to ${value}`);
    next.reasoningBudget = value;
  }

  // Tri-state, and the third state is the point: null means "leave the template's
  // own behavior alone", which is not the same as false ("trim the trace"). The
  // string forms are accepted because the editor renders this as a cycle whose
  // options are strings on the wire.
  if ("preserveReasoning" in p) {
    const raw = p.preserveReasoning;
    if (raw === null || raw === "default") {
      next.preserveReasoning = null;
    } else if (typeof raw === "boolean") {
      next.preserveReasoning = raw;
    } else if (raw === "on" || raw === "off") {
      next.preserveReasoning = preserveReasoningFromOption(raw);
    } else {
      throw new Error('preserveReasoning must be a boolean, null, or one of "default"/"on"/"off"');
    }
  }

  takeSampling("temperature");
  takeSampling("topP");
  takeSampling("topK");
  takeSampling("minP");
  takeSampling("presencePenalty");
  takeSampling("repeatPenalty");

  // Vision is only real when the model actually has a projector paired with it.
  if ("vision" in p) {
    if (typeof p.vision !== "boolean") throw new Error("vision must be a boolean");
    if (p.vision && !model?.mmprojPath) {
      adjustments.push("vision ignored: this model has no projector");
      next.vision = false;
    } else {
      next.vision = p.vision;
    }
  }

  if ("enabledComponents" in p) {
    if (
      !Array.isArray(p.enabledComponents) ||
      !p.enabledComponents.every((id) => typeof id === "string")
    ) {
      throw new Error("enabledComponents must be an array of component ids");
    }
    const requested = [...new Set(p.enabledComponents)];
    const requiredBuild = requested
      .map((id) => model?.components?.find((component) => component.id === id))
      .find(
        (component) =>
          component?.minRuntimeBuild !== undefined &&
          (runtimeBuild === null || runtimeBuild < component.minRuntimeBuild),
      )?.minRuntimeBuild;
    if (requiredBuild !== undefined) {
      const active = runtimeBuild === null ? "unknown" : `b${runtimeBuild}`;
      throw new Error(
        `components require llama.cpp build b${requiredBuild} or newer (active build: ${active})`,
      );
    }
    const available = new Set(
      model?.components
        ?.filter((component) => component.available)
        .map((component) => component.id) ?? [],
    );
    const unavailable = requested.filter((id) => !available.has(id));
    if (unavailable.length)
      throw new Error(`components are not downloaded: ${unavailable.join(", ")}`);
    next.enabledComponents = requested;
    const projector = model?.components?.find(
      (component) => component.role === "vision_projector" && requested.includes(component.id),
    );
    if (model?.components) next.vision = Boolean(projector);
  }

  // A partial patch may lower the multiplier without naming contextSize. Clamp
  // the saved value after every field has settled so launch args can never keep
  // an extended context after YaRN has been turned off.
  const contextSize = clamp(
    next.contextSize,
    MIN_CONTEXT_SIZE,
    contextLimit(model, next.contextMultiplier),
  );
  if (contextSize !== next.contextSize) {
    next.contextSize = contextSize;
    adjustments.push(`contextSize clamped to ${contextSize}`);
  }

  // The saved profile carries the calibration verdict. Do not infer it from
  // whether an old measurement happens to exist: a person who changes settings,
  // leaves, and returns must still be told to calibrate this new configuration.
  //
  // Compare values, never key presence. The editor autosaves the whole draft on
  // every edit, so every one of these keys is in `p` every time; keying off
  // presence threw away a real measurement whenever any unrelated field - or a
  // hosting-profile choice, which does not touch VRAM at all - was saved.
  const before = current as unknown as Record<string, unknown>;
  const after = next as unknown as Record<string, unknown>;
  if (CALIBRATION_INPUTS.some((key) => !sameCalibrationInput(before[key], after[key]))) {
    next.calibrationRequired = true;
  }

  return { profile: next, adjustments };
}
