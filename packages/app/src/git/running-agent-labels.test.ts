import { describe, expect, it } from "vitest";
import { resolveRunningAgentLabels } from "@/git/running-agent-labels";

describe("resolveRunningAgentLabels", () => {
  it("uses the hydrated chat title for the daemon-confirmed active agent", () => {
    // Regression: rollback correctly warned about an active agent, but read only
    // its launch config title and displayed "Unnamed Agent" after auto-titling.
    expect(
      resolveRunningAgentLabels(
        [{ id: "active-agent", title: null }],
        new Map([["active-agent", { title: "Repair rollback warning" }]]),
        "Unnamed agent",
      ),
    ).toBe("Repair rollback warning");
  });

  it("uses the daemon title until that chat is hydrated locally", () => {
    expect(
      resolveRunningAgentLabels(
        [{ id: "active-agent", title: "Explicit worker title" }],
        undefined,
        "Unnamed agent",
      ),
    ).toBe("Explicit worker title");
  });

  it("uses the explicit fallback only when neither source names the active chat", () => {
    expect(
      resolveRunningAgentLabels(
        [
          { id: "untitled", title: "  " },
          { id: "also-untitled", title: null },
        ],
        new Map([["untitled", { title: null }]]),
        "Unnamed agent",
      ),
    ).toBe("Unnamed agent, Unnamed agent");
  });
});
