import {
  checkPersonalityAvailability,
  normalizePersonalityRoles,
  type PersonalityUnavailableCode,
} from "@otto-code/protocol/agent-profiles";
import type {
  AgentPersonalityVoice,
  AgentProfile,
  PersonalityRole,
} from "@otto-code/protocol/messages";
import { resolveEffortOption } from "./effort-levels.js";
import type { AgentSelectOption, ProviderSnapshotEntry } from "./agent-sdk-types.js";

/**
 * A profile resolved against a provider snapshot for one cwd - the concrete
 * settings blob snapshotted onto an agent at spawn. Everything here is frozen at
 * spawn time; later edits to the profile never mutate an already-spawned
 * agent (see the lifecycle section of the charter).
 *
 * This blob is persisted into stored agent JSON as `config.profileSnapshot`.
 * Records written before the convergence used `personalitySnapshot` with a
 * `personalityId` inside it; normalizeStoredAgentRecord renames both on read,
 * and a startup pass rewrites the files. See COMPAT(profileSnapshotKey).
 */
export interface ResolvedProfileSnapshot {
  profileId: string;
  name: string;
  provider: string;
  model: string;
  modeId?: string;
  /** The provider/model-specific thinking option the canonical effort resolved to. */
  thinkingOptionId?: string;
  /** The canonical effort level the profile requested (e.g. "high"). */
  effortLevel?: string;
  effortMatch?: "exact-id" | "level" | "nearest";
  /**
   * True when the model could not honor the requested effort exactly - either
   * the nearest option was substituted, or the model advertises options that
   * don't map to the canonical scale. Callers surface this as a warning; it is
   * NOT an availability failure.
   */
  effortDegraded: boolean;
  /** The personality prompt, destined for the agent's systemPrompt. */
  systemPrompt?: string;
  /** When false, the personality prompt stands alone (no global append stacked). */
  respectGlobalAppendPrompt: boolean;
  spinner?: { glowA: string; glowB: string };
  /**
   * The TTS voice for this personality's spoken identity. A soft binding: it is
   * carried through as-is and validated/fallen-back at playback time against the
   * host's speech options, never gated here (the resolver has no TTS catalog).
   */
  voice?: AgentPersonalityVoice;
  roles: PersonalityRole[];
  /** Provider feature toggles the profile pins. Applied alongside the brain. */
  featureValues?: Record<string, unknown>;
}

export type ProfileResolution =
  | { status: "available"; snapshot: ResolvedProfileSnapshot }
  | { status: "unavailable"; code: PersonalityUnavailableCode; reason: string };

/**
 * Resolve a profile to a concrete settings snapshot against the provider
 * entries for a target cwd, or report why it is out of commission. Effort is
 * mapped from the stored canonical level to the bound model's nearest advertised
 * option here, at resolution time - never stored pre-resolved.
 *
 * This is the ONE resolver. Every spawn path (the create RPC, the MCP
 * create_chat tool, the live personality switch) goes through it, so
 * availability is enforced identically everywhere instead of one path silently
 * spawning against a provider that is not installed.
 */
export function resolveProfile(
  profile: AgentProfile,
  entries: readonly ProviderSnapshotEntry[],
): ProfileResolution {
  const entry = entries.find((candidate) => candidate.provider === profile.provider);
  // A profile may name no model, meaning "whatever this provider defaults to".
  // Resolve that to a concrete id BEFORE the availability check so the check and
  // the snapshot agree on which model is actually being bound.
  const modelId = profile.model ?? resolveDefaultModelId(entry);
  const model = entry?.models?.find((candidate) => candidate.id === modelId);

  const availability = checkPersonalityAvailability(
    { provider: profile.provider, model: modelId, modeId: profile.modeId },
    {
      providerStatus: entry?.status,
      providerEnabled: entry?.enabled,
      modelIds: entry?.models?.map((candidate) => candidate.id),
      modeIds: entry?.modes?.map((candidate) => candidate.id),
    },
  );
  if (!availability.available) {
    return { status: "unavailable", code: availability.code, reason: availability.reason };
  }
  if (!entry || !model || modelId === undefined) {
    // Unreachable when availability passes (it already checked provider + model);
    // keeps the function total and the types honest without a non-null assertion.
    return {
      status: "unavailable",
      code: "model-missing",
      reason: `Model "${modelId ?? ""}" is not available from "${profile.provider}".`,
    };
  }

  const modeId = profile.modeId ?? resolveFallbackModeId(entry);
  // A profile may pin an exact provider-specific option id (`thinkingOptionId`)
  // where a personality could only name a canonical level (`effortLevel`). The
  // pinned id wins: re-deriving one from the level would quietly replace the
  // user's explicit choice. resolveEffortOption matches an exact option id
  // before it tries the canonical scale, so one call covers both.
  const effort = resolveProfileEffort(
    profile.thinkingOptionId ?? profile.effortLevel,
    model.thinkingOptions,
  );
  return { status: "available", snapshot: buildSnapshot(profile, modelId, modeId, effort) };
}

// The model a profile binds when it names none. Prefers the provider's declared
// default and falls back to its first advertised model, matching what the
// upstream profile apply path did before the two systems converged.
function resolveDefaultModelId(entry: ProviderSnapshotEntry | undefined): string | undefined {
  return entry?.models?.find((candidate) => candidate.isDefault)?.id ?? entry?.models?.[0]?.id;
}

// The provider's defaultModeId can go stale relative to its modes catalog;
// availability only validates the personality's own modeId, so an unvalidated
// fallback would pass resolution and then throw inside setMode at apply time.
function resolveFallbackModeId(entry: ProviderSnapshotEntry): string | undefined {
  const fallback = entry.defaultModeId ?? undefined;
  if (!fallback) {
    return undefined;
  }
  if (entry.modes && entry.modes.length > 0 && !entry.modes.some((mode) => mode.id === fallback)) {
    return undefined;
  }
  return fallback;
}

type ResolvedEffort = ReturnType<typeof resolveProfileEffort>;

// Assemble the snapshot blob, omitting undefined optional fields so `toEqual`
// comparisons and downstream JSON stay clean. Kept separate from
// resolveProfile so the per-field guards don't inflate that function's
// cyclomatic complexity.
function buildSnapshot(
  profile: AgentProfile,
  modelId: string,
  modeId: string | undefined,
  effort: ResolvedEffort,
): ResolvedProfileSnapshot {
  const snapshot: ResolvedProfileSnapshot = {
    profileId: profile.id,
    name: profile.name,
    provider: profile.provider,
    model: modelId,
    effortDegraded: effort.degraded,
    respectGlobalAppendPrompt: profile.respectGlobalAppendPrompt ?? true,
    roles: normalizePersonalityRoles(profile.roles),
  };
  if (modeId !== undefined) {
    snapshot.modeId = modeId;
  }
  if (effort.thinkingOptionId !== undefined) {
    snapshot.thinkingOptionId = effort.thinkingOptionId;
  }
  if (profile.effortLevel !== undefined) {
    snapshot.effortLevel = profile.effortLevel;
  }
  if (effort.matched !== undefined) {
    snapshot.effortMatch = effort.matched;
  }
  if (profile.personalityPrompt !== undefined) {
    snapshot.systemPrompt = profile.personalityPrompt;
  }
  if (profile.spinner !== undefined) {
    snapshot.spinner = profile.spinner;
  }
  if (profile.voice !== undefined) {
    snapshot.voice = profile.voice;
  }
  if (profile.featureValues !== undefined && Object.keys(profile.featureValues).length > 0) {
    snapshot.featureValues = profile.featureValues;
  }
  return snapshot;
}

function resolveProfileEffort(
  effortLevel: string | undefined,
  thinkingOptions: readonly AgentSelectOption[] | undefined,
): {
  thinkingOptionId?: string;
  matched?: "exact-id" | "level" | "nearest";
  degraded: boolean;
} {
  if (!effortLevel || !thinkingOptions || thinkingOptions.length === 0) {
    return { degraded: false };
  }
  try {
    const resolved = resolveEffortOption({ requested: effortLevel, thinkingOptions });
    return {
      thinkingOptionId: resolved.optionId,
      matched: resolved.matched,
      degraded: resolved.matched === "nearest",
    };
  } catch {
    // The model advertises thinking options but none map to the canonical scale
    // (fully custom option ids). Leave effort unset rather than failing the
    // profile - the agent still runs, just without a matched thinking level.
    return { degraded: true };
  }
}
