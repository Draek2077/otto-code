import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAssistantBubbleTexts,
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
    const unsubscribe = subscribeAssistantBubbleText(listener);

    reportAssistantBubbleText({ groupId: "g", blockIndex: 0, text: "one" });
    expect(listener).toHaveBeenCalledTimes(1);

    // Same value again — no work for subscribers. This matters: every segment
    // re-reports on each render pass while a reply streams.
    reportAssistantBubbleText({ groupId: "g", blockIndex: 0, text: "one" });
    expect(listener).toHaveBeenCalledTimes(1);

    reportAssistantBubbleText({ groupId: "g", blockIndex: 0, text: "two" });
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    reportAssistantBubbleText({ groupId: "g", blockIndex: 0, text: "three" });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
