import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAssistantBubbleTexts,
  getAssistantBubbleHasText,
  getAssistantBubbleText,
  reportAssistantBubbleText,
  subscribeAssistantBubbleText,
} from "./assistant-bubble-text";

afterEach(() => {
  clearAssistantBubbleTexts();
});

describe("assistant bubble text registry", () => {
  it("returns empty for an unknown group", () => {
    expect(getAssistantBubbleText("missing")).toBe("");
  });

  it("rejoins a group's blocks in block order, not arrival order", () => {
    reportAssistantBubbleText({ groupId: "g", blockIndex: 2, text: "third" });
    reportAssistantBubbleText({ groupId: "g", blockIndex: 0, text: "first" });
    reportAssistantBubbleText({ groupId: "g", blockIndex: 1, text: "second" });
    expect(getAssistantBubbleText("g")).toBe("first\n\nsecond\n\nthird");
  });

  it("keeps groups separate", () => {
    reportAssistantBubbleText({ groupId: "a", blockIndex: 0, text: "alpha" });
    reportAssistantBubbleText({ groupId: "b", blockIndex: 0, text: "beta" });
    expect(getAssistantBubbleText("a")).toBe("alpha");
    expect(getAssistantBubbleText("b")).toBe("beta");
  });

  it("replaces a block's text when the streaming tail grows", () => {
    reportAssistantBubbleText({ groupId: "g", blockIndex: 0, text: "partial" });
    reportAssistantBubbleText({ groupId: "g", blockIndex: 0, text: "partial and complete" });
    expect(getAssistantBubbleText("g")).toBe("partial and complete");
  });

  it("drops blocks that are empty or whitespace-only", () => {
    reportAssistantBubbleText({ groupId: "g", blockIndex: 0, text: "kept" });
    reportAssistantBubbleText({ groupId: "g", blockIndex: 1, text: "   \n  " });
    reportAssistantBubbleText({ groupId: "g", blockIndex: 2, text: "also kept" });
    expect(getAssistantBubbleText("g")).toBe("kept\n\nalso kept");
  });

  it("notifies subscribers only when the text actually changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAssistantBubbleText("g", listener);

    reportAssistantBubbleText({ groupId: "g", blockIndex: 0, text: "one" });
    expect(listener).toHaveBeenCalledTimes(1);

    // Same value again - no work for subscribers. This matters: every segment
    // re-reports on each render pass while a reply streams.
    reportAssistantBubbleText({ groupId: "g", blockIndex: 0, text: "one" });
    expect(listener).toHaveBeenCalledTimes(1);

    reportAssistantBubbleText({ groupId: "g", blockIndex: 0, text: "two" });
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    reportAssistantBubbleText({ groupId: "g", blockIndex: 0, text: "three" });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("leaves other groups' subscribers alone when one group flushes", () => {
    // The point of per-group buckets: while one reply streams, every other
    // mounted bubble in the transcript must stay asleep instead of re-deriving
    // its own state on each reveal tick.
    const live = vi.fn();
    const settled = vi.fn();
    subscribeAssistantBubbleText("live", live);
    subscribeAssistantBubbleText("settled", settled);

    reportAssistantBubbleText({ groupId: "live", blockIndex: 0, text: "streaming" });
    reportAssistantBubbleText({ groupId: "live", blockIndex: 0, text: "streaming stil" });
    reportAssistantBubbleText({ groupId: "live", blockIndex: 0, text: "streaming still" });

    expect(live).toHaveBeenCalledTimes(3);
    expect(settled).not.toHaveBeenCalled();
  });

  it("tracks whether a group has readable text without joining it", () => {
    expect(getAssistantBubbleHasText("g")).toBe(false);

    reportAssistantBubbleText({ groupId: "g", blockIndex: 0, text: "  \n " });
    expect(getAssistantBubbleHasText("g")).toBe(false);

    reportAssistantBubbleText({ groupId: "g", blockIndex: 1, text: "words" });
    expect(getAssistantBubbleHasText("g")).toBe(true);

    // A block emptied back out again - the count has to come back down, or the
    // playback button offers to read nothing.
    reportAssistantBubbleText({ groupId: "g", blockIndex: 1, text: "" });
    expect(getAssistantBubbleHasText("g")).toBe(false);
    expect(getAssistantBubbleText("g")).toBe("");
  });
});
