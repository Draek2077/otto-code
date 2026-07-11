import type { ProviderSnapshotEntry } from "@otto-code/protocol/agent-types";
import type { AgentPersonality } from "@otto-code/protocol/messages";
import { checkPersonalityAvailability } from "@otto-code/protocol/agent-personalities";
import { resolveEffortOption } from "@otto-code/protocol/effort";

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
}

export type PersonalityFormResolution =
  | { available: true; values: PersonalityFormValues }
  | { available: false; reason: string };

export function resolvePersonalityForForm(
  personality: AgentPersonality,
  entries: readonly ProviderSnapshotEntry[],
): PersonalityFormResolution {
  const entry = entries.find((candidate) => candidate.provider === personality.provider);
  const model = entry?.models?.find((candidate) => candidate.id === personality.model);

  const availability = checkPersonalityAvailability(personality, {
    providerStatus: entry?.status,
    providerEnabled: entry?.enabled,
    modelIds: entry?.models?.map((candidate) => candidate.id),
    modeIds: entry?.modes?.map((candidate) => candidate.id),
  });
  if (!availability.available) {
    return { available: false, reason: availability.reason };
  }
  if (!entry || !model) {
    return { available: false, reason: `Model "${personality.model}" is not available.` };
  }

  const modeId = personality.modeId ?? entry.defaultModeId ?? "";
  let thinkingOptionId = "";
  if (personality.effortLevel && model.thinkingOptions && model.thinkingOptions.length > 0) {
    try {
      thinkingOptionId = resolveEffortOption({
        requested: personality.effortLevel,
        thinkingOptions: model.thinkingOptions,
      }).optionId;
    } catch {
      // Model advertises only custom options that don't map to the canonical
      // scale — leave effort unset rather than guessing.
      thinkingOptionId = "";
    }
  }

  return {
    available: true,
    values: {
      provider: personality.provider,
      model: personality.model,
      modeId: modeId ?? "",
      thinkingOptionId,
    },
  };
}
