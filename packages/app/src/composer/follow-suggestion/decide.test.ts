import { describe, expect, it } from "vitest";
import {
  decideFollowPromptSuggestion,
  resolveFollowChainPhase,
  resolveFollowPromptSuggestionsLimit,
  DEFAULT_FOLLOW_PROMPT_SUGGESTION_MAX_CONSECUTIVE,
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
    sentCount: 0,
    maxConsecutive: DEFAULT_FOLLOW_PROMPT_SUGGESTION_MAX_CONSECUTIVE,
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

  it("is inert when Autonomous mode is off for the chat, whatever else is true", () => {
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
  function walk(maxConsecutive: number | null, turns: number): string[] {
    // A chat that keeps producing a suggestion after every followed one.
    let sentCount = 0;
    const sent: string[] = [];
    for (let turn = 0; turn < turns; turn += 1) {
      const decision = decideFollowPromptSuggestion(
        input({ suggestion: `next step ${turn}`, sentCount, maxConsecutive }),
      );
      if (decision.action !== "send") {
        expect(decision.reason).toBe("limit-reached");
        break;
      }
      sent.push(decision.prompt);
      sentCount = decision.sentCount;
    }
    return sent;
  }

  it("stops after the configured number of consecutive follows", () => {
    expect(walk(3, 20)).toHaveLength(3);
    expect(walk(10, 20)).toHaveLength(10);
  });

  it("never stops on its own when the bound is unlimited", () => {
    expect(walk(null, 200)).toHaveLength(200);
  });

  it("refuses once the count has reached the bound", () => {
    expect(decideFollowPromptSuggestion(input({ sentCount: 5, maxConsecutive: 5 }))).toEqual({
      action: "skip",
      reason: "limit-reached",
    });
  });

  it("re-arms once the user's own message resets the count", () => {
    const exhausted = input({ sentCount: 3, maxConsecutive: 3 });
    expect(decideFollowPromptSuggestion(exhausted).action).toBe("skip");
    // A user send resets the chain to zero (chain-store.resetChain).
    expect(decideFollowPromptSuggestion({ ...exhausted, sentCount: 0 }).action).toBe("send");
  });
});

describe("resolveFollowPromptSuggestionsLimit", () => {
  it("maps each Settings choice to a bound, with unlimited as null", () => {
    expect(resolveFollowPromptSuggestionsLimit("3")).toBe(3);
    expect(resolveFollowPromptSuggestionsLimit("25")).toBe(25);
    expect(resolveFollowPromptSuggestionsLimit("unlimited")).toBeNull();
  });
});

describe("resolveFollowChainPhase", () => {
  it("is idle before anything has been followed", () => {
    expect(
      resolveFollowChainPhase({ isFollowEnabled: true, sentCount: 0, maxConsecutive: 3 }),
    ).toBe("idle");
  });

  it("reports following mid-chain and limit-reached at the bound", () => {
    expect(
      resolveFollowChainPhase({ isFollowEnabled: true, sentCount: 1, maxConsecutive: 3 }),
    ).toBe("following");
    expect(
      resolveFollowChainPhase({ isFollowEnabled: true, sentCount: 3, maxConsecutive: 3 }),
    ).toBe("limit-reached");
  });

  it("keeps following at any count when unlimited", () => {
    expect(
      resolveFollowChainPhase({ isFollowEnabled: true, sentCount: 500, maxConsecutive: null }),
    ).toBe("following");
  });

  it("shows nothing once Autonomous mode is off", () => {
    expect(
      resolveFollowChainPhase({ isFollowEnabled: false, sentCount: 2, maxConsecutive: 3 }),
    ).toBe("idle");
  });
});
