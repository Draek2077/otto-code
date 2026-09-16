import type { AgentModelDefinition } from "./agent-sdk-types.js";
import { resolveEffortOption } from "./effort-levels.js";

/**
 * Choose the effort for a chat spawned from a parent onto a different model.
 *
 * Dropping the effort and letting the provider decide is a silent downgrade:
 * Codex fills a missing effort from the model's published default, which is
 * `low` for some models, so a task launched from a high-effort chat quietly ran
 * at low. Instead carry the parent's effort, mapped onto the destination
 * model's scale, and fall back to the destination's advertised default only
 * when the parent's effort has no equivalent there. `ultracode` is an opt-in
 * workflow, never an implicit default (matches the app's new-chat policy).
 *
 * Returns undefined when the destination model advertises no effort options,
 * so the provider keeps its own behavior.
 */
export function resolveCarriedOverEffort(params: {
  parentThinkingOptionId: string | null | undefined;
  models: readonly AgentModelDefinition[];
  model: string;
}): string | undefined {
  const definition = params.models.find(
    (candidate) => candidate.id === params.model || candidate.aliases?.includes(params.model),
  );
  const thinkingOptions = definition?.thinkingOptions;
  if (!definition || !thinkingOptions || thinkingOptions.length === 0) {
    return undefined;
  }
  const requested = params.parentThinkingOptionId?.trim();
  if (requested) {
    try {
      return resolveEffortOption({ requested, thinkingOptions }).optionId;
    } catch {
      // No equivalent on this model's scale; use its default below.
    }
  }
  const advertisedDefault =
    definition.defaultThinkingOptionId ?? thinkingOptions.find((option) => option.isDefault)?.id;
  if (advertisedDefault && advertisedDefault.toLowerCase() !== "ultracode") {
    return advertisedDefault;
  }
  return thinkingOptions.find((option) => option.id.toLowerCase() !== "ultracode")?.id;
}
