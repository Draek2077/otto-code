// OTTO(desktop-shutdown): bound captured CLI waits during explicit development quit.
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { runExternalCliJsonCommand, runExternalCliTextCommand } from "./external";

const mocks = vi.hoisted(() => ({
  createNodeEntrypointInvocation: vi.fn(() => ({
    command: "node",
    args: ["runner.js", "node-script", "cli.js"],
    env: { PASEO_NODE_ENV: "production" },
  })),
  resolveExternalCliEntrypoint: vi.fn(() => ({
    entryPath: "cli.js",
    execArgv: [],
  })),
  spawnProcess: vi.fn(),
}));

vi.mock("@getpaseo/server/process", () => ({
  spawnProcess: mocks.spawnProcess,
}));

vi.mock("electron-log/main", () => ({
  default: { warn: vi.fn() },
}));

vi.mock("../runtime-paths.js", () => ({
  createNodeEntrypointInvocation: mocks.createNodeEntrypointInvocation,
}));

vi.mock("./entrypoints.js", () => ({
  resolveExternalCliEntrypoint: mocks.resolveExternalCliEntrypoint,
}));

function mockExternalCliOutput(input: {
  stdout: string;
  stderr?: string;
  exitCode?: number;
}): void {
  mocks.spawnProcess.mockImplementationOnce(() => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();

    process.nextTick(() => {
      if (input.stdout.length > 0) {
        child.stdout.emit("data", Buffer.from(input.stdout));
      }
      if (input.stderr && input.stderr.length > 0) {
        child.stderr.emit("data", Buffer.from(input.stderr));
      }
      child.emit("close", input.exitCode ?? 0);
    });

    return child;
  });
}

describe("external CLI", () => {
  it("bounds an unresponsive shutdown request and releases only its own CLI child", async () => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    mocks.spawnProcess.mockReturnValueOnce(child);
    try {
      const result = expect(
        runExternalCliJsonCommand(["daemon", "stop", "--host", "127.0.0.1:6788", "--json"], {
          timeoutMs: 10000,
        }),
      ).rejects.toThrow("shutdown request did not complete");
      await vi.advanceTimersByTimeAsync(10000);
      await result;
      expect(child.kill).toHaveBeenCalledTimes(1);
      expect(child.stdout.destroyed).toBe(true);
      expect(child.stderr.destroyed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it("runs text commands through an isolated CLI process", async () => {
    mockExternalCliOutput({ stdout: "daemon running\n" });

    await expect(runExternalCliTextCommand(["daemon", "status"])).resolves.toBe("daemon running");

    expect(mocks.createNodeEntrypointInvocation).toHaveBeenCalledWith({
      entrypoint: { entryPath: "cli.js", execArgv: [] },
      argvMode: "node-script",
      args: ["daemon", "status"],
      baseEnv: process.env,
    });
    expect(mocks.spawnProcess).toHaveBeenCalledWith(
      "node",
      ["runner.js", "node-script", "cli.js"],
      {
        envMode: "internal",
        env: { PASEO_NODE_ENV: "production" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  });

  it("parses JSON output from an isolated CLI process", async () => {
    mockExternalCliOutput({ stdout: '{"localDaemon":"running"}\n' });

    await expect(runExternalCliJsonCommand(["daemon", "status", "--json"])).resolves.toEqual({
      localDaemon: "running",
    });
  });
});
