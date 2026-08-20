import { fileURLToPath } from "node:url";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import {
  LspConnection,
  LspInitializeTimeoutError,
  LspRequestTimeoutError,
  LspServerExitedError,
  planLanguageServerSpawn,
  type LspExitInfo,
} from "./connection.js";
import { isPlatform } from "../../test-utils/platform.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "test-fixtures");
const stubServer = path.join(fixturesDir, "stub-language-server.mjs");
const logger = pino({ level: "silent" });

const started: LspConnection[] = [];

afterEach(async () => {
  await Promise.all(started.splice(0).map((connection) => connection.stop()));
});

interface StartStubInput {
  mode?: string;
  initializeTimeoutMs?: number;
  requestTimeoutMs?: number;
  onExit?: (info: LspExitInfo) => void;
}

async function startStub(input: StartStubInput = {}): Promise<LspConnection> {
  const connection = await LspConnection.start({
    spec: {
      id: "stub",
      command: process.execPath,
      args: [stubServer, input.mode ?? "normal"],
      rootPath: fixturesDir,
    },
    logger,
    initializeTimeoutMs: input.initializeTimeoutMs ?? 15000,
    requestTimeoutMs: input.requestTimeoutMs ?? 5000,
    onExit: input.onExit ?? (() => {}),
  });
  started.push(connection);
  return connection;
}

describe("spawn planning", () => {
  it("passes a plain executable through untouched", () => {
    expect(planLanguageServerSpawn("/usr/bin/pyright-langserver", ["--stdio"])).toEqual({
      command: "/usr/bin/pyright-langserver",
      args: ["--stdio"],
      windowsVerbatimArguments: false,
    });
  });

  it.skipIf(!isPlatform("win32"))("routes a .cmd shim through ComSpec with quoting", () => {
    const plan = planLanguageServerSpawn("C:\\My Projects\\ws\\node_modules\\.bin\\tsls.cmd", [
      "--stdio",
    ]);

    expect(plan.windowsVerbatimArguments).toBe(true);
    expect(plan.args).toEqual([
      "/d",
      "/s",
      "/c",
      '""C:\\My Projects\\ws\\node_modules\\.bin\\tsls.cmd" --stdio"',
    ]);
  });

  it.skipIf(!isPlatform("win32"))("leaves a space-free .cmd path unquoted", () => {
    const plan = planLanguageServerSpawn("C:\\ws\\node_modules\\.bin\\tsls.cmd", ["--stdio"]);

    expect(plan.args[3]).toBe('"C:\\ws\\node_modules\\.bin\\tsls.cmd --stdio"');
  });
});

describe("LspConnection handshake", () => {
  it("completes initialize and exposes the server's capabilities", async () => {
    const connection = await startStub();

    expect(connection.capabilities.definitionProvider).toBe(true);
    expect(connection.serverInfo).toEqual({ name: "stub-language-server", version: "1.0.0" });
  });

  it("kills a server that misses its initialize deadline instead of awaiting it", async () => {
    const exits: LspExitInfo[] = [];

    await expect(
      startStub({
        mode: "hang-initialize",
        initializeTimeoutMs: 250,
        onExit: (info) => exits.push(info),
      }),
    ).rejects.toThrow(LspInitializeTimeoutError);

    expect(exits).toHaveLength(1);
  });

  it("reports a server that dies during startup", async () => {
    await expect(startStub({ mode: "exit-immediately" })).rejects.toThrow(LspServerExitedError);
  });
});

describe("LspConnection requests", () => {
  it("round-trips a request through the real framing", async () => {
    const connection = await startStub();

    const result = await connection.request<{ echoed: { value: string } }>("stub/echo", {
      value: "hello",
    });

    expect(result).toEqual({ echoed: { value: "hello" } });
  });

  it("times out a request that never answers, leaving the connection usable", async () => {
    const connection = await startStub({ requestTimeoutMs: 250 });

    await expect(connection.request("stub/hang", {})).rejects.toThrow(LspRequestTimeoutError);

    const result = await connection.request<{ echoed: { value: string } }>("stub/echo", {
      value: "still alive",
    });
    expect(result).toEqual({ echoed: { value: "still alive" } });
  });

  /**
   * The requirement these pin: whatever the host environment supplies as a "language server",
   * the DAEMON survives it. A crashing csharp-ls once took the whole daemon down - every agent,
   * every terminal - in a restart loop, because a write to its dead pipe rejected with nobody
   * listening. What the server is, and why it failed, must not be the daemon's problem.
   */
  it.each([
    ["binary noise that never speaks LSP", "garbage"],
    ["a process that spits bytes and dies", "garbage-then-die"],
    ["a process that exits before saying anything", "exit-immediately"],
  ])("survives %s", async (_label, mode) => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", onRejection);

    try {
      // Rejecting is correct - there is no usable server. Throwing something the caller can
      // handle is the contract; escaping as an unhandled rejection is the bug.
      await expect(startStub({ mode, initializeTimeoutMs: 400 })).rejects.toThrow();

      // Give anything in flight a turn of the loop to surface before asserting it did not.
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });

  it("rejects in-flight and later requests once the server exits", async () => {
    const connection = await startStub();

    connection.notify("stub/die", {});
    await connection.whenExited;

    await expect(connection.request("stub/echo", {})).rejects.toThrow(LspServerExitedError);
  });
});

describe("LspConnection shutdown", () => {
  it("reports the exit to its owner", async () => {
    const exits: LspExitInfo[] = [];
    const connection = await startStub({ onExit: (info) => exits.push(info) });

    await connection.stop();

    expect(exits).toHaveLength(1);
    expect(connection.isRunning).toBe(false);
  });

  it("is safe to stop twice", async () => {
    const connection = await startStub();

    await connection.stop();
    await connection.stop();

    expect(connection.isRunning).toBe(false);
  });
});
