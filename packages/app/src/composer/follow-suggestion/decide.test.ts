import { describe, expect, it } from "vitest";
import {
  decideFollowPromptSuggestion,
  resolveFollowChainPhase,
  FOLLOW_PROMPT_SUGGESTION_MAX_CONSECUTIVE,
  type FollowPromptSuggestionInput,
} from "./decide";

function input(overrides: Partial<FollowPromptSuggestionInput> = {}): FollowPromptSuggestionInput {
  return {
    isFollowEnabled: true,
    arePromptSuggestionsEnabled: true,
    suggestion: "Run the failing test again",
    draftText: "",
    attachmentCount: 0,
    queuedCount: 0,
    isAgentRunning: false,
    canSubmit: true,
    isStopped: false,
    sentCount: 0,
    ...overrides,
  };
}

describe("decideFollowPromptSuggestion", () => {
  it("sends the trimmed suggestion when every guard is clear", () => {
    expect(decideFollowPromptSuggestion(input({ suggestion: "  Ship it  " }))).toEqual({
      action: "send",
      prompt: "Ship it",
      sentCount: 1,
    });
  });

  it("is inert when the setting is off, whatever else is true", () => {
    expect(decideFollowPromptSuggestion(input({ isFollowEnabled: false }))).toEqual({
      action: "skip",
      reason: "off",
    });
  });

  it("does nothing when prompt suggestions themselves are off", () => {
    expect(decideFollowPromptSuggestion(input({ arePromptSuggestionsEnabled: false }))).toEqual({
      action: "skip",
      reason: "suggestions-off",
    });
  });

  it.each([
    ["no suggestion at all", { suggestion: null }, "no-suggestion"],
    ["a whitespace-only suggestion", { suggestion: "   \n" }, "no-suggestion"],
    ["the user pressed Stop", { isStopped: true }, "stopped"],
    ["the user has typed something", { draftText: "wait, actually" }, "draft-present"],
    ["the user attached a file", { attachmentCount: 1 }, "attachments-present"],
    ["the user has queued messages", { queuedCount: 2 }, "queue-present"],
    ["a turn is still running", { isAgentRunning: true }, "agent-busy"],
    ["there is no way to submit", { canSubmit: false }, "cannot-submit"],
  ])("skips on %s", (_label, overrides, reason) => {
    expect(decideFollowPromptSuggestion(input(overrides))).toEqual({ action: "skip", reason });
  });

  it("never sends over typed text, even when only whitespace separates it", () => {
    // The composer's draft is the user's. Following would both discard their
    // words and send something they did not write.
    expect(decideFollowPromptSuggestion(input({ draftText: "  hold on  " }))).toEqual({
      action: "skip",
      reason: "draft-present",
    });
  });
});

describe("the loop bound", () => {
  it("stops after the configured number of consecutive follows", () => {
    // Walk a chat that keeps producing a suggestion after every followed one.
    let sentCount = 0;
    const sent: string[] = [];
    for (let turn = 0; turn < 20; turn += 1) {
      const decision = decideFollowPromptSuggestion(
        input({ suggestion: `next step ${turn}`, sentCount }),
      );
      if (decision.action !== "send") {
        expect(decision.reason).toBe("limit-reached");
        break;
      }
      sent.push(decision.prompt);
      sentCount = decision.sentCount;
    }
    expect(sent).toHaveLength(FOLLOW_PROMPT_SUGGESTION_MAX_CONSECUTIVE);
    expect(sentCount).toBe(FOLLOW_PROMPT_SUGGESTION_MAX_CONSECUTIVE);
  });

  it("refuses once the count has reached the bound", () => {
    expect(
      decideFollowPromptSuggestion(input({ sentCount: FOLLOW_PROMPT_SUGGESTION_MAX_CONSECUTIVE })),
    ).toEqual({ action: "skip", reason: "limit-reached" });
  });

  it("honors a caller-supplied bound", () => {
    expect(decideFollowPromptSuggestion(input({ sentCount: 1, maxConsecutive: 1 }))).toEqual({
      action: "skip",
      reason: "limit-reached",
    });
    expect(decideFollowPromptSuggestion(input({ sentCount: 0, maxConsecutive: 1 })).action).toBe(
      "send",
    );
  });

  it("re-arms once the user's own message resets the count", () => {
    const exhausted = input({ sentCount: FOLLOW_PROMPT_SUGGESTION_MAX_CONSECUTIVE });
    expect(decideFollowPromptSuggestion(exhausted).action).toBe("skip");
    // A user send resets the chain to zero (chain-store.resetChain).
    expect(decideFollowPromptSuggestion({ ...exhausted, sentCount: 0 }).action).toBe("send");
  });
});

describe("resolveFollowChainPhase", () => {
  it("is idle before anything has been followed", () => {
    expect(resolveFollowChainPhase({ isFollowEnabled: true, isStopped: false, sentCount: 0 })).toBe(
      "idle",
    );
  });

  it("reports following mid-chain and limit-reached at the bound", () => {
    expect(resolveFollowChainPhase({ isFollowEnabled: true, isStopped: false, sentCount: 1 })).toBe(
      "following",
    );
    expect(
      resolveFollowChainPhase({
        isFollowEnabled: true,
        isStopped: false,
        sentCount: FOLLOW_PROMPT_SUGGESTION_MAX_CONSECUTIVE,
      }),
    ).toBe("limit-reached");
  });

  it("shows nothing once the setting is off or the user stopped the chain", () => {
    expect(
      resolveFollowChainPhase({ isFollowEnabled: false, isStopped: false, sentCount: 2 }),
    ).toBe("idle");
    expect(resolveFollowChainPhase({ isFollowEnabled: true, isStopped: true, sentCount: 2 })).toBe(
      "idle",
    );
  });
});
