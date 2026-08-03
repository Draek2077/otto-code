import type { AgentFeature, AgentModelDefinition } from "@otto-code/protocol/agent-types";
import { i18n } from "@/i18n/i18next";

export type ExplainedAgentControl = "mode" | "model" | "thinking";
export type FeatureHighlightColor = "blue" | "default" | "green" | "yellow";
export type AgentControlHintKey =
  | "agentControls.hints.thinking"
  | "agentControls.hints.model"
  | "agentControls.hints.mode";

export function getAgentControlHintKey(selector: ExplainedAgentControl): AgentControlHintKey {
  switch (selector) {
    case "thinking":
      return "agentControls.hints.thinking";
    case "model":
      return "agentControls.hints.model";
    case "mode":
      return "agentControls.hints.mode";
    default:
      throw new Error("unreachable");
  }
}

export function normalizeModelId(modelId: string | null | undefined): string | null {
  const normalized = typeof modelId === "string" ? modelId.trim() : "";
  if (!normalized) {
    return null;
  }
  return normalized;
}

export function getFeatureTooltip(feature: Pick<AgentFeature, "label" | "tooltip">): string {
  return feature.tooltip ?? feature.label;
}

/** Theme colors for the named mode color tiers (see AgentModeColorTier). */
export interface ModeTierColors {
  safe: string;
  moderate: string;
  dangerous: string;
  planning: string;
}

/**
 * Resolves a mode's colorTier to a concrete color. Returns undefined for
 * "neutral" and unknown tiers so callers fall back to their default color.
 */
export function getModeTierColor(
  colorTier: string | undefined,
  palette: ModeTierColors,
): string | undefined {
  if (!colorTier) return undefined;
  if (colorTier.startsWith("#")) return colorTier;
  if (colorTier in palette) return palette[colorTier as keyof ModeTierColors];
  return undefined;
}

/**
 * Applies an alpha channel to a hex color (#rgb or #rrggbb). Returns undefined
 * for anything else so callers skip the treatment rather than paint garbage.
 */
export function hexColorWithAlpha(color: string, alpha: number): string | undefined {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (!match) return undefined;
  let hex = match[1];
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const alphaHex = Math.round(Math.min(Math.max(alpha, 0), 1) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${hex}${alphaHex}`;
}

export function getFeatureHighlightColor(featureId: string): FeatureHighlightColor {
  switch (featureId) {
    case "fast_mode":
      return "yellow";
    case "auto_accept":
      return "green";
    case "plan_mode":
      return "blue";
    default:
      return "default";
  }
}

interface ControlLabelInput {
  id: string;
  label?: string | null;
}

function sentenceCase(value: string): string {
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function splitCompactLabel(value: string, splitHyphen: boolean): string {
  const separatorPattern = splitHyphen ? /[_-]+/g : /_+/g;

  return value
    .replace(separatorPattern, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function formatControlLabel(option: ControlLabelInput, splitHyphen: boolean): string {
  const rawLabel = (option.label ?? option.id).trim();
  return sentenceCase(splitCompactLabel(rawLabel, splitHyphen));
}

export function formatAgentModeLabel(mode: ControlLabelInput): string {
  return formatControlLabel(mode, mode.label == null);
}

export function formatThinkingOptionLabel(option: ControlLabelInput): string {
  const rawLabel = (option.label ?? option.id).trim();
  const compactId = option.id.replace(/[\s_-]+/g, "").toLowerCase();
  const compactLabel = rawLabel.replace(/[\s_-]+/g, "").toLowerCase();

  if (compactId === "xhigh" || compactLabel === "xhigh") {
    return i18n.t("agentControls.thinking.extraHigh");
  }

  return formatControlLabel(option, true);
}

function findModelById(
  models: AgentModelDefinition[] | null,
  modelId: string | null,
): AgentModelDefinition | null {
  if (!models || !modelId) {
    return null;
  }
  return models.find((model) => model.id === modelId) ?? null;
}

function getFallbackModel(models: AgentModelDefinition[] | null): AgentModelDefinition | null {
  return models?.find((model) => model.isDefault) ?? models?.[0] ?? null;
}

/**
 * The configured model is the user's explicit selection, so it wins whenever it
 * resolves to a real model in the provider catalog. The runtime model is only
 * what the provider reported for the LAST turn — it lags a fresh switch (the
 * provider keeps reporting the old model until its query restarts) and under
 * Claude's Auto mode it names whatever the CLI picked for that turn. Preferring
 * it here is what made a mid-chat switch silently revert in the picker.
 * Runtime stays the fallback: an agent spawned without an explicit model has no
 * configured id, and runtime is then the only honest answer.
 */
function resolvePreferredModelId(
  configuredSelectedModel: AgentModelDefinition | null,
  runtimeSelectedModel: AgentModelDefinition | null,
  normalizedConfiguredModelId: string | null,
  normalizedRuntimeModelId: string | null,
): string | null {
  return (
    configuredSelectedModel?.id ??
    runtimeSelectedModel?.id ??
    normalizedConfiguredModelId ??
    normalizedRuntimeModelId
  );
}

function pickSelectedModel(
  models: AgentModelDefinition[] | null,
  preferredModelId: string | null,
  fallbackModel: AgentModelDefinition | null,
): AgentModelDefinition | null {
  if (!models || !preferredModelId) {
    return fallbackModel;
  }
  return findModelById(models, preferredModelId) ?? fallbackModel;
}

function resolveThinkingId(
  explicitThinkingOptionId: string | null | undefined,
  selectedModel: AgentModelDefinition | null,
): string | null {
  if (explicitThinkingOptionId && explicitThinkingOptionId !== "default") {
    return explicitThinkingOptionId;
  }
  return selectedModel?.defaultThinkingOptionId ?? null;
}

type ThinkingOption = NonNullable<AgentModelDefinition["thinkingOptions"]>[number];

function resolveEffectiveThinking(
  thinkingOptions: ThinkingOption[] | null,
  resolvedThinkingId: string | null,
): ThinkingOption | null {
  const selectedThinking =
    thinkingOptions?.find((option) => option.id === resolvedThinkingId) ?? null;
  return selectedThinking ?? thinkingOptions?.[0] ?? null;
}

function resolveModelDisplay(
  selectedModel: AgentModelDefinition | null,
  preferredModelId: string | null,
  fallbackModel: AgentModelDefinition | null,
  unknownModelLabel: string,
): { activeModelId: string | null; displayModel: string } {
  return {
    activeModelId: selectedModel?.id ?? preferredModelId ?? null,
    displayModel:
      selectedModel?.label ?? preferredModelId ?? fallbackModel?.label ?? unknownModelLabel,
  };
}

function resolveThinkingDisplay(
  effectiveThinking: ThinkingOption | null,
  selectedThinkingId: string | null,
  unknownThinkingLabel: string,
): string {
  if (effectiveThinking) {
    return formatThinkingOptionLabel(effectiveThinking);
  }

  if (selectedThinkingId) {
    return formatThinkingOptionLabel({ id: selectedThinkingId });
  }

  return unknownThinkingLabel;
}

/**
 * The model the provider reported for the LAST turn, stated as a fact only when
 * it is not the one the picker is already showing. This is the counterweight to
 * resolveAgentModelSelection preferring the configured choice: under a mode that
 * picks the model itself (Claude's Auto) the turn can run on something else, and
 * without this there would be nowhere at all to see what that was.
 *
 * Returns a display LABEL, never an id and never a model. That is deliberate and
 * structural: a label cannot be fed back into the picker, which is keyed by id,
 * so this fact can never become a selection again. Do not change the return type
 * to an id or an AgentModelDefinition — preferring the runtime model in the
 * selection is exactly the bug this pair of functions exists to keep fixed.
 *
 * Null (say nothing) when:
 *  - there is no runtime model yet, e.g. a chat that has not run a turn;
 *  - the runtime model is not in the provider catalog, so we cannot name it
 *    honestly — a raw dated id like `claude-opus-5-20260101` is noise, and it
 *    reads as a difference when it is usually the same model;
 *  - it matches the selection, where the row would just restate the headline.
 */
export function resolveRuntimeModelFact(input: {
  models: AgentModelDefinition[] | null;
  runtimeModelId: string | null | undefined;
  /** The id the picker settled on, i.e. resolveAgentModelSelection's activeModelId. */
  selectedModelId: string | null | undefined;
}): string | null {
  const normalizedRuntimeModelId = normalizeModelId(input.runtimeModelId);
  if (!normalizedRuntimeModelId) {
    return null;
  }
  const runtimeModel = findModelById(input.models, normalizedRuntimeModelId);
  if (!runtimeModel || runtimeModel.id === normalizeModelId(input.selectedModelId)) {
    return null;
  }
  return runtimeModel.label;
}

export function resolveAgentModelSelection(input: {
  models: AgentModelDefinition[] | null;
  runtimeModelId: string | null | undefined;
  configuredModelId: string | null | undefined;
  explicitThinkingOptionId: string | null | undefined;
}) {
  const { models, runtimeModelId, configuredModelId, explicitThinkingOptionId } = input;
  const normalizedRuntimeModelId = normalizeModelId(runtimeModelId);
  const normalizedConfiguredModelId = normalizeModelId(configuredModelId);

  const configuredSelectedModel = findModelById(models, normalizedConfiguredModelId);
  const runtimeSelectedModel = findModelById(models, normalizedRuntimeModelId);
  const preferredModelId = resolvePreferredModelId(
    configuredSelectedModel,
    runtimeSelectedModel,
    normalizedConfiguredModelId,
    normalizedRuntimeModelId,
  );
  const fallbackModel = getFallbackModel(models);
  const selectedModel = pickSelectedModel(models, preferredModelId, fallbackModel);

  const { activeModelId, displayModel } = resolveModelDisplay(
    selectedModel,
    preferredModelId,
    fallbackModel,
    i18n.t("agentControls.model.unknown"),
  );

  const thinkingOptions = selectedModel?.thinkingOptions ?? null;
  const resolvedThinkingId = resolveThinkingId(explicitThinkingOptionId, selectedModel);
  const effectiveThinking = resolveEffectiveThinking(thinkingOptions, resolvedThinkingId);
  const selectedThinkingId = effectiveThinking?.id ?? null;
  const displayThinking = resolveThinkingDisplay(
    effectiveThinking,
    selectedThinkingId,
    i18n.t("agentControls.thinking.unknown"),
  );

  return {
    selectedModel,
    activeModelId,
    displayModel,
    thinkingOptions,
    selectedThinkingId,
    displayThinking,
  };
}
