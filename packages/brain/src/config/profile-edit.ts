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
import { CACHE_TYPE_BYTES } from "../vram.js";
import type { Model } from "../types.js";
import { getCalibration, hasStaleCalibration } from "./profiles.js";
import type { Calibration, Profile, ProfilesStore } from "./schema.js";

/** How a client should render a field. */
export type ProfileFieldKind = "number" | "toggle" | "cycle";

export interface ProfileFieldDescriptor {
  key: string;
  label: string;
  kind: ProfileFieldKind;
  /** For `number`: the increment a stepper should use. */
  step?: number;
  min?: number;
  max?: number;
  /** For `cycle`: the values to offer, in order. */
  options?: (string | number)[];
  /** Labels for `options`, index-aligned, when the raw value is not presentable. */
  optionLabels?: string[];
  /** False when this model cannot use the field at all (vision with no projector). */
  available: boolean;
  /** Why it is unavailable, for the disabled-state hint. */
  unavailableReason?: string;
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
export const MAX_GPU_LAYERS = 999;
export const MIN_CONTEXT_SIZE = 1024;
export const CONTEXT_STEP = 8192;

/** The context ceiling: the model's native window, or a generous bound if unknown. */
export function nativeContextLimit(model: Model | null): number {
  const native = model?.metadata?.contextLength;
  return typeof native === "number" && native > 0 ? native : 1_000_000;
}

/** The editable fields, resolved against one model's capabilities. */
export function profileFieldDescriptors(model: Model | null): ProfileFieldDescriptor[] {
  const hasProjector = Boolean(model?.mmprojPath);
  return [
    {
      key: "contextSize",
      label: "Context",
      kind: "number",
      step: CONTEXT_STEP,
      min: MIN_CONTEXT_SIZE,
      max: nativeContextLimit(model),
      available: true,
    },
    {
      key: "cacheTypeK",
      label: "KV cache K",
      kind: "cycle",
      options: CACHE_TYPE_CYCLE,
      available: true,
    },
    {
      key: "cacheTypeV",
      label: "KV cache V",
      kind: "cycle",
      options: CACHE_TYPE_CYCLE,
      available: true,
    },
    { key: "flashAttention", label: "Flash attention", kind: "toggle", available: true },
    {
      key: "vision",
      label: "Vision",
      kind: "toggle",
      available: hasProjector,
      ...(hasProjector ? {} : { unavailableReason: "no projector" }),
    },
    {
      key: "reasoningBudget",
      label: "Reasoning budget",
      kind: "cycle",
      options: REASONING_BUDGET_CYCLE,
      optionLabels: ["Thinking Off", "512", "1024", "1536", "3072", "Unrestricted"],
      min: -1,
      available: true,
    },
    {
      key: "gpuLayers",
      label: "GPU layers",
      kind: "number",
      step: 1,
      min: 0,
      max: MAX_GPU_LAYERS,
      available: true,
    },
    {
      key: "parallelSlots",
      label: "Parallel slots",
      kind: "number",
      step: 1,
      min: 1,
      max: MAX_PARALLEL_SLOTS,
      available: true,
    },
  ];
}

/** A note attached to a field, or to the profile as a whole when `field` is null. */
export interface ProfileWarning {
  field: string | null;
  severity: "info" | "warn";
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
    warnings.push({
      field: "parallelSlots",
      severity: "info",
      message: `${profile.parallelSlots} concurrent requests, sharing one KV pool.`,
      blocksStart: false,
    });
  }

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
 * Apply an editable patch to a profile, clamping every field to its range and
 * dropping anything the model cannot use.
 *
 * Only the eight editable keys are honoured. `modelPath`/`mmprojPath`/`modelId`
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

  takeNumber("contextSize", MIN_CONTEXT_SIZE, nativeContextLimit(model));
  takeCacheType("cacheTypeK");
  takeCacheType("cacheTypeV");
  takeBoolean("flashAttention");
  takeNumber("gpuLayers", 0, MAX_GPU_LAYERS);
  takeNumber("parallelSlots", 1, MAX_PARALLEL_SLOTS);

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

  return { profile: next, adjustments };
}
