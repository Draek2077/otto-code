import { describe, expect, it } from "vitest";
import { resolveCloseAgentTabPolicy } from "./close-tab-policy";

describe("resolveCloseAgentTabPolicy", () => {
  it("archives root agents when their tab closes", () => {
    expect(resolveCloseAgentTabPolicy({ parentAgentId: null })).toEqual({
      kind: "archive-on-close",
    });
  });

  it("keeps subagent tab close layout-only", () => {
    expect(resolveCloseAgentTabPolicy({ parentAgentId: "parent-agent" })).toEqual({
      kind: "layout-only",
    });
  });

  it("keeps native subagent tab close layout-only regardless of running state", () => {
    // A native create_agent subagent: closing its tab must never stop or
    // archive it — Item 5 of the subagents-cleanup charter.
    expect(resolveCloseAgentTabPolicy({ parentAgentId: "parent-agent" })).toEqual({
      kind: "layout-only",
    });
  });

  it("keeps observed subagent tab close layout-only", () => {
    // Observed subagents (Claude Task / ultracode fan-out) are also parented,
    // so the same layout-only rule applies. The only way to end one is the
    // explicit Stop action, never a tab close.
    expect(resolveCloseAgentTabPolicy({ parentAgentId: "parent-agent::observed" })).toEqual({
      kind: "layout-only",
    });
  });

  it("preserves the existing archive fallback when the agent is missing", () => {
    expect(resolveCloseAgentTabPolicy(null)).toEqual({ kind: "archive-on-close" });
    expect(resolveCloseAgentTabPolicy(undefined)).toEqual({ kind: "archive-on-close" });
  });
});
