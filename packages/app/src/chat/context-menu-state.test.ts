import { describe, expect, it } from "vitest";
import { resolveChatContextMenuOwner } from "./context-menu-state";

describe("resolveChatContextMenuOwner", () => {
  it("gives selected text priority over a semantic target", () => {
    expect(resolveChatContextMenuOwner({ hasTextSelection: true, hasTarget: true })).toBe(
      "selection",
    );
  });

  it("uses target actions when no text is selected", () => {
    expect(resolveChatContextMenuOwner({ hasTextSelection: false, hasTarget: true })).toBe(
      "target",
    );
  });

  it("falls back to transcript actions for empty chat space", () => {
    expect(resolveChatContextMenuOwner({ hasTextSelection: false, hasTarget: false })).toBe("chat");
  });
});
