import { describe, expect, it } from "vitest";
import { CHAT_OUTLINE_CLEARANCE, resolveChatOutlinePadding } from "./chat-width-layout";

describe("resolveChatOutlinePadding", () => {
  it("uses a fixed gutter whenever the rail is visible", () => {
    expect(resolveChatOutlinePadding({ railVisible: true })).toBe(CHAT_OUTLINE_CLEARANCE);
  });

  it("does not reserve space without a visible rail", () => {
    expect(resolveChatOutlinePadding({ railVisible: false })).toBe(0);
  });
});
