import { describe, expect, it, vi } from "vitest";
import {
  requestClearCompletedSubagents,
  resolveClearCompletedDialog,
  type ClearCompletedSubagentsDeps,
} from "./clear-completed-subagents";

function buildDeps(
  overrides: Partial<ClearCompletedSubagentsDeps> = {},
): ClearCompletedSubagentsDeps {
  return {
    confirm: vi.fn(async () => true),
    archiveAgent: vi.fn(async () => {}),
    reportError: vi.fn(),
    ...overrides,
  };
}

describe("requestClearCompletedSubagents", () => {
  it("archives every id after a single confirm", async () => {
    const deps = buildDeps();

    await requestClearCompletedSubagents({ serverId: "s1", subagentIds: ["a", "b", "c"] }, deps);

    expect(deps.confirm).toHaveBeenCalledTimes(1);
    expect(deps.archiveAgent).toHaveBeenCalledTimes(3);
    expect(deps.archiveAgent).toHaveBeenCalledWith({ serverId: "s1", agentId: "a" });
    expect(deps.archiveAgent).toHaveBeenCalledWith({ serverId: "s1", agentId: "c" });
  });

  it("does nothing when the id list is empty (no confirm)", async () => {
    const deps = buildDeps();

    await requestClearCompletedSubagents({ serverId: "s1", subagentIds: [] }, deps);

    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.archiveAgent).not.toHaveBeenCalled();
  });

  it("archives nothing when the user cancels", async () => {
    const deps = buildDeps({ confirm: vi.fn(async () => false) });

    await requestClearCompletedSubagents({ serverId: "s1", subagentIds: ["a"] }, deps);

    expect(deps.archiveAgent).not.toHaveBeenCalled();
  });

  it("reports per-id failures without aborting the rest", async () => {
    const archiveAgent = vi.fn(async ({ agentId }: { serverId: string; agentId: string }) => {
      if (agentId === "b") {
        throw new Error("archive failed");
      }
    });
    const deps = buildDeps({ archiveAgent });

    await requestClearCompletedSubagents({ serverId: "s1", subagentIds: ["a", "b", "c"] }, deps);

    expect(archiveAgent).toHaveBeenCalledTimes(3);
    expect(deps.reportError).toHaveBeenCalledTimes(1);
  });
});

describe("resolveClearCompletedDialog", () => {
  it("uses singular copy for one row", () => {
    const dialog = resolveClearCompletedDialog(1);
    expect(dialog.title).toBe("Clear completed subagent?");
    expect(dialog.message).toContain("1 completed subagent");
  });

  it("uses plural copy for multiple rows", () => {
    const dialog = resolveClearCompletedDialog(3);
    expect(dialog.title).toBe("Clear 3 completed subagents?");
    expect(dialog.message).toContain("3 completed subagents");
  });
});
