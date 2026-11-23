/** Public inference metadata comes from the actual owning model/profile, never client guesses. */
import type { Model } from "../types.js";
import type { Profile } from "../config/schema.js";

export function providerModel(model: Model, profile: Profile, state: string) {
  // Brain's template router always supports explicitly disabling a detected
  // reasoning control. Catalog levels alone omit that switch on many models.
  const efforts =
    model.reasoningTemplate && model.reasoningEfforts
      ? [...new Set(["off", ...model.reasoningEfforts])]
      : [];
  return {
    id: model.id,
    object: "model",
    owned_by: "otto-brain",
    name: model.displayName,
    displayName: model.displayName,
    state,
    context_length: Math.max(
      1,
      Math.floor(profile.contextSize / Math.max(1, profile.parallelSlots)),
    ),
    architecture: { input_modalities: profile.vision ? ["text", "image"] : ["text"] },
    supported_parameters: ["tools", "max_tokens", ...(efforts.length ? ["reasoning_effort"] : [])],
    reasoning: { supported_efforts: efforts, default_effort: model.reasoningEffortDefault ?? null },
  };
}
