import type { AgentModelDefinition, AgentSelectOption } from "../../agent-sdk-types.js";

type ClaudeEffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Which auth paths support the Auto permission mode (model-classifier
 * approvals) for a model, per the Claude Code support matrix:
 * - "all" — supported on the Anthropic API, Bedrock/Vertex, and claude.ai
 *   sign-in (Sonnet 5, Opus 4.7+).
 * - "anthropic-api" — Anthropic API only (Opus 4.6 / Sonnet 4.6); not
 *   available via Bedrock/Vertex or claude.ai subscription sign-in.
 * - "none" — the classifier cannot run on this model anywhere (Haiku,
 *   Sonnet <=4.5, Opus <=4.5, claude-3). The CLI errors if Auto is set.
 */
export type ClaudeAutoModeSupport = "all" | "anthropic-api" | "none";

interface ClaudeModelManifestEntry {
  id: string;
  label: string;
  description: string;
  isDefault?: boolean;
  contextWindowMaxTokens?: number;
  effortLevels?: readonly ClaudeEffortLevel[];
  supportsFastMode?: boolean;
  autoModeSupport?: ClaudeAutoModeSupport;
}

const CLAUDE_EFFORT_LEVELS = {
  standard: ["low", "medium", "high", "max"],
  xhigh: ["low", "medium", "high", "xhigh", "max"],
} as const satisfies Record<string, readonly ClaudeEffortLevel[]>;

const CLAUDE_EFFORT_LABELS = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
} as const satisfies Record<ClaudeEffortLevel, string>;

export const CLAUDE_ULTRACODE_THINKING_OPTION_ID = "ultracode";

/**
 * The Claude models Otto offers, mirroring the Claude Code CLI's own catalog.
 * Every field here is checked against that catalog (`context`, `capabilities`,
 * `max_output_tokens`) rather than guessed from the model name:
 *
 * - A `[1m]` entry exists ONLY for models the CLI reports as `window:200000`
 *   AND `supports_1m_beta`. Opus 4.7 / 4.8 / 5, Sonnet 5 and Fable 5 are
 *   `native_1m` — the plain id already resolves to a 1M window, so a second
 *   "1M" row would be a duplicate of the same model. Opus 4.5 is 200K with no
 *   `supports_1m_beta`, so it gets no 1M row either. Ignore `supports_1m_suffix`
 *   as a signal: nearly every model carries it, including Haiku 3.5.
 * - `effortLevels` requires `effort` in the model's capabilities, and the
 *   `xhigh` ladder additionally requires `xhigh_effort`. Opus 4.6 and Sonnet 4.6
 *   carry `effort`/`max_effort` only; Opus 4.5, Sonnet 4.5 and Haiku 4.5 carry
 *   neither, so they expose no thinking options at all.
 * - `supportsFastMode` is Opus 4.8 and Opus 5 only. Opus 4.7's fast mode was
 *   withdrawn (`speed: "fast"` now errors) and Opus 4.6 never had it.
 *
 * Deliberately NOT listed: retired ids (Sonnet 3.7, Haiku 3.5, Sonnet 3.5,
 * Opus 3, Haiku 3); Opus 4.1, Opus 4 and Sonnet 4, which Anthropic has
 * deprecated with retirement pending; and Mythos 5, which is invitation-only
 * via Project Glasswing.
 */
export const CLAUDE_MODEL_MANIFEST = [
  {
    id: "claude-fable-5",
    label: "Fable 5",
    description: "Fable 5 · Most powerful model",
    contextWindowMaxTokens: 1_000_000,
    effortLevels: CLAUDE_EFFORT_LEVELS.xhigh,
    autoModeSupport: "all",
  },
  {
    id: "claude-opus-5",
    label: "Opus 5",
    description: "Opus 5 · Latest release",
    isDefault: true,
    contextWindowMaxTokens: 1_000_000,
    effortLevels: CLAUDE_EFFORT_LEVELS.xhigh,
    supportsFastMode: true,
    autoModeSupport: "all",
  },
  {
    id: "claude-opus-4-8",
    label: "Opus 4.8",
    description: "Opus 4.8 · Previous release",
    contextWindowMaxTokens: 1_000_000,
    effortLevels: CLAUDE_EFFORT_LEVELS.xhigh,
    supportsFastMode: true,
    autoModeSupport: "all",
  },
  {
    id: "claude-sonnet-5",
    label: "Sonnet 5",
    description: "Sonnet 5 · Best for everyday tasks",
    contextWindowMaxTokens: 1_000_000,
    effortLevels: CLAUDE_EFFORT_LEVELS.xhigh,
    autoModeSupport: "all",
  },
  {
    id: "claude-opus-4-7",
    label: "Opus 4.7",
    description: "Opus 4.7 · Earlier release",
    contextWindowMaxTokens: 1_000_000,
    effortLevels: CLAUDE_EFFORT_LEVELS.xhigh,
    autoModeSupport: "all",
  },
  {
    id: "claude-opus-4-6[1m]",
    label: "Opus 4.6 1M",
    description: "Opus 4.6 with 1M context window",
    contextWindowMaxTokens: 1_000_000,
    effortLevels: CLAUDE_EFFORT_LEVELS.standard,
    autoModeSupport: "anthropic-api",
  },
  {
    id: "claude-opus-4-6",
    label: "Opus 4.6",
    description: "Opus 4.6 · Legacy release",
    contextWindowMaxTokens: 200_000,
    effortLevels: CLAUDE_EFFORT_LEVELS.standard,
    autoModeSupport: "anthropic-api",
  },
  {
    id: "claude-sonnet-4-6[1m]",
    label: "Sonnet 4.6 1M",
    description: "Sonnet 4.6 with 1M context window",
    contextWindowMaxTokens: 1_000_000,
    effortLevels: CLAUDE_EFFORT_LEVELS.standard,
    autoModeSupport: "anthropic-api",
  },
  {
    id: "claude-sonnet-4-6",
    label: "Sonnet 4.6",
    description: "Sonnet 4.6 · Best for everyday tasks",
    contextWindowMaxTokens: 200_000,
    effortLevels: CLAUDE_EFFORT_LEVELS.standard,
    autoModeSupport: "anthropic-api",
  },
  {
    id: "claude-opus-4-5",
    label: "Opus 4.5",
    description: "Opus 4.5 · Legacy release",
    contextWindowMaxTokens: 200_000,
    autoModeSupport: "none",
  },
  {
    id: "claude-sonnet-4-5[1m]",
    label: "Sonnet 4.5 1M",
    description: "Sonnet 4.5 with 1M context window",
    contextWindowMaxTokens: 1_000_000,
    autoModeSupport: "none",
  },
  {
    id: "claude-sonnet-4-5",
    label: "Sonnet 4.5",
    description: "Sonnet 4.5 · Legacy release",
    contextWindowMaxTokens: 200_000,
    autoModeSupport: "none",
  },
  {
    id: "claude-haiku-4-5",
    label: "Haiku 4.5",
    description: "Haiku 4.5 · Fastest for quick answers",
    contextWindowMaxTokens: 200_000,
    autoModeSupport: "none",
  },
] as const satisfies readonly ClaudeModelManifestEntry[];

function buildThinkingOptions(
  effortLevels: readonly ClaudeEffortLevel[] | undefined,
): AgentSelectOption[] | undefined {
  if (!effortLevels) {
    return undefined;
  }

  const options: AgentSelectOption[] = effortLevels.map((id) => ({
    id,
    label: CLAUDE_EFFORT_LABELS[id],
  }));

  if (effortLevels.includes("xhigh")) {
    options.push({ id: CLAUDE_ULTRACODE_THINKING_OPTION_ID, label: "Ultra Code" });
  }

  return options;
}

export function getClaudeManifestModels(): AgentModelDefinition[] {
  return CLAUDE_MODEL_MANIFEST.map((model) => {
    const thinkingOptions = buildThinkingOptions(
      "effortLevels" in model ? model.effortLevels : undefined,
    );
    return {
      provider: "claude",
      id: model.id,
      label: model.label,
      description: model.description,
      ...("isDefault" in model && model.isDefault ? { isDefault: true } : {}),
      ...(model.contextWindowMaxTokens !== undefined
        ? { contextWindowMaxTokens: model.contextWindowMaxTokens }
        : {}),
      ...(thinkingOptions ? { thinkingOptions } : {}),
      // Only the model-intrinsic "never" tier is stamped on the wire: it is
      // deterministic (no env/auth dependence), so clients can hide Auto for
      // it up front. Auth-path-dependent tiers stay a session-level check.
      ...(model.autoModeSupport === "none" ? { supportsAutoMode: false } : {}),
    };
  });
}

export function isClaudeManifestModelId(modelId: string): boolean {
  return CLAUDE_MODEL_MANIFEST.some((model) => model.id === modelId);
}

/**
 * Auto-mode support tier for a model, or undefined when the model is not in
 * the manifest (custom settings.json ids, future models). Callers should fail
 * open on undefined: wrongly hiding Auto loses a feature, wrongly showing it
 * just reproduces the CLI's own "unavailable for this model" error.
 */
export function claudeManifestModelAutoModeSupport(
  modelId: string | null | undefined,
): ClaudeAutoModeSupport | undefined {
  const normalizedModelId = normalizeClaudeManifestModelId(modelId);
  if (!normalizedModelId) {
    return undefined;
  }
  const entry = CLAUDE_MODEL_MANIFEST.find((model) => model.id === normalizedModelId);
  if (!entry || !("autoModeSupport" in entry)) {
    return undefined;
  }
  return entry.autoModeSupport;
}

export function claudeManifestModelSupportsFastMode(modelId: string | null | undefined): boolean {
  const normalizedModelId = normalizeClaudeManifestModelId(modelId);
  if (!normalizedModelId) {
    return false;
  }
  return CLAUDE_MODEL_MANIFEST.some(
    (model) =>
      model.id === normalizedModelId &&
      "supportsFastMode" in model &&
      model.supportsFastMode === true,
  );
}

/**
 * Normalize first-party Claude model IDs for manifest capability checks. Provider-prefixed
 * runtime IDs intentionally use normalizeClaudeRuntimeModelId instead.
 */
export function normalizeClaudeManifestModelId(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return null;
  }

  if (isClaudeManifestModelId(trimmed)) {
    return trimmed;
  }

  const singleSegmentMatch = trimmed.match(
    /^(?:claude[-_ ])?(fable|opus|sonnet|haiku)[-_ ]+(\d+)(\[1m\])?(?:[-_ ]+\d{8})?$/i,
  );
  if (singleSegmentMatch) {
    return normalizeSingleSegmentClaudeModelId(
      singleSegmentMatch[1],
      singleSegmentMatch[2],
      trimmed.toLowerCase().includes("[1m]"),
    );
  }

  const runtimeMatch = trimmed.match(
    /^(?:claude[-_ ])?(opus|sonnet|haiku)[-_ ]+(\d+)[-.](\d+)(\[1m\])?(?:[-_ ]+\d{8})?$/i,
  );
  if (!runtimeMatch) {
    return null;
  }

  return normalizeMajorMinorClaudeModelId(
    runtimeMatch[1],
    runtimeMatch[2],
    runtimeMatch[3],
    Boolean(runtimeMatch[4]),
  );
}

/**
 * Normalize a Claude Code runtime/config model string to a known manifest ID.
 * Runtime metadata may include provider prefixes such as Bedrock model IDs; feature
 * gates should use normalizeClaudeManifestModelId instead.
 */
export function normalizeClaudeRuntimeModelId(value: string | null | undefined): string | null {
  const normalizedManifestModelId = normalizeClaudeManifestModelId(value);
  if (normalizedManifestModelId) {
    return normalizedManifestModelId;
  }

  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return null;
  }

  const singleSegmentMatch = trimmed.match(
    /claude[-_ ](fable|opus|sonnet|haiku)[-_ ]+(\d+)(\[1m\])?/i,
  );
  if (singleSegmentMatch) {
    const normalizedModelId = normalizeSingleSegmentClaudeModelId(
      singleSegmentMatch[1],
      singleSegmentMatch[2],
      Boolean(singleSegmentMatch[3]),
    );
    if (normalizedModelId) {
      return normalizedModelId;
    }
  }

  const runtimeMatch = trimmed.match(
    /claude[-_ ](opus|sonnet|haiku)[-_ ]+(\d+)[-.](\d+)(\[1m\])?/i,
  );
  if (!runtimeMatch) {
    return null;
  }

  return normalizeMajorMinorClaudeModelId(
    runtimeMatch[1],
    runtimeMatch[2],
    runtimeMatch[3],
    Boolean(runtimeMatch[4]),
  );
}

function normalizeSingleSegmentClaudeModelId(
  familyValue: string,
  major: string,
  hasOneMillionContext: boolean,
): string | null {
  const family = familyValue.toLowerCase();
  const suffix = hasOneMillionContext ? "[1m]" : "";
  const candidates = [`claude-${family}-${major}${suffix}`, `claude-${family}-${major}`];
  for (const candidate of candidates) {
    if (isClaudeManifestModelId(candidate)) {
      return candidate;
    }
  }
  return null;
}

function normalizeMajorMinorClaudeModelId(
  familyValue: string,
  major: string,
  minor: string,
  hasOneMillionContext: boolean,
): string | null {
  const family = familyValue.toLowerCase();
  const suffix = hasOneMillionContext ? "[1m]" : "";
  // Fall back to the undecorated id when the manifest has no `[1m]` row, the
  // same way normalizeSingleSegmentClaudeModelId does. Natively-1M models (Opus
  // 4.7/4.8/5) ship one entry, but the CLI still accepts the decorated id and a
  // persisted agent, personality, or team binding may carry it — without this
  // fallback those resolve to null and silently lose their feature gates.
  const candidates = [
    `claude-${family}-${major}-${minor}${suffix}`,
    `claude-${family}-${major}-${minor}`,
  ];
  for (const candidate of candidates) {
    if (isClaudeManifestModelId(candidate)) {
      return candidate;
    }
  }
  return null;
}
