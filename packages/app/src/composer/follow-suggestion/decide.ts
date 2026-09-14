import type { FollowPromptSuggestionsLimit } from "@/hooks/use-settings/storage";

/**
 * "Follow prompt suggestions", surfaced per chat as Autonomous mode: when the
 * agent has already predicted the next prompt (the composer's ghost text), send
 * it immediately instead of waiting for the user to press Tab and Enter.
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
 * How many suggestions a chat may follow back-to-back before it stops and waits
 * for the user, unless the user picks another bound in Settings.
 *
 * Each followed suggestion produces another suggestion, so the bound is what
 * stops an unattended chat prompting itself on someone else's tokens. The user
 * may raise it or remove it ("unlimited"); the default stays conservative. The
 * count is per chat and resets the moment the user sends a message of their
 * own, so a person who stays in the conversation is never rate-limited by it.
 */
export const DEFAULT_FOLLOW_PROMPT_SUGGESTION_MAX_CONSECUTIVE = 3;

/** `null` means unlimited: follow until the agent stops suggesting. */
export function resolveFollowPromptSuggestionsLimit(
  limit: FollowPromptSuggestionsLimit,
): number | null {
  return limit === "unlimited" ? null : Number(limit);
}

export type FollowPromptSuggestionSkipReason =
  /** Autonomous mode is off for this chat. The only reason that means "inert". */
  | "off"
  /** No suggestion is produced at all, so there is nothing to follow. */
  | "suggestions-off"
  | "no-suggestion"
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
  /** This chat's Autonomous mode toggle. */
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
  /** How many suggestions this chat has already followed in a row. */
  sentCount: number;
  /** The bound from Settings; `null` is unlimited. */
  maxConsecutive: number | null;
}

export function decideFollowPromptSuggestion(
  input: FollowPromptSuggestionInput,
): FollowPromptSuggestionDecision {
  if (!input.isFollowEnabled) return { action: "skip", reason: "off" };
  if (!input.arePromptSuggestionsEnabled) return { action: "skip", reason: "suggestions-off" };

  const prompt = input.suggestion?.trim() ?? "";
  if (prompt.length === 0) return { action: "skip", reason: "no-suggestion" };

  if (input.draftText.trim().length > 0) return { action: "skip", reason: "draft-present" };
  if (input.attachmentCount > 0) return { action: "skip", reason: "attachments-present" };
  if (input.queuedCount > 0) return { action: "skip", reason: "queue-present" };
  if (input.isAgentRunning) return { action: "skip", reason: "agent-busy" };
  if (!input.canSubmit) return { action: "skip", reason: "cannot-submit" };

  if (input.maxConsecutive !== null && input.sentCount >= input.maxConsecutive) {
    return { action: "skip", reason: "limit-reached" };
  }

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
  sentCount: number;
  maxConsecutive: number | null;
}): FollowPromptSuggestionChainPhase {
  if (!input.isFollowEnabled || input.sentCount <= 0) return "idle";
  if (input.maxConsecutive !== null && input.sentCount >= input.maxConsecutive) {
    return "limit-reached";
  }
  return "following";
}
