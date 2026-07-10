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

/**
 * Auto-compaction control: "off", or the context-window percentage at which
 * the daemon compacts the conversation automatically. Option ids mirror
 * COMPACTION_THRESHOLD_PERCENTS in the protocol's provider config.
 */
export const OPENAI_COMPAT_AUTO_COMPACT_VALUES = ["off", "50", "60", "70", "80", "90"] as const;

export type OpenAICompatAutoCompact = (typeof OPENAI_COMPAT_AUTO_COMPACT_VALUES)[number];

export const OPENAI_COMPAT_AUTO_COMPACT_FALLBACK: OpenAICompatAutoCompact = "80";

function buildAutoCompactFeature(
  defaultValue: OpenAICompatAutoCompact,
): Omit<AgentFeatureSelect, "value"> {
  return {
    type: "select",
    id: "auto_compact",
    label: "Auto-compact",
    description: "Compact the conversation automatically when context usage crosses the threshold",
    tooltip: "Change auto-compaction",
    icon: "summarize",
    options: [
      {
        id: "off",
        label: "Off",
        description: "Only compact manually via /compact",
        ...(defaultValue === "off" ? { isDefault: true } : {}),
      },
      ...(["50", "60", "70", "80", "90"] as const).map((percent) => {
        const option: AgentFeatureSelect["options"][number] = {
          id: percent,
          label: `At ${percent}%`,
        };
        if (defaultValue === percent) {
          option.isDefault = true;
        }
        return option;
      }),
    ],
  };
}

/**
 * Unknown persisted values normalize to the provider-configured default
 * rather than failing the session, mirroring reasoning-effort handling.
 */
export function normalizeOpenAICompatAutoCompact(
  value: unknown,
  defaultValue: OpenAICompatAutoCompact,
): OpenAICompatAutoCompact {
  return OPENAI_COMPAT_AUTO_COMPACT_VALUES.includes(value as OpenAICompatAutoCompact)
    ? (value as OpenAICompatAutoCompact)
    : defaultValue;
}

export function buildOpenAICompatFeatures(input: {
  reasoningEffort: OpenAICompatReasoningEffort;
  autoCompact: OpenAICompatAutoCompact;
  autoCompactDefault: OpenAICompatAutoCompact;
  /** Provider config hides the per-agent select; the default applies silently. */
  hideAutoCompact?: boolean;
}): AgentFeature[] {
  const features: AgentFeature[] = [
    { ...OPENAI_COMPAT_REASONING_FEATURE, value: input.reasoningEffort },
  ];
  if (!input.hideAutoCompact) {
    features.push({
      ...buildAutoCompactFeature(input.autoCompactDefault),
      value: input.autoCompact,
    });
  }
  return features;
}
