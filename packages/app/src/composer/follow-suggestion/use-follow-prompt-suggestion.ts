import { useEffect, useRef } from "react";
import {
  decideFollowPromptSuggestion,
  type FollowPromptSuggestionDecision,
} from "@/composer/follow-suggestion/decide";
import {
  selectFollowSuggestionChain,
  useFollowSuggestionChainStore,
} from "@/composer/follow-suggestion/chain-store";
import { useFollowPromptSuggestionsSetting } from "@/composer/follow-suggestion/setting";

export interface UseFollowPromptSuggestionInput {
  serverId: string;
  agentId: string;
  /** The ghost-text suggestion currently held for this chat, if any. */
  suggestion: string | null | undefined;
  arePromptSuggestionsEnabled: boolean;
  draftText: string;
  attachmentCount: number;
  queuedCount: number;
  isAgentRunning: boolean;
  canSubmit: boolean;
  /** Hands the prompt to the composer's normal send path. */
  onFollow: (prompt: string) => void;
}

/**
 * Drives "Follow prompt suggestions" for one chat: when the guards allow it,
 * the suggestion the agent already produced is sent without the user pressing
 * Tab and Enter.
 *
 * The effect intentionally depends on the guard values, not just the suggestion
 * text. A suggestion arrives at the tail of a turn, so `isAgentRunning` may
 * still be true for a beat; re-evaluating when it clears is what makes the send
 * land. `handledRef` is what keeps that from firing twice for one suggestion.
 */
export function useFollowPromptSuggestion(input: UseFollowPromptSuggestionInput): void {
  const isFollowEnabled = useFollowPromptSuggestionsSetting();
  const chain = useFollowSuggestionChainStore((state) =>
    selectFollowSuggestionChain(state, input.serverId, input.agentId),
  );
  const recordFollowedSuggestion = useFollowSuggestionChainStore(
    (state) => state.recordFollowedSuggestion,
  );
  const resetChain = useFollowSuggestionChainStore((state) => state.resetChain);

  const onFollowRef = useRef(input.onFollow);
  onFollowRef.current = input.onFollow;
  // The exact suggestion text already handed to the send path. The store clears
  // the suggestion on submit, but the clear and this effect are not one tick.
  const handledRef = useRef<string | null>(null);

  const {
    serverId,
    agentId,
    suggestion,
    arePromptSuggestionsEnabled,
    draftText,
    attachmentCount,
    queuedCount,
    isAgentRunning,
    canSubmit,
  } = input;

  // Off is off: drop any chain state so turning the setting back on later starts
  // from zero rather than resuming someone's half-spent budget.
  useEffect(() => {
    if (isFollowEnabled) return;
    handledRef.current = null;
    resetChain(serverId, agentId);
  }, [agentId, isFollowEnabled, resetChain, serverId]);

  useEffect(() => {
    const decision: FollowPromptSuggestionDecision = decideFollowPromptSuggestion({
      isFollowEnabled,
      arePromptSuggestionsEnabled,
      suggestion,
      draftText,
      attachmentCount,
      queuedCount,
      isAgentRunning,
      canSubmit,
      isStopped: chain.isStopped,
      sentCount: chain.sentCount,
    });

    if (decision.action !== "send") {
      // A suggestion that went away releases the guard, so the next one is
      // eligible even when its text happens to repeat.
      if (decision.reason === "no-suggestion") {
        handledRef.current = null;
      }
      return;
    }

    if (handledRef.current === decision.prompt) return;
    handledRef.current = decision.prompt;
    recordFollowedSuggestion(serverId, agentId, decision.sentCount);
    onFollowRef.current(decision.prompt);
  }, [
    agentId,
    arePromptSuggestionsEnabled,
    attachmentCount,
    canSubmit,
    chain.isStopped,
    chain.sentCount,
    draftText,
    isAgentRunning,
    isFollowEnabled,
    queuedCount,
    recordFollowedSuggestion,
    serverId,
    suggestion,
  ]);
}
