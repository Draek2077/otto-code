import { describe, expect, it } from "vitest";
import { CHAT_OUTLINE_CLEARANCE, resolveChatOutlinePadding } from "./chat-width-layout";

describe("resolveChatOutlinePadding", () => {
  it("eases clearance in as a capped lane occupies more of the pane", () => {
    const roomy = resolveChatOutlinePadding({
      railVisible: true,
      paneWidth: 1920,
      chatMaxWidth: 820,
    });
    const nearEdge = resolveChatOutlinePadding({
      railVisible: true,
      paneWidth: 1000,
      chatMaxWidth: 820,
    });

    expect(roomy).toBeGreaterThan(0);
    expect(nearEdge).toBeGreaterThan(roomy);
    expect(nearEdge).toBeLessThan(CHAT_OUTLINE_CLEARANCE);
  });

  it("uses the full clearance only when the lane fills the pane", () => {
    expect(
      resolveChatOutlinePadding({ railVisible: true, paneWidth: 1200, chatMaxWidth: 1200 }),
    ).toBe(CHAT_OUTLINE_CLEARANCE);
    expect(
      resolveChatOutlinePadding({ railVisible: true, paneWidth: 1200, chatMaxWidth: undefined }),
    ).toBe(CHAT_OUTLINE_CLEARANCE);
  });

  it("does not reserve space without a visible rail or measured pane", () => {
    expect(
      resolveChatOutlinePadding({ railVisible: false, paneWidth: 1200, chatMaxWidth: undefined }),
    ).toBe(0);
    expect(
      resolveChatOutlinePadding({ railVisible: true, paneWidth: 0, chatMaxWidth: undefined }),
    ).toBe(0);
  });
});
