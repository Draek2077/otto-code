import { describe, expect, it, vi } from "vitest";
import {
  requestClearArchivedAgents,
  type ClearArchivedDeps,
  type ClearArchivedHost,
} from "./clear-archived-agents";

function fakeHost(serverId: string, matched: number, agentIds: string[] = []) {
  const calls: Array<{ dryRun: boolean; olderThanDays?: number }> = [];
  const host: ClearArchivedHost = {
    serverId,
    clearArchivedAgents: async (input) => {
      calls.push(input);
      return input.dryRun
        ? { matched, deleted: 0, failed: 0, agentIds: [] }
        : { matched, deleted: matched, failed: 0, agentIds };
    },
  };
  return { host, calls };
}

function deps(overrides: Partial<ClearArchivedDeps> = {}): ClearArchivedDeps {
  return {
    confirm: vi.fn(async () => true),
    alert: vi.fn(async () => undefined),
    onDeleted: vi.fn(),
    reportError: vi.fn(),
    ...overrides,
  };
}

describe("requestClearArchivedAgents", () => {
  it("runs a real dry run before deleting across hosts", async () => {
    const a = fakeHost("a", 2, ["a1", "a2"]);
    const b = fakeHost("b", 1, ["b1"]);
    const onDeleted = vi.fn();
    const outcome = await requestClearArchivedAgents(
      { hosts: [a.host, b.host], scope: "allHosts" },
      deps({ onDeleted }),
    );
    expect(outcome).toMatchObject({ matched: 3, deleted: 3, failed: 0 });
    expect(a.calls).toEqual([{ dryRun: true, olderThanDays: undefined }, { dryRun: false }]);
    expect(onDeleted).toHaveBeenCalledWith({ serverId: "a", agentIds: ["a1", "a2"] });
  });

  it("does not confirm or delete when no host matches", async () => {
    const a = fakeHost("a", 0);
    const d = deps();
    expect(await requestClearArchivedAgents({ hosts: [a.host], scope: "oneHost" }, d)).toBeNull();
    expect(d.confirm).not.toHaveBeenCalled();
    expect(a.calls).toEqual([{ dryRun: true, olderThanDays: undefined }]);
  });
});
