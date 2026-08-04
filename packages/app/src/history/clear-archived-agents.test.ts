import { describe, expect, it, vi } from "vitest";
import {
  requestClearArchivedAgents,
  type ClearArchivedDeps,
  type ClearArchivedHost,
} from "./clear-archived-agents";

interface FakeHostOptions {
  serverId: string;
  matched: number;
  deleted?: number;
  failed?: number;
  agentIds?: string[];
  dryRunThrows?: boolean;
  sweepThrows?: boolean;
}

function fakeHost(options: FakeHostOptions): {
  host: ClearArchivedHost;
  calls: Array<{ dryRun: boolean; olderThanDays?: number }>;
} {
  const calls: Array<{ dryRun: boolean; olderThanDays?: number }> = [];
  const host: ClearArchivedHost = {
    serverId: options.serverId,
    clearArchivedAgents: async (input) => {
      calls.push(input);
      if (input.dryRun) {
        if (options.dryRunThrows) {
          throw new Error(`dry run failed on ${options.serverId}`);
        }
        return { matched: options.matched, deleted: 0, failed: 0, agentIds: [] };
      }
      if (options.sweepThrows) {
        throw new Error(`sweep failed on ${options.serverId}`);
      }
      return {
        matched: options.matched,
        deleted: options.deleted ?? options.matched,
        failed: options.failed ?? 0,
        agentIds: options.agentIds ?? [],
      };
    },
  };
  return { host, calls };
}

function deps(overrides: Partial<ClearArchivedDeps> = {}): ClearArchivedDeps {
  return {
    confirm: confirmFn(true),
    alert: alertFn(),
    onDeleted: vi.fn(),
    reportError: vi.fn(),
    ...overrides,
  };
}

/** Typed spies, so the assertions can read the dialog input each was handed. */
function confirmFn(result: boolean) {
  return vi.fn<ClearArchivedDeps["confirm"]>(async () => result);
}

function alertFn() {
  return vi.fn<ClearArchivedDeps["alert"]>(async () => undefined);
}

describe("requestClearArchivedAgents", () => {
  it("reports 'no host' rather than 'nothing to clear' when no host is eligible", async () => {
    const alert = alertFn();
    const d = deps({ alert });
    const outcome = await requestClearArchivedAgents({ hosts: [] }, d);
    expect(outcome).toBeNull();
    expect(d.confirm).not.toHaveBeenCalled();
    // "There are no archived chats" would be a claim we never verified.
    expect(alert.mock.calls[0]![0].title).toBe("No host available");
  });

  it("reports 'nothing to clear' when a host answered with zero matches", async () => {
    const { host } = fakeHost({ serverId: "a", matched: 0 });
    const alert = alertFn();

    await requestClearArchivedAgents({ hosts: [host] }, deps({ alert }));

    expect(alert.mock.calls[0]![0].title).toBe("Nothing to clear");
  });

  it("never asks for confirmation when nothing matched", async () => {
    const { host, calls } = fakeHost({ serverId: "a", matched: 0 });
    const d = deps();

    const outcome = await requestClearArchivedAgents({ hosts: [host] }, d);

    expect(outcome).toBeNull();
    expect(d.confirm).not.toHaveBeenCalled();
    // Dry run only - no destructive call was ever made.
    expect(calls).toEqual([{ dryRun: true, olderThanDays: undefined }]);
  });

  it("quotes the summed count across hosts in the confirm", async () => {
    const a = fakeHost({ serverId: "a", matched: 3, agentIds: ["a1", "a2", "a3"] });
    const b = fakeHost({ serverId: "b", matched: 4, agentIds: ["b1", "b2", "b3", "b4"] });
    const confirm = confirmFn(true);
    const d = deps({ confirm });

    const outcome = await requestClearArchivedAgents({ hosts: [a.host, b.host] }, d);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]![0].title).toBe("Clear 7 archived chats?");
    expect(outcome).toEqual({ matched: 7, deleted: 7, failed: 0, skippedHosts: [] });
  });

  it("deletes nothing when the user cancels", async () => {
    const { host, calls } = fakeHost({ serverId: "a", matched: 5 });
    const d = deps({ confirm: confirmFn(false) });

    const outcome = await requestClearArchivedAgents({ hosts: [host] }, d);

    expect(outcome).toBeNull();
    expect(calls.filter((call) => !call.dryRun)).toEqual([]);
    expect(d.onDeleted).not.toHaveBeenCalled();
  });

  it("reports deleted ids per host so caches drop exactly those rows", async () => {
    const a = fakeHost({ serverId: "a", matched: 2, agentIds: ["a1", "a2"] });
    const b = fakeHost({ serverId: "b", matched: 1, agentIds: ["b1"] });
    const onDeleted = vi.fn();

    await requestClearArchivedAgents({ hosts: [a.host, b.host] }, deps({ onDeleted }));

    expect(onDeleted).toHaveBeenCalledWith({ serverId: "a", agentIds: ["a1", "a2"] });
    expect(onDeleted).toHaveBeenCalledWith({ serverId: "b", agentIds: ["b1"] });
  });

  it("skips a host whose dry run failed instead of sweeping it blind", async () => {
    const broken = fakeHost({ serverId: "broken", matched: 9, dryRunThrows: true });
    const healthy = fakeHost({ serverId: "healthy", matched: 2, agentIds: ["h1", "h2"] });
    const reportError = vi.fn();

    const outcome = await requestClearArchivedAgents(
      { hosts: [broken.host, healthy.host] },
      deps({ reportError }),
    );

    // The broken host was asked once (the dry run) and never swept.
    expect(broken.calls).toEqual([{ dryRun: true, olderThanDays: undefined }]);
    expect(outcome).toEqual({
      matched: 2,
      deleted: 2,
      failed: 0,
      skippedHosts: ["broken"],
    });
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("skips hosts that matched zero even when another host matched", async () => {
    const empty = fakeHost({ serverId: "empty", matched: 0 });
    const full = fakeHost({ serverId: "full", matched: 1, agentIds: ["f1"] });

    await requestClearArchivedAgents({ hosts: [empty.host, full.host] }, deps());

    expect(empty.calls.filter((call) => !call.dryRun)).toEqual([]);
    expect(full.calls.filter((call) => !call.dryRun)).toHaveLength(1);
  });

  it("counts a failed sweep as failed, not deleted, and surfaces it", async () => {
    const { host } = fakeHost({ serverId: "a", matched: 4, sweepThrows: true });
    const alert = alertFn();
    const reportError = vi.fn();

    const outcome = await requestClearArchivedAgents(
      { hosts: [host] },
      deps({ alert, reportError }),
    );

    expect(outcome).toEqual({ matched: 4, deleted: 0, failed: 4, skippedHosts: [] });
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0]![0].title).toBe("Some chats could not be cleared");
  });

  it("surfaces a partial per-item failure the daemon reported", async () => {
    const { host } = fakeHost({
      serverId: "a",
      matched: 5,
      deleted: 3,
      failed: 2,
      agentIds: ["a1", "a2", "a3"],
    });
    const alert = alertFn();

    const outcome = await requestClearArchivedAgents({ hosts: [host] }, deps({ alert }));

    expect(outcome).toEqual({ matched: 5, deleted: 3, failed: 2, skippedHosts: [] });
    expect(alert.mock.calls[0]![0].message).toContain("Deleted 3.");
  });

  it("stays quiet on a clean sweep - no dialog after the confirm", async () => {
    const { host } = fakeHost({ serverId: "a", matched: 2, agentIds: ["a1", "a2"] });
    const alert = alertFn();

    await requestClearArchivedAgents({ hosts: [host] }, deps({ alert }));

    expect(alert).not.toHaveBeenCalled();
  });

  it("passes olderThanDays through to both passes", async () => {
    const { host, calls } = fakeHost({ serverId: "a", matched: 1, agentIds: ["a1"] });

    await requestClearArchivedAgents({ hosts: [host], olderThanDays: 30 }, deps());

    expect(calls).toEqual([
      { dryRun: true, olderThanDays: 30 },
      { dryRun: false, olderThanDays: 30 },
    ]);
  });
});
