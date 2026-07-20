import type { AgentTimelineItem, ContextComposition } from "./agent-sdk-types.js";

// ~4 chars per token, the same coarse heuristic the rest of the visualizer path
// uses (estimateToolCallTokenCost, turn-time.ts). Otto's protocol carries no
// per-category token usage — providers report only totals at request
// boundaries — so the daemon estimates the composition from the content it
// already tracks in the agent timeline. The consumer scales the result to the
// authoritative context-window occupancy, so only the *proportions* matter.
const CHARS_PER_TOKEN = 4;

/**
 * Shared by the context-management scanner so both paths report the same
 * coarse heuristic — a divergence here would make the two surfaces disagree
 * about the same file.
 */
export function estimateTokens(chars: number): number {
  return Math.round(chars / CHARS_PER_TOKEN);
}

function detailChars(item: Extract<AgentTimelineItem, { type: "tool_call" }>): number {
  try {
    return JSON.stringify(item.detail)?.length ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Estimate how the tokens currently in an agent's context window break down by
 * origin, from the daemon's own per-agent timeline — real daemon-side accounting
 * (the daemon categorizes the content it actually tracked), not a client guess.
 * Provider-neutral by construction: every provider populates the timeline, so
 * richness grades with timeline richness (Claude, with reasoning blocks and
 * observed sub-agents, produces the fullest split; a sparse timeline yields a
 * coarser one; an empty timeline yields `undefined` → the consumer falls back to
 * occupancy-only, the pre-composition behavior).
 *
 * Mapping to the five {@link ContextComposition} categories:
 * - `user_message` + `assistant_message` → `userMessages` (the conversation
 *   prose; the category model has no separate assistant bucket, so both dialogue
 *   sides fold here).
 * - `reasoning` → `reasoning`.
 * - `tool_call` → `toolResults`, except a `sub_agent` call → `subagentResults`.
 * - `systemPrompt` is left unset: Otto does not track the provider's system
 *   prompt in the timeline. A provider that later surfaces it can populate the
 *   field directly on its usage (this estimator only fills what it can see).
 * - `todo` / `error` / `compaction` are skipped (small and not cleanly
 *   attributable).
 *
 * Returns `undefined` when nothing was attributable, so callers can omit the
 * field entirely rather than emit an all-zero object.
 */
export function estimateContextComposition(
  items: readonly AgentTimelineItem[],
): ContextComposition | undefined {
  let userMessages = 0;
  let toolResults = 0;
  let reasoning = 0;
  let subagentResults = 0;

  for (const item of items) {
    switch (item.type) {
      case "user_message":
      case "assistant_message":
        userMessages += item.text.length;
        break;
      case "reasoning":
        reasoning += item.text.length;
        break;
      case "tool_call":
        if (item.detail.type === "sub_agent") {
          subagentResults += detailChars(item);
        } else {
          toolResults += detailChars(item);
        }
        break;
      default:
        // todo / error / compaction — skipped.
        break;
    }
  }

  const composition: ContextComposition = {};
  if (userMessages > 0) composition.userMessages = estimateTokens(userMessages);
  if (toolResults > 0) composition.toolResults = estimateTokens(toolResults);
  if (reasoning > 0) composition.reasoning = estimateTokens(reasoning);
  if (subagentResults > 0) composition.subagentResults = estimateTokens(subagentResults);

  return Object.keys(composition).length > 0 ? composition : undefined;
}
