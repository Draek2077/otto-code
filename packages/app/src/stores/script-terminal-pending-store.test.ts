import { beforeEach, describe, expect, it } from "vitest";
import {
  buildScriptTerminalWorkspaceKey,
  markScriptTerminalPending,
  useScriptTerminalPendingStore,
} from "@/stores/script-terminal-pending-store";

const workspaceKey = buildScriptTerminalWorkspaceKey("host-1", "ws-1");

function pendingIds(): ReadonlyMap<string, number> {
  return useScriptTerminalPendingStore.getState().pendingByWorkspace[workspaceKey] ?? new Map();
}

describe("script terminal pending store", () => {
  beforeEach(() => {
    useScriptTerminalPendingStore.setState({ pendingByWorkspace: {} });
  });

  it("keeps pending script terminals until they appear or a fresher list arrives", () => {
    const { markPending, reconcile } = useScriptTerminalPendingStore.getState();
    markPending(workspaceKey, "older-than-list", 10);
    markPending(workspaceKey, "now-live", 20);
    markPending(workspaceKey, "still-pending", 30);

    reconcile(workspaceKey, { liveTerminalIds: ["now-live"], dataUpdatedAt: 20 });

    expect(pendingIds()).toEqual(new Map([["still-pending", 30]]));
  });

  it("leaves the pending map untouched when reconciliation changes nothing", () => {
    const { markPending, reconcile } = useScriptTerminalPendingStore.getState();
    markPending(workspaceKey, "still-pending", 30);
    const before = pendingIds();

    reconcile(workspaceKey, { liveTerminalIds: [], dataUpdatedAt: 20 });

    expect(pendingIds()).toBe(before);
  });

  it("keeps each workspace's pending terminals separate", () => {
    const otherKey = buildScriptTerminalWorkspaceKey("host-1", "ws-2");
    markScriptTerminalPending({
      serverId: "host-1",
      workspaceId: "ws-1",
      terminalId: "term-1",
      listedAt: 10,
    });
    markScriptTerminalPending({
      serverId: "host-1",
      workspaceId: "ws-2",
      terminalId: "term-2",
      listedAt: 10,
    });

    useScriptTerminalPendingStore
      .getState()
      .reconcile(workspaceKey, { liveTerminalIds: ["term-1"], dataUpdatedAt: 10 });

    expect(pendingIds().size).toBe(0);
    expect(useScriptTerminalPendingStore.getState().pendingByWorkspace[otherKey]).toEqual(
      new Map([["term-2", 10]]),
    );
  });
});
