import type { ChildProcess } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn(() => ({ on: vi.fn(), unref: vi.fn() }));

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...(args as [])),
}));

const { killProcessTree } = await import("./process-tree.js");

interface FakeChild {
  pid: number | undefined;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill: ReturnType<typeof vi.fn>;
}

function fakeChild(overrides: Partial<FakeChild> = {}): FakeChild {
  return {
    pid: 4321,
    exitCode: null,
    signalCode: null,
    kill: vi.fn(),
    ...overrides,
  };
}

function spawnedCommands(): string[] {
  return spawnMock.mock.calls.map((call) => (call as unknown as [string])[0]);
}

describe("killProcessTree", () => {
  beforeEach(() => {
    spawnMock.mockClear();
  });

  it.runIf(process.platform === "win32")(
    "does not taskkill a pid whose child already exited",
    () => {
      // Windows recycles pids, and this taskkill is detached and fire-and-forget:
      // aimed at a pid we no longer own it would take an unrelated tree down with
      // /T /F, silently. Nothing may be spawned once the child is gone.
      const child = fakeChild({ exitCode: 0 });

      killProcessTree(child as unknown as ChildProcess);

      expect(spawnedCommands()).not.toContain("taskkill");
      expect(child.kill).not.toHaveBeenCalled();
    },
  );

  it.runIf(process.platform === "win32")("treats a signalled child as gone too", () => {
    const child = fakeChild({ exitCode: null, signalCode: "SIGTERM" });

    killProcessTree(child as unknown as ChildProcess);

    expect(spawnedCommands()).not.toContain("taskkill");
    expect(child.kill).not.toHaveBeenCalled();
  });

  it.runIf(process.platform === "win32")("still reaches a live child's whole tree", () => {
    const child = fakeChild();

    killProcessTree(child as unknown as ChildProcess);

    expect(spawnMock).toHaveBeenCalledWith(
      "taskkill",
      ["/pid", "4321", "/T", "/F"],
      expect.objectContaining({ detached: true }),
    );
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it.skipIf(process.platform === "win32")("signals directly off Windows", () => {
    const child = fakeChild();

    killProcessTree(child as unknown as ChildProcess);

    // No process groups to address here, and no pid-reuse exposure: the signal
    // goes to the handle rather than to a number.
    expect(spawnedCommands()).not.toContain("taskkill");
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("falls back to a direct signal when the child has no pid", () => {
    const child = fakeChild({ pid: undefined });

    killProcessTree(child as unknown as ChildProcess);

    expect(spawnedCommands()).not.toContain("taskkill");
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });
});
