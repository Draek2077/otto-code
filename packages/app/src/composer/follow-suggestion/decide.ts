/**
 * "Follow prompt suggestions": when the agent has already predicted the next
 * prompt (the composer's ghost text), send it immediately instead of waiting
 * for the user to press Tab and Enter.
 *
 * This is NOT Auto mode and shares no code with it. Auto mode governs how an
 * agent decides to act inside a turn. This governs one thing only: whether an
 * ALREADY-GENERATED next-prompt suggestion is accepted by the user or by the
 * app. Nothing here reads or writes a permission mode, and nothing in the
 * permission-mode path reads this. Off means the suggestion sits in the ghost
 * text exactly as it does today.
 *
 * The decision is a pure function so the guards and the loop bound are testable
 * without a composer, a store, or a running agent.
 */

/**
 * How many suggestions Otto may follow back-to-back before it stops and waits
 * for the user.
 *
 * Each followed suggestion produces another suggestion, so without a bound a
 * chat would prompt itself forever on someone else's tokens. Three is enough to
 * carry a short follow-through (run the tests, fix the failure, commit) and
 * short enough that an unattended chat cannot run away. The count is per chat
 * and resets the moment the user sends a message of their own, so a person who
 * stays in the conversation is never rate-limited by it.
 */
export const FOLLOW_PROMPT_SUGGESTION_MAX_CONSECUTIVE = 3;

export type FollowPromptSuggestionSkipReason =
  /** The setting is off. The only reason that means "this feature is inert". */
  | "off"
  /** No suggestion is produced at all, so there is nothing to follow. */
  | "suggestions-off"
  | "no-suggestion"
  /** The user pressed Stop on the band for this chat. */
  | "stopped"
  /** Never send over something the user typed, and never destroy it either. */
  | "draft-present"
  /** Attachments are a deliberate act; following would silently send them. */
  | "attachments-present"
  /** Queued messages are the user's own next turns and must go first. */
  | "queue-present"
  /** A turn is still running, so the suggestion is not the next thing to say. */
  | "agent-busy"
  /** No transport, or a parent that owns submission and has not armed it. */
  | "cannot-submit"
  /** The loop bound. */
  | "limit-reached";

export type FollowPromptSuggestionDecision =
  | { action: "send"; prompt: string; sentCount: number }
  | { action: "skip"; reason: FollowPromptSuggestionSkipReason };

export interface FollowPromptSuggestionInput {
  /** The `followPromptSuggestions` app setting. */
  isFollowEnabled: boolean;
  /** The `promptSuggestionsEnabled` app setting, which produces the ghost text. */
  arePromptSuggestionsEnabled: boolean;
  suggestion: string | null | undefined;
  /** Whatever is in the message box right now. */
  draftText: string;
  attachmentCount: number;
  queuedCount: number;
  isAgentRunning: boolean;
  canSubmit: boolean;
  /** The user stopped the chain for this chat, without changing the setting. */
  isStopped: boolean;
  /** How many suggestions this chat has already followed in a row. */
  sentCount: number;
  maxConsecutive?: number;
}

export function decideFollowPromptSuggestion(
  input: FollowPromptSuggestionInput,
): FollowPromptSuggestionDecision {
  if (!input.isFollowEnabled) return { action: "skip", reason: "off" };
  if (!input.arePromptSuggestionsEnabled) return { action: "skip", reason: "suggestions-off" };

  const prompt = input.suggestion?.trim() ?? "";
  if (prompt.length === 0) return { action: "skip", reason: "no-suggestion" };

  if (input.isStopped) return { action: "skip", reason: "stopped" };
  if (input.draftText.trim().length > 0) return { action: "skip", reason: "draft-present" };
  if (input.attachmentCount > 0) return { action: "skip", reason: "attachments-present" };
  if (input.queuedCount > 0) return { action: "skip", reason: "queue-present" };
  if (input.isAgentRunning) return { action: "skip", reason: "agent-busy" };
  if (!input.canSubmit) return { action: "skip", reason: "cannot-submit" };

  const max = input.maxConsecutive ?? FOLLOW_PROMPT_SUGGESTION_MAX_CONSECUTIVE;
  if (input.sentCount >= max) return { action: "skip", reason: "limit-reached" };

  return { action: "send", prompt, sentCount: input.sentCount + 1 };
}

/**
 * The band above the composer reports the chain, so it needs to tell "we are
 * following" from "we followed as far as we may". Derived from the same numbers
 * the decision uses, never from a second copy of the rule.
 */
export type FollowPromptSuggestionChainPhase = "idle" | "following" | "limit-reached";

export function resolveFollowChainPhase(input: {
  isFollowEnabled: boolean;
  isStopped: boolean;
  sentCount: number;
  maxConsecutive?: number;
}): FollowPromptSuggestionChainPhase {
  if (!input.isFollowEnabled || input.isStopped || input.sentCount <= 0) return "idle";
  const max = input.maxConsecutive ?? FOLLOW_PROMPT_SUGGESTION_MAX_CONSECUTIVE;
  return input.sentCount >= max ? "limit-reached" : "following";
}
