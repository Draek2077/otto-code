import { describe, expect, it, vi } from "vitest";
import {
  clearCompletedSubagents,
  requestClearCompletedSubagents,
  resolveClearCompletedDialog,
  type RequestClearCompletedSubagentsDeps,
} from "./clear-completed-subagents";

function buildDeps(
  overrides: Partial<RequestClearCompletedSubagentsDeps> = {},
): RequestClearCompletedSubagentsDeps {
  return {
    confirm: vi.fn(async () => true),
    archiveAgent: vi.fn(async () => {}),
    recordCleared: vi.fn(),
    reportError: vi.fn(),
    ...overrides,
  };
}

describe("requestClearCompletedSubagents", () => {
  it("archives every row after a single confirm and records their tokens", async () => {
    const deps = buildDeps();

    await requestClearCompletedSubagents(
      {
        serverId: "s1",
        parentAgentId: "p1",
        rows: [{ id: "a", cumulativeTokens: 100 }, { id: "b", cumulativeTokens: 200 }, { id: "c" }],
      },
      deps,
    );

    expect(deps.confirm).toHaveBeenCalledTimes(1);
    expect(deps.archiveAgent).toHaveBeenCalledTimes(3);
    expect(deps.archiveAgent).toHaveBeenCalledWith({ serverId: "s1", agentId: "a" });
    expect(deps.archiveAgent).toHaveBeenCalledWith({ serverId: "s1", agentId: "c" });
    // Each successful archive rolls its tokens into the parent tally.
    expect(deps.recordCleared).toHaveBeenCalledWith({
      serverId: "s1",
      parentAgentId: "p1",
      rows: [{ id: "a", cumulativeTokens: 100 }],
    });
    expect(deps.recordCleared).toHaveBeenCalledTimes(3);
  });

  it("does nothing when there are no rows (no confirm)", async () => {
    const deps = buildDeps();

    await requestClearCompletedSubagents({ serverId: "s1", parentAgentId: "p1", rows: [] }, deps);

    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.archiveAgent).not.toHaveBeenCalled();
    expect(deps.recordCleared).not.toHaveBeenCalled();
  });

  it("archives nothing when the user cancels", async () => {
    const deps = buildDeps({ confirm: vi.fn(async () => false) });

    await requestClearCompletedSubagents(
      { serverId: "s1", parentAgentId: "p1", rows: [{ id: "a" }] },
      deps,
    );

    expect(deps.archiveAgent).not.toHaveBeenCalled();
    expect(deps.recordCleared).not.toHaveBeenCalled();
  });
});

describe("clearCompletedSubagents", () => {
  it("records tokens only for rows that archived successfully", async () => {
    const archiveAgent = vi.fn(async ({ agentId }: { serverId: string; agentId: string }) => {
      if (agentId === "b") {
        throw new Error("archive failed");
      }
    });
    const deps = buildDeps({ archiveAgent });

    await clearCompletedSubagents(
      {
        serverId: "s1",
        parentAgentId: "p1",
        rows: [
          { id: "a", cumulativeTokens: 10 },
          { id: "b", cumulativeTokens: 20 },
          { id: "c", cumulativeTokens: 30 },
        ],
      },
      deps,
    );

    expect(archiveAgent).toHaveBeenCalledTimes(3);
    expect(deps.reportError).toHaveBeenCalledTimes(1);
    // The failed row ("b") is never recorded — it stays live and counted normally.
    expect(deps.recordCleared).toHaveBeenCalledTimes(2);
    const recordedIds = (deps.recordCleared as ReturnType<typeof vi.fn>).mock.calls
      .flatMap((call) => call[0].rows)
      .map((row: { id: string }) => row.id);
    expect(recordedIds).toEqual(["a", "c"]);
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
