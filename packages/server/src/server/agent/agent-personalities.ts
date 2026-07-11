import {
  checkPersonalityAvailability,
  normalizePersonalityRoles,
  type PersonalityUnavailableCode,
} from "@otto-code/protocol/agent-personalities";
import type {
  AgentPersonality,
  AgentPersonalityVoice,
  PersonalityRole,
} from "@otto-code/protocol/messages";
import { resolveEffortOption } from "./effort-levels.js";
import type { AgentSelectOption, ProviderSnapshotEntry } from "./agent-sdk-types.js";

/**
 * A personality resolved against a provider snapshot for one cwd — the concrete
 * settings blob snapshotted onto an agent at spawn. Everything here is frozen at
 * spawn time; later edits to the personality never mutate an already-spawned
 * agent (see the lifecycle section of the charter).
 */
export interface ResolvedPersonalitySnapshot {
  personalityId: string;
  name: string;
  provider: string;
  model: string;
  modeId?: string;
  /** The provider/model-specific thinking option the canonical effort resolved to. */
  thinkingOptionId?: string;
  /** The canonical effort level the personality requested (e.g. "high"). */
  effortLevel?: string;
  effortMatch?: "exact-id" | "level" | "nearest";
  /**
   * True when the model could not honor the requested effort exactly — either
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
}

export type PersonalityResolution =
  | { status: "available"; snapshot: ResolvedPersonalitySnapshot }
  | { status: "unavailable"; code: PersonalityUnavailableCode; reason: string };

/**
 * Resolve a personality to a concrete settings snapshot against the provider
 * entries for a target cwd, or report why it is out of commission. Effort is
 * mapped from the stored canonical level to the bound model's nearest advertised
 * option here, at resolution time — never stored pre-resolved.
 */
export function resolvePersonality(
  personality: AgentPersonality,
  entries: readonly ProviderSnapshotEntry[],
): PersonalityResolution {
  const entry = entries.find((candidate) => candidate.provider === personality.provider);
  const model = entry?.models?.find((candidate) => candidate.id === personality.model);

  const availability = checkPersonalityAvailability(personality, {
    providerStatus: entry?.status,
    providerEnabled: entry?.enabled,
    modelIds: entry?.models?.map((candidate) => candidate.id),
    modeIds: entry?.modes?.map((candidate) => candidate.id),
  });
  if (!availability.available) {
    return { status: "unavailable", code: availability.code, reason: availability.reason };
  }
  if (!entry || !model) {
    // Unreachable when availability passes (it already checked provider + model);
    // keeps the function total and the types honest without a non-null assertion.
    return {
      status: "unavailable",
      code: "model-missing",
      reason: `Model "${personality.model}" is not available from "${personality.provider}".`,
    };
  }

  const modeId = personality.modeId ?? resolveFallbackModeId(entry);
  const effort = resolvePersonalityEffort(personality.effortLevel, model.thinkingOptions);
  return { status: "available", snapshot: buildSnapshot(personality, modeId, effort) };
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

type ResolvedEffort = ReturnType<typeof resolvePersonalityEffort>;

// Assemble the snapshot blob, omitting undefined optional fields so `toEqual`
// comparisons and downstream JSON stay clean. Kept separate from
// resolvePersonality so the per-field guards don't inflate that function's
// cyclomatic complexity.
function buildSnapshot(
  personality: AgentPersonality,
  modeId: string | undefined,
  effort: ResolvedEffort,
): ResolvedPersonalitySnapshot {
  const snapshot: ResolvedPersonalitySnapshot = {
    personalityId: personality.id,
    name: personality.name,
    provider: personality.provider,
    model: personality.model,
    effortDegraded: effort.degraded,
    respectGlobalAppendPrompt: personality.respectGlobalAppendPrompt ?? true,
    roles: normalizePersonalityRoles(personality.roles),
  };
  if (modeId !== undefined) {
    snapshot.modeId = modeId;
  }
  if (effort.thinkingOptionId !== undefined) {
    snapshot.thinkingOptionId = effort.thinkingOptionId;
  }
  if (personality.effortLevel !== undefined) {
    snapshot.effortLevel = personality.effortLevel;
  }
  if (effort.matched !== undefined) {
    snapshot.effortMatch = effort.matched;
  }
  if (personality.personalityPrompt !== undefined) {
    snapshot.systemPrompt = personality.personalityPrompt;
  }
  if (personality.spinner !== undefined) {
    snapshot.spinner = personality.spinner;
  }
  if (personality.voice !== undefined) {
    snapshot.voice = personality.voice;
  }
  return snapshot;
}

function resolvePersonalityEffort(
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
    // personality — the agent still runs, just without a matched thinking level.
    return { degraded: true };
  }
}
