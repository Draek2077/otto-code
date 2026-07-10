import type { AgentSelectOption } from "./agent-sdk-types.js";

/**
 * Canonical effort scale, weakest to strongest. This is the vocabulary
 * tooling and prompts use to *request* an effort ("run this at high effort")
 * without knowing which option ids a given model actually supports; option
 * sets stay provider/model-specific (see the Effort entry in
 * docs/glossary.md). Requests resolve to the nearest option the model
 * advertises in `thinkingOptions`.
 */
export const EFFORT_LEVEL_SCALE = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type EffortLevel = (typeof EFFORT_LEVEL_SCALE)[number];

const EFFORT_LEVEL_SYNONYMS: Record<string, EffortLevel> = {
  off: "off",
  none: "off",
  disabled: "off",
  minimal: "minimal",
  min: "minimal",
  minimum: "minimal",
  low: "low",
  medium: "medium",
  mid: "medium",
  moderate: "medium",
  high: "high",
  xhigh: "xhigh",
  extrahigh: "xhigh",
  veryhigh: "xhigh",
  max: "max",
  maximum: "max",
};

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

/** Map a free-form requested value to a canonical level, or null. */
export function parseEffortLevel(value: string): EffortLevel | null {
  return EFFORT_LEVEL_SYNONYMS[normalizeToken(value)] ?? null;
}

function scalePosition(option: AgentSelectOption): number | null {
  const byId = parseEffortLevel(option.id);
  if (byId !== null) {
    return EFFORT_LEVEL_SCALE.indexOf(byId);
  }
  const byLabel = parseEffortLevel(option.label);
  return byLabel === null ? null : EFFORT_LEVEL_SCALE.indexOf(byLabel);
}

export class EffortResolutionError extends Error {
  constructor(
    public readonly requested: string,
    public readonly availableOptionIds: readonly string[],
  ) {
    super(
      `Unknown effort "${requested}". Pass one of the model's option ids ` +
        `(${availableOptionIds.join(", ") || "none advertised"}) or a canonical level ` +
        `(${EFFORT_LEVEL_SCALE.join(", ")}).`,
    );
    this.name = "EffortResolutionError";
  }
}

export interface ResolvedEffortOption {
  optionId: string;
  /**
   * "exact-id": the request named an advertised option id verbatim.
   * "level": a canonical level matched an option at the same scale position.
   * "nearest": the model doesn't offer the requested level; the closest
   * advertised option was chosen (ties round down, never spending more
   * effort than asked for).
   */
  matched: "exact-id" | "level" | "nearest";
}

/**
 * Resolve a requested effort — an exact option id or a canonical level —
 * against a model's advertised `thinkingOptions`. Exact ids always win, so
 * provider-special options (e.g. Claude's "ultracode") stay reachable even
 * though they have no place on the canonical scale.
 */
export function resolveEffortOption(input: {
  requested: string;
  thinkingOptions: readonly AgentSelectOption[];
}): ResolvedEffortOption {
  const requested = input.requested.trim();
  const availableIds = input.thinkingOptions.map((option) => option.id);

  const exact = input.thinkingOptions.find((option) => option.id === requested);
  if (exact) {
    return { optionId: exact.id, matched: "exact-id" };
  }
  const caseInsensitive = input.thinkingOptions.find(
    (option) => option.id.toLowerCase() === requested.toLowerCase(),
  );
  if (caseInsensitive) {
    return { optionId: caseInsensitive.id, matched: "exact-id" };
  }

  const requestedLevel = parseEffortLevel(requested);
  if (requestedLevel === null) {
    throw new EffortResolutionError(requested, availableIds);
  }
  const requestedPosition = EFFORT_LEVEL_SCALE.indexOf(requestedLevel);

  let best: { optionId: string; position: number } | null = null;
  for (const option of input.thinkingOptions) {
    const position = scalePosition(option);
    if (position === null) {
      continue;
    }
    if (
      best === null ||
      Math.abs(position - requestedPosition) < Math.abs(best.position - requestedPosition) ||
      (Math.abs(position - requestedPosition) === Math.abs(best.position - requestedPosition) &&
        position < best.position)
    ) {
      best = { optionId: option.id, position };
    }
  }
  if (best === null) {
    // None of the model's options map onto the canonical scale (fully custom
    // option ids) — only exact ids can address them.
    throw new EffortResolutionError(requested, availableIds);
  }
  return {
    optionId: best.optionId,
    matched: best.position === requestedPosition ? "level" : "nearest",
  };
}
