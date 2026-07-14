import { describe, expect, it } from "vitest";
import { getUnattendedModeId, isUserSelectableMode } from "./provider-manifest";

describe("isUserSelectableMode", () => {
  it("hides Claude's system-assigned dontAsk mode", () => {
    expect(isUserSelectableMode("claude", "dontAsk")).toBe(false);
  });

  it("keeps ordinary Claude modes selectable, including bypass", () => {
    expect(isUserSelectableMode("claude", "default")).toBe(true);
    expect(isUserSelectableMode("claude", "auto")).toBe(true);
    expect(isUserSelectableMode("claude", "bypassPermissions")).toBe(true);
  });

  it("defaults unknown providers and modes to selectable", () => {
    expect(isUserSelectableMode("codex", "full-access")).toBe(true);
    expect(isUserSelectableMode("claude", "not-a-real-mode")).toBe(true);
    expect(isUserSelectableMode("no-such-provider", "dontAsk")).toBe(true);
  });
});

describe("getUnattendedModeId", () => {
  it("returns dontAsk for Claude — the guardrailed unattended target before bypass", () => {
    expect(getUnattendedModeId("claude")).toBe("dontAsk");
  });
});
