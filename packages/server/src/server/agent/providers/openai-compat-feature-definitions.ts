import type { AgentFeature, AgentFeatureSelect, AgentSelectOption } from "../agent-sdk-types.js";

export const OPENAI_COMPAT_REASONING_EFFORTS = ["off", "low", "medium", "high"] as const;

export type OpenAICompatReasoningEffort = (typeof OPENAI_COMPAT_REASONING_EFFORTS)[number];

/**
 * Effort advertised per model as `thinkingOptions`, like every other
 * provider, so the standard Effort control (composer, schedule form,
 * artifact form) drives it. The selection maps onto the request's
 * `reasoning_effort` parameter. Custom provider profiles that declare their
 * own per-model `thinkingOptions` override these defaults in the registry
 * merge.
 */
export const OPENAI_COMPAT_THINKING_OPTIONS: readonly AgentSelectOption[] = [
  { id: "off", label: "Off", description: "Don't request reasoning", isDefault: true },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

export const OPENAI_COMPAT_DEFAULT_THINKING_OPTION_ID: OpenAICompatReasoningEffort = "off";

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
  autoCompact: OpenAICompatAutoCompact;
  autoCompactDefault: OpenAICompatAutoCompact;
  /** Provider config hides the per-agent select; the default applies silently. */
  hideAutoCompact?: boolean;
}): AgentFeature[] {
  const features: AgentFeature[] = [];
  if (!input.hideAutoCompact) {
    features.push({
      ...buildAutoCompactFeature(input.autoCompactDefault),
      value: input.autoCompact,
    });
  }
  return features;
}
