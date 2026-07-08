import type { AgentFeature, AgentFeatureSelect } from "../agent-sdk-types.js";

export const OPENAI_COMPAT_REASONING_EFFORTS = ["off", "low", "medium", "high"] as const;

export type OpenAICompatReasoningEffort = (typeof OPENAI_COMPAT_REASONING_EFFORTS)[number];

export const OPENAI_COMPAT_REASONING_FEATURE: Omit<AgentFeatureSelect, "value"> = {
  type: "select",
  id: "reasoning_effort",
  label: "Reasoning",
  description: "Reasoning effort requested from the model",
  tooltip: "Change reasoning",
  icon: "brain",
  options: [
    { id: "off", label: "Off", description: "Don't request reasoning", isDefault: true },
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium" },
    { id: "high", label: "High" },
  ],
};

/**
 * "off" omits the reasoning_effort parameter from requests entirely, so
 * endpoints that reject unknown parameters are unaffected until the user
 * opts in. Unknown persisted values also normalize to "off" rather than
 * failing the session.
 */
export function normalizeOpenAICompatReasoningEffort(value: unknown): OpenAICompatReasoningEffort {
  return OPENAI_COMPAT_REASONING_EFFORTS.includes(value as OpenAICompatReasoningEffort)
    ? (value as OpenAICompatReasoningEffort)
    : "off";
}

export function buildOpenAICompatFeatures(input: {
  reasoningEffort: OpenAICompatReasoningEffort;
}): AgentFeature[] {
  return [{ ...OPENAI_COMPAT_REASONING_FEATURE, value: input.reasoningEffort }];
}
