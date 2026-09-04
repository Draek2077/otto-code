import { describe, expect, it } from "vitest";
import { isMobileWorkspaceSwitcherTarget } from "./mobile-switcher";

describe("isMobileWorkspaceSwitcherTarget", () => {
  it.each([
    { kind: "changes_tree" } as const,
    { kind: "files" } as const,
    { kind: "project_search" } as const,
    { kind: "working_diff" } as const,
  ])("keeps Explorer target $kind out of the mobile workspace switcher", (target) => {
    expect(isMobileWorkspaceSwitcherTarget(target)).toBe(false);
  });

  it("keeps main workspace targets in the switcher", () => {
    expect(isMobileWorkspaceSwitcherTarget({ kind: "agent", agentId: "agent-1" })).toBe(true);
    expect(isMobileWorkspaceSwitcherTarget({ kind: "file", path: "/repo/readme.md" })).toBe(true);
  });
});
