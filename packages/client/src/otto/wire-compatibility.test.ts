import { expect, test, vi } from "vitest";
import { DaemonClient, type DaemonTransport } from "../daemon-client.js";

test("uses the old host's worktree dialect and resets it on new server_info", async () => {
  const sent: string[] = [];
  let receive: (value: string) => void = () => {};
  let opened: () => void = () => {};
  const transport: DaemonTransport = {
    send(value) {
      if (typeof value === "string") sent.push(value);
    },
    close() {},
    onMessage(handler) {
      receive = (value) => handler(value, false);
      return () => {};
    },
    onOpen(handler) {
      opened = handler;
      return () => {};
    },
    onClose() {
      return () => {};
    },
    onError() {
      return () => {};
    },
  };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const client = new DaemonClient({
    url: "ws://test",
    clientId: "otto-wire-test",
    transportFactory: () => transport,
    logger,
    reconnect: { enabled: false },
  });
  const message = (value: unknown) => receive(JSON.stringify({ type: "session", message: value }));
  const info = (version: string, features: Record<string, boolean>) =>
    message({
      type: "status",
      payload: { status: "server_info", serverId: "test", version, features },
    });
  try {
    const connected = client.connect();
    opened();
    info("0.9.35", { brainControl: true });
    await connected;
    message({ type: "activity_stats_changed" });
    const oldRequest = client.getPaseoWorktreeList({ cwd: "/repo" });
    const oldWire = JSON.parse(sent.at(-1)!).message;
    expect(oldWire.type).toBe("otto_worktree_list_request");
    message({
      type: "otto_worktree_list_response",
      payload: {
        requestId: oldWire.requestId,
        worktrees: [],
        error: null,
      },
    });
    await expect(oldRequest).resolves.toMatchObject({ worktrees: [], error: null });

    // A rebuilt development host may still report 0.9.35 until release versioning.
    info("0.9.35", { brainControl: true, backgroundWorkspaces: true });
    const currentRequest = client.getPaseoWorktreeList({ cwd: "/repo" });
    const currentWire = JSON.parse(sent.at(-1)!).message;
    expect(currentWire.type).toBe("paseo_worktree_list_request");
    message({
      type: "paseo_worktree_list_response",
      payload: {
        requestId: currentWire.requestId,
        worktrees: [],
        error: null,
      },
    });
    await expect(currentRequest).resolves.toMatchObject({ worktrees: [], error: null });
    expect(logger.warn).not.toHaveBeenCalled();
  } finally {
    await client.close();
  }
});
