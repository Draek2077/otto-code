import type { ModelTier } from "@otto-code/protocol/agent-types";

/**
 * A model's capability tier as shown to the user. `undefined` means the daemon
 * couldn't classify the model and nobody tagged it - that reads as "Unknown"
 * rather than a guess (see protocol/model-tiers.ts).
 * TODO(i18n): inline English, translated in a later pass.
 */
export function modelTierLabel(tier: ModelTier | undefined): string {
  switch (tier) {
    case "deep":
      return "Deep";
    case "standard":
      return "Standard";
    case "fast":
      return "Fast";
    default:
      return "Unknown";
  }
}
