// Shared naming rule for provider-managed (observed) subagents. This is the
// single source of truth for how an observed subagent is titled — the daemon
// uses it to freeze the track-row label (agent-projections.ts), and the app's
// visualizer uses it so page-side child labels (subagent_dispatch/return
// particles ride an edge keyed by child NAME) resolve to exactly the same
// string as the child node the daemon-titled agent row spawned. If the two
// ever diverge, the dispatch/return visuals silently stop rendering.
// See docs/agent-lifecycle.md (Item 4) and docs/visualizer.md.

/** Hard cap so no provider summary can produce a wall-of-text label. */
export const OBSERVED_SUBAGENT_TITLE_MAX = 60;

/**
 * Catch-all subagent types that make lousy row labels — Claude's default Task
 * runs as "general-purpose". These never become the title; the task
 * description names the row instead (user-locked).
 */
const GENERIC_OBSERVED_SUBAGENT_TYPES = new Set([
  "general-purpose",
  "general",
  "task",
  "agent",
  "subagent",
]);

export function normalizeObservedTitleSource(value: string | undefined | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > 0 ? collapsed : null;
}

export function normalizeObservedSubagentType(value: string | undefined | null): string | null {
  const normalized = normalizeObservedTitleSource(value);
  if (normalized === null || GENERIC_OBSERVED_SUBAGENT_TYPES.has(normalized.toLowerCase())) {
    return null;
  }
  return normalized;
}

/**
 * Derive the frozen row name for an observed subagent. Prefer the stable
 * `subAgentType` (e.g. "code-explorer") over the description — a
 * `task_progress` description is the ever-changing AI summary, which must
 * never become the label. Generic catch-all types ("general-purpose") are
 * skipped in favor of the description. Callers freeze the result at the first
 * named update.
 */
export function deriveObservedSubagentTitle(update: {
  subAgentType?: string;
  description?: string;
}): string {
  const base =
    normalizeObservedSubagentType(update.subAgentType) ??
    normalizeObservedTitleSource(update.description) ??
    "Subagent";
  if (base.length <= OBSERVED_SUBAGENT_TITLE_MAX) {
    return base;
  }
  return `${base.slice(0, OBSERVED_SUBAGENT_TITLE_MAX - 1).trimEnd()}…`;
}

/**
 * True when this update carries a real name source we can freeze the title on.
 * A generic catch-all type alone doesn't count — freezing "general-purpose"
 * would lock out the description a later update may carry.
 */
export function observedUpdateHasTitleSource(update: {
  subAgentType?: string;
  description?: string;
}): boolean {
  return (
    normalizeObservedSubagentType(update.subAgentType) !== null ||
    normalizeObservedTitleSource(update.description) !== null
  );
}
