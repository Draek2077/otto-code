import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import { WebSocket } from "ws";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";

interface Frame {
  type: string;
  message?: { type: string; payload?: Record<string, unknown> };
}

class WirePeer {
  readonly frames: Frame[] = [];
  constructor(readonly socket: WebSocket) {
    socket.on("message", (data, binary) => {
      if (!binary) this.frames.push(JSON.parse(data.toString()));
    });
  }
  async connect() {
    await new Promise<void>((resolve, reject) => {
      this.socket.once("open", resolve);
      this.socket.once("error", reject);
    });
    this.socket.send(
      JSON.stringify({
        type: "hello",
        clientId: "shared-otto-session",
        clientType: "browser",
        protocolVersion: 1,
      }),
    );
    await expect
      .poll(() => this.frames.some((frame) => frame.message?.payload?.status === "server_info"))
      .toBe(true);
  }
  async request(type: string, requestId: string, fields: Record<string, unknown> = {}) {
    this.socket.send(JSON.stringify({ type: "session", message: { type, requestId, ...fields } }));
    const response = () =>
      this.frames.find((frame) => frame.message?.payload?.requestId === requestId)?.message;
    await expect.poll(response).toBeDefined();
    return response()!;
  }
}

test("serves populated Otto 0.9 checkouts and keeps mixed socket RPC dialects separate", async () => {
  const daemon = await createTestPaseoDaemon({
    daemonVersion: "0.10.0",
    relayEnabled: false,
    mcpEnabled: false,
    pluginsEnabled: false,
  });
  const url = `ws://127.0.0.1:${daemon.port}/ws`;
  const client = new DaemonClient({ url, reconnect: { enabled: false } });
  const peers: WirePeer[] = [];
  try {
    const gitProject = path.join(daemon.paseoHome, "git-project");
    const plainProject = path.join(daemon.paseoHome, "plain-project");
    await mkdir(gitProject);
    await mkdir(plainProject);
    execFileSync("git", ["init", "--initial-branch=main", gitProject], { stdio: "pipe" });
    await client.connect();
    await client.fetchAgents();
    await client.createAgent({ provider: "claude", cwd: gitProject });
    await client.createAgent({ provider: "claude", cwd: plainProject });

    const legacy = new WirePeer(new WebSocket(url));
    peers.push(legacy);
    await legacy.connect();
    const modern = new WirePeer(new WebSocket(url));
    peers.push(modern);
    await modern.connect();
    const agents = await legacy.request("fetch_agents_request", "agents");
    expect(agents.payload?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          project: expect.objectContaining({
            checkout: expect.objectContaining({
              cwd: gitProject,
              isGit: true,
              isOttoOwnedWorktree: false,
              isPaseoOwnedWorktree: false,
            }),
          }),
        }),
        expect.objectContaining({
          project: expect.objectContaining({
            checkout: expect.objectContaining({
              cwd: plainProject,
              isGit: false,
              isOttoOwnedWorktree: false,
              isPaseoOwnedWorktree: false,
            }),
          }),
        }),
      ]),
    );
    const status = await legacy.request("checkout_status_request", "status", { cwd: plainProject });
    expect(status.payload).toMatchObject({ isGit: false, isOttoOwnedWorktree: false });
    const oldList = await legacy.request("otto_worktree_list_request", "legacy-list", {
      cwd: gitProject,
    });
    expect(oldList.type).toBe("otto_worktree_list_response");
    const newList = await modern.request("paseo_worktree_list_request", "modern-list", {
      cwd: gitProject,
    });
    expect(newList.type).toBe("paseo_worktree_list_response");
    expect(legacy.frames.some((frame) => frame.message?.payload?.requestId === "modern-list")).toBe(
      false,
    );
    expect(modern.frames.some((frame) => frame.message?.payload?.requestId === "legacy-list")).toBe(
      false,
    );
  } finally {
    for (const peer of peers) peer.socket.terminate();
    await client.close();
    await daemon.close();
  }
}, 30_000);
