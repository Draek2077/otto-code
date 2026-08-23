import type { AgentModelDefinition, ProviderSnapshotEntry } from "@otto-code/protocol/agent-types";
import type { AgentProfile } from "@otto-code/protocol/messages";
import { checkPersonalityAvailability } from "@otto-code/protocol/agent-profiles";
import { resolveEffortOption } from "@otto-code/protocol/effort";
import { coerceModeForModel } from "./mode-support";

// App-side resolution of a personality into the concrete form values a picker
// auto-fills: provider, model, mode, and the model-specific thinking option the
// canonical effort maps to. Mirrors the daemon's spawn-time resolver but returns
// only what the form needs, reusing the same shared protocol primitives
// (availability + effort) so the app and daemon agree.
export interface PersonalityFormValues {
  provider: string;
  model: string;
  /** "" when the personality has no explicit mode and the provider has no default. */
  modeId: string;
  /** "" when no effort resolves (no effortLevel, or the model has no thinking options). */
  thinkingOptionId: string;
  /**
   * Provider feature toggles the template pins. Undefined when it pins none, so
   * a surface without a features row can ignore the field entirely.
   */
  featureValues?: Record<string, unknown>;
}

export type PersonalityFormResolution =
  | { available: true; values: PersonalityFormValues }
  | { available: false; reason: string };

// Auto support is per-model: fall back to the provider default when the model
// can't run the classifier (daemon-stamped supportsAutoMode: false).
function resolvePersonalityModeId(
  personality: AgentProfile,
  entry: ProviderSnapshotEntry,
  model: AgentModelDefinition,
): string {
  return (
    coerceModeForModel(personality.modeId ?? entry.defaultModeId ?? "", model) ||
    coerceModeForModel(entry.defaultModeId ?? "", model)
  );
}

// A stored template may name no model, meaning "this provider's default".
// Mirrors the daemon resolver so the app and daemon bind the same model.
function resolveFormModelId(
  personality: AgentProfile,
  entry: ProviderSnapshotEntry | undefined,
): string | undefined {
  return (
    personality.model ??
    entry?.models?.find((candidate) => candidate.isDefault)?.id ??
    entry?.models?.[0]?.id
  );
}

// An explicit provider-specific option id wins over the canonical effort level,
// the same precedence the daemon resolver uses.
function resolveFormThinkingOptionId(
  personality: AgentProfile,
  model: AgentModelDefinition,
): string {
  const requested = personality.thinkingOptionId ?? personality.effortLevel;
  if (!requested || !model.thinkingOptions || model.thinkingOptions.length === 0) {
    return "";
  }
  try {
    return resolveEffortOption({ requested, thinkingOptions: model.thinkingOptions }).optionId;
  } catch {
    // Model advertises only custom options that don't map to the canonical
    // scale - leave effort unset rather than guessing.
    return "";
  }
}

export function resolvePersonalityForForm(
  personality: AgentProfile,
  entries: readonly ProviderSnapshotEntry[],
): PersonalityFormResolution {
  const entry = entries.find((candidate) => candidate.provider === personality.provider);
  // Resolved BEFORE the availability check so the check and the filled-in form
  // agree on which model is actually being bound.
  const modelId = resolveFormModelId(personality, entry);
  const model = entry?.models?.find((candidate) => candidate.id === modelId);

  const availability = checkPersonalityAvailability(
    { ...personality, model: modelId },
    {
      providerStatus: entry?.status,
      providerEnabled: entry?.enabled,
      modelIds: entry?.models?.map((candidate) => candidate.id),
      modeIds: entry?.modes?.map((candidate) => candidate.id),
    },
  );
  if (!availability.available) {
    return { available: false, reason: availability.reason };
  }
  if (!entry || !model || modelId === undefined) {
    return { available: false, reason: `Model "${modelId ?? ""}" is not available.` };
  }

  return {
    available: true,
    values: {
      provider: personality.provider,
      model: modelId,
      modeId: resolvePersonalityModeId(personality, entry, model) ?? "",
      thinkingOptionId: resolveFormThinkingOptionId(personality, model),
      // Only carried when the template actually pins something, so a surface
      // can tell "pins nothing" from "pins an empty set".
      ...(personality.featureValues && Object.keys(personality.featureValues).length > 0
        ? { featureValues: personality.featureValues }
        : {}),
    },
  };
}
