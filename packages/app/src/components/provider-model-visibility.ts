import type { ModelVisibilityOverride } from "@otto-code/protocol/messages";

export function isModelVisible(
  overrides: readonly ModelVisibilityOverride[],
  provider: string,
  modelId: string,
): boolean {
  return (
    overrides.findLast((entry) => entry.provider === provider && entry.modelId === modelId)
      ?.visible ?? true
  );
}

export function updateModelVisibilityOverrides(input: {
  overrides: readonly ModelVisibilityOverride[];
  provider: string;
  modelIds: readonly string[];
  visible: boolean;
}): ModelVisibilityOverride[] {
  const modelIds = new Set(input.modelIds);
  const next = input.overrides.filter(
    (entry) => entry.provider !== input.provider || !modelIds.has(entry.modelId),
  );
  if (!input.visible) {
    for (const modelId of modelIds) {
      next.push({ provider: input.provider, modelId, visible: false });
    }
  }
  return next;
}
