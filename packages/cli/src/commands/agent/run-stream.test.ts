import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { WebSocketServer, type WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import {
  AgentSnapshotPayloadSchema,
  SessionOutboundMessageSchema,
} from "@otto-code/protocol/messages";
import type { AgentStreamRecord } from "../../output/agent-stream.js";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const temporaryRoot = path.join(root, ".tmp");
const children: ChildProcess[] = [];
const cleanup: Array<() => Promise<void>> = [];
const agent = AgentSnapshotPayloadSchema.parse({
  id: "authoritative-agent-id",
  workspaceId: "workspace-owned",
  cwd: root,
  provider: "codex",
  model: "fixture",
  status: "running",
  title: "Fixture",
  createdAt: "2026-10-16T12:00:00.000Z",
  updatedAt: "2026-10-16T12:00:00.000Z",
  lastUserMessageAt: null,
  currentModeId: null,
  availableModes: [],
  pendingPermissions: [],
  persistence: null,
  labels: {},
  capabilities: {
    supportsStreaming: true,
    supportsSessionPersistence: true,
    supportsDynamicModes: true,
    supportsMcpServers: true,
    supportsReasoningStream: true,
    supportsToolInvocations: true,
  },
});

interface PendingWait {
  socket: WebSocket;
  requestId: string;
  agentId: string;
}

async function fixture() {
  await mkdir(temporaryRoot, { recursive: true });
  const home = await mkdtemp(path.join(temporaryRoot, "cli-stream-"));
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  const waits: PendingWait[] = [];
  const listeners: Array<(wait: PendingWait) => void> = [];
  const creates: unknown[] = [];
  let failCreation = false;
  function send(socket: WebSocket, message: unknown) {
    socket.send(
      JSON.stringify({ type: "session", message: SessionOutboundMessageSchema.parse(message) }),
    );
  }
  server.on("connection", (socket) => {
    send(socket, { type: "status", payload: { status: "server_info", serverId: "fixture-host" } });
    socket.on("message", (raw) => {
      const frame = JSON.parse(raw.toString());
      if (frame.type === "ping") {
        socket.send(JSON.stringify({ type: "pong" }));
        return;
      }
      const message = frame.message;
      if (!message) return;
      const { requestId } = message;
      if (message.type === "fetch_workspaces_request")
        send(socket, {
          type: "fetch_workspaces_response",
          payload: {
            requestId,
            entries: [
              {
                id: "workspace-owned",
                projectId: "project-owned",
                projectDisplayName: "Fixture",
                projectRootPath: root,
                workspaceDirectory: root,
                projectKind: "non_git",
                workspaceKind: "local_checkout",
                name: "Fixture",
                status: "running",
                statusEnteredAt: null,
                activityAt: null,
              },
            ],
            pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
          },
        });
      if (message.type === "create_agent_request") {
        creates.push(message);
        send(socket, {
          type: "status",
          payload: failCreation
            ? { status: "agent_create_failed", requestId, error: "Fixture creation failed" }
            : { status: "agent_created", requestId, agentId: agent.id, agent },
        });
      }
      if (message.type === "fetch_agent_request")
        send(socket, { type: "fetch_agent_response", payload: { requestId, agent, error: null } });
      if (message.type === "wait_for_finish_request") {
        const wait = { socket, requestId, agentId: message.agentId };
        const listener = listeners.shift();
        if (listener) listener(wait);
        else waits.push(wait);
      }
    });
  });
  cleanup.push(async () => {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (!path.resolve(home).startsWith(path.resolve(temporaryRoot) + path.sep))
      throw new Error("Unsafe fixture cleanup");
    await rm(home, { recursive: true, force: true });
  });
  function start(args: string[]) {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        path.join(root, "packages/cli/src/index.ts"),
        "--host",
        `127.0.0.1:${address.port}`,
        ...args,
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          OTTO_HOME: home,
          OTTO_AGENT_ID: "",
          OTTO_WORKSPACE_ID: "",
          OTTO_PASSWORD: "",
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    children.push(child);
    let stdout = "";
    let stderr = "";
    let firstLineResolve: (record: AgentStreamRecord) => void;
    let firstLineReject: (error: Error) => void;
    const firstLine = new Promise<AgentStreamRecord>((resolve, reject) => {
      firstLineResolve = resolve;
      firstLineReject = reject;
    });
    child.stdout.on("data", (data) => {
      stdout += data.toString();
      if (args.includes("--stream-json") && stdout.includes("\n"))
        firstLineResolve(JSON.parse(stdout.split("\n")[0]));
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    child.once("close", (code) => {
      if (args.includes("--stream-json") && !stdout.includes("\n"))
        firstLineReject(new Error(`CLI exited ${code} before receipt: ${stderr}`));
    });
    return {
      child,
      firstLine,
      exited,
      stdout: () => stdout,
      stderr: () => stderr,
      records: () =>
        stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as AgentStreamRecord),
    };
  }
  return {
    start,
    creates,
    failCreation: () => {
      failCreation = true;
    },
    nextWait: () =>
      waits.length
        ? Promise.resolve(waits.shift()!)
        : new Promise<PendingWait>((resolve) => listeners.push(resolve)),
    finish(
      wait: PendingWait,
      status: "idle" | "timeout" | "permission" | "error",
      lastMessage: string | null = null,
    ) {
      send(wait.socket, {
        type: "wait_for_finish_response",
        payload: {
          requestId: wait.requestId,
          status,
          final: {
            ...agent,
            status: status === "error" || status === "idle" ? status : "running",
            pendingPermissions:
              status === "permission"
                ? [
                    {
                      id: "permission-1",
                      provider: "codex",
                      name: "fixture",
                      kind: "tool",
                      input: {},
                    },
                  ]
                : [],
          },
          lastMessage,
          error: status === "error" ? "Fixture turn failed" : null,
        },
      });
    },
    failWait(wait: PendingWait) {
      send(wait.socket, {
        type: "rpc_error",
        payload: {
          requestId: wait.requestId,
          requestType: "wait_for_finish_request",
          code: "wait_failed",
          error: "Fixture wait disconnected",
        },
      });
    },
  };
}

afterEach(async () => {
  for (const child of children.splice(0))
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, "close");
      child.kill();
      await closed;
    }
  for (const dispose of cleanup.splice(0)) await dispose();
});

const runArgs = ["run", "--provider", "codex/fixture", "--workspace", "workspace-owned"];

describe("real CLI piped streaming", () => {
  it("flushes the authoritative receipt while the process is still waiting, then reports an ordinary question as idle", async () => {
    const f = await fixture();
    const process = f.start([...runArgs, "--stream-json", "Task"]);
    expect(await process.firstLine).toMatchObject({
      type: "agent.created",
      agentId: agent.id,
      workspaceId: "workspace-owned",
    });
    const wait = await f.nextWait();
    expect(process.child.exitCode).toBeNull();
    expect(process.records()).toHaveLength(1);
    expect(wait.agentId).toBe(agent.id);
    f.finish(wait, "idle", "Which file should I change?");
    expect(await process.exited).toBe(0);
    expect(process.records()).toEqual([
      {
        type: "agent.created",
        agentId: agent.id,
        workspaceId: "workspace-owned",
        provider: "codex",
        cwd: root,
        title: "Fixture",
      },
      {
        type: "agent.wait",
        agentId: agent.id,
        status: "idle",
        lastMessage: "Which file should I change?",
        error: null,
        permissions: [],
      },
    ]);
  }, 30000);

  it("resumes a timed-out wait on the same ID without another creation or receipt", async () => {
    const f = await fixture();
    const first = f.start([...runArgs, "--stream-json", "--wait-timeout", "1s", "Task"]);
    await first.firstLine;
    f.finish(await f.nextWait(), "timeout");
    expect(await first.exited).toBe(0);
    expect(first.records()[1]).toMatchObject({
      type: "agent.wait",
      status: "timeout",
      agentId: agent.id,
    });
    const resumed = f.start(["wait", agent.id, "--stream-json", "--timeout", "1s"]);
    const wait = await f.nextWait();
    expect(wait.agentId).toBe(agent.id);
    expect(resumed.stdout()).toBe("");
    f.finish(wait, "idle", "Ready for review");
    expect(await resumed.exited).toBe(0);
    expect(resumed.records()).toEqual([
      {
        type: "agent.wait",
        agentId: agent.id,
        status: "idle",
        lastMessage: "Ready for review",
        error: null,
        permissions: [],
      },
    ]);
    expect(f.creates).toHaveLength(1);
  }, 30000);

  it("preserves default foreground single-JSON output with no early stdout", async () => {
    const f = await fixture();
    const process = f.start([...runArgs, "--json", "Task"]);
    const wait = await f.nextWait();
    expect(process.stdout()).toBe("");
    f.finish(wait, "idle");
    expect(await process.exited).toBe(0);
    expect(JSON.parse(process.stdout())).toEqual({
      agentId: agent.id,
      status: "completed",
      provider: "codex",
      cwd: root,
      title: "Fixture",
    });
  }, 30000);

  it.each(["permission", "error"] as const)(
    "reports daemon %s as a typed wait outcome",
    async (status) => {
      const f = await fixture();
      const process = f.start([...runArgs, "--stream-json", "Task"]);
      await process.firstLine;
      f.finish(await f.nextWait(), status);
      expect(await process.exited).toBe(0);
      expect(process.records()[1]).toEqual({
        type: "agent.wait",
        agentId: agent.id,
        status,
        lastMessage: null,
        error: status === "error" ? "Fixture turn failed" : null,
        permissions: status === "permission" ? [{ id: "permission-1", kind: "tool" }] : [],
      });
    },
    30000,
  );

  it("retains the created ID in a terminal command error and exits nonzero", async () => {
    const f = await fixture();
    const process = f.start([...runArgs, "--stream-json", "Task"]);
    await process.firstLine;
    f.failWait(await f.nextWait());
    expect(await process.exited).toBe(1);
    expect(process.records().map((record) => record.type)).toEqual(["agent.created", "error"]);
    expect(process.records()[1]).toMatchObject({
      agentId: agent.id,
      error: {
        code: "AGENT_WAIT_FAILED",
        message: "Fixture wait disconnected requestType=wait_for_finish_request code=wait_failed",
      },
    });
    expect(f.creates).toHaveLength(1);
  }, 30000);

  it("emits only an error with no invented ID when creation fails", async () => {
    const f = await fixture();
    f.failCreation();
    const process = f.start([...runArgs, "--stream-json", "Task"]);
    expect(await process.exited).toBe(1);
    expect(process.records()).toEqual([
      {
        type: "error",
        agentId: null,
        error: {
          code: "AGENT_CREATE_FAILED",
          message: "Failed to create agent: Fixture creation failed",
        },
      },
    ]);
    expect(f.creates).toHaveLength(1);
  }, 30000);
});
