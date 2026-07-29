import { EventEmitter } from "node:events";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  DEFAULT_MAX_DOTNET_PROCESSES,
  DotnetProcessLimitError,
  DotnetProcessRegistry,
} from "./dotnet-process-registry.js";

/**
 * The properties this file exists to hold, in the order they matter:
 *
 *  1. The cap is never exceeded, under any sequence of spawns, exits and releases.
 *  2. Nothing is orphaned. Every process that starts is either released, reaped on its own
 *     exit, or swept by `killAll`, and the sweep kills *trees*.
 *  3. A slot is always given back. Crashes, double releases and spawn failures must not
 *     leak capacity, because a leaked slot silently disables the feature forever.
 *  4. MSBuild node reuse is off on every spawn, since that is what produced the resident
 *     `dotnet` processes in the first place and no call site should be able to forget it.
 */

class FakeChild extends EventEmitter {
  readonly pid: number;
  killed = false;

  constructor(pid: number) {
    super();
    this.pid = pid;
  }

  /** What a real child does when the OS reaps it. */
  simulateExit(code = 0): void {
    this.emit("exit", code, null);
  }

  simulateSpawnError(): void {
    this.emit("error", new Error("spawn ENOENT"));
  }
}

function createLogger() {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => logger),
  };
  return logger;
}

interface Harness {
  registry: DotnetProcessRegistry;
  children: FakeChild[];
  killed: FakeChild[];
  spawnCalls: { command: string; args: string[]; options: SpawnOptions }[];
}

function createHarness(options?: { maxProcesses?: number }): Harness {
  const children: FakeChild[] = [];
  const killed: FakeChild[] = [];
  const spawnCalls: { command: string; args: string[]; options: SpawnOptions }[] = [];
  let nextPid = 1000;

  const registry = new DotnetProcessRegistry({
    logger: createLogger() as never,
    ...(options?.maxProcesses === undefined ? {} : { maxProcesses: options.maxProcesses }),
    spawn: ((command: string, args: string[], spawnOptions: SpawnOptions) => {
      spawnCalls.push({ command, args, options: spawnOptions });
      const child = new FakeChild((nextPid += 1));
      children.push(child);
      return child as unknown as ChildProcess;
    }) as never,
    killTree: ((child: ChildProcess) => {
      const fake = child as unknown as FakeChild;
      fake.killed = true;
      killed.push(fake);
    }) as never,
    now: () => 1_700_000_000_000,
  });

  return { registry, children, killed, spawnCalls };
}

function start(harness: Harness, label: string) {
  return harness.registry.spawnTracked({
    command: "dotnet",
    args: ["probe.dll"],
    options: { cwd: "/repo" },
    kind: "solution-sidecar",
    label,
  });
}

/** Kept out of `expect(...)` so the arrow does not push nesting past the lint cap. */
function startResult(harness: Harness, label: string): "started" | "refused" {
  try {
    start(harness, label);
    return "started";
  } catch (error) {
    if (error instanceof DotnetProcessLimitError) {
      return "refused";
    }
    throw error;
  }
}

describe("DotnetProcessRegistry", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness({ maxProcesses: 2 });
  });

  // --- the cap ---

  test("cap: allows exactly the configured number of processes and then refuses", () => {
    start(harness, "a");
    start(harness, "b");

    expect(harness.registry.size).toBe(2);
    expect(harness.registry.hasCapacity()).toBe(false);
    expect(startResult(harness, "c")).toBe("refused");
    // The refusal must happen *before* the spawn, or the cap is decoration.
    expect(harness.spawnCalls).toHaveLength(2);
  });

  test("cap: reports the limit and the running count on the refusal", () => {
    start(harness, "a");
    start(harness, "b");

    let captured: DotnetProcessLimitError | null = null;
    try {
      start(harness, "c");
    } catch (error) {
      captured = error as DotnetProcessLimitError;
    }

    expect(captured).toBeInstanceOf(DotnetProcessLimitError);
    expect(captured?.limit).toBe(2);
    expect(captured?.running).toBe(2);
  });

  test("cap: never exceeded across an interleaved run of spawns, exits and releases", () => {
    const live: { release: () => void }[] = [];
    let peak = 0;
    let refusals = 0;

    // A deliberately awkward sequence: spawn twice as often as we free, mixing the two
    // ways a slot comes back (an owner releasing, and a process dying on its own).
    for (let step = 0; step < 60; step += 1) {
      try {
        live.push(start(harness, `w${step}`));
      } catch (error) {
        expect(error).toBeInstanceOf(DotnetProcessLimitError);
        refusals += 1;
      }
      peak = Math.max(peak, harness.registry.size);

      if (step % 2 === 1) {
        if (step % 4 === 1) {
          live.shift()?.release();
        } else {
          // Died on its own, with nobody calling release.
          harness.children.find((child) => !child.killed)?.simulateExit(1);
        }
      }
      peak = Math.max(peak, harness.registry.size);
    }

    expect(peak).toBeLessThanOrEqual(2);
    expect(refusals).toBeGreaterThan(0);
  });

  test("cap: a raised limit takes effect on the next spawn", () => {
    start(harness, "a");
    start(harness, "b");
    expect(startResult(harness, "c")).toBe("refused");

    harness.registry.setLimit(3);

    expect(startResult(harness, "c")).toBe("started");
    expect(harness.registry.size).toBe(3);
  });

  test("cap: a lowered limit refuses new spawns without killing what is already warm", () => {
    const first = start(harness, "a");
    start(harness, "b");

    harness.registry.setLimit(1);

    expect(harness.registry.size).toBe(2);
    expect(harness.killed).toHaveLength(0);
    expect(startResult(harness, "c")).toBe("refused");

    // Down to one running, which is the new limit, so a spawn is still refused.
    first.release();
    expect(harness.registry.size).toBe(1);
    expect(startResult(harness, "d")).toBe("refused");
  });

  test("cap: a limit below one is clamped rather than disabling the feature outright", () => {
    const clamped = createHarness({ maxProcesses: 0 });

    expect(clamped.registry.limit).toBe(1);
    expect(startResult(clamped, "a")).toBe("started");
  });

  test("cap: defaults to the documented ceiling when no limit is configured", () => {
    expect(createHarness().registry.limit).toBe(DEFAULT_MAX_DOTNET_PROCESSES);
  });

  // --- not orphaning processes ---

  test("orphans: release kills the process tree, not just the process", () => {
    const tracked = start(harness, "a");
    tracked.release();

    expect(harness.killed).toHaveLength(1);
    expect(harness.killed[0]).toBe(harness.children[0]);
    expect(harness.registry.size).toBe(0);
  });

  test("orphans: killAll sweeps every tracked process, including unreleased handles", () => {
    start(harness, "a");
    start(harness, "b");

    harness.registry.killAll();

    expect(harness.killed).toHaveLength(2);
    expect(harness.registry.size).toBe(0);
  });

  test("orphans: killAll does not re-kill a process that already exited", () => {
    start(harness, "a");
    start(harness, "b");
    harness.children[0]?.simulateExit();

    harness.registry.killAll();

    expect(harness.killed).toEqual([harness.children[1]]);
  });

  test("orphans: killAll after a release is a no-op rather than a double kill", () => {
    start(harness, "a").release();

    harness.registry.killAll();

    expect(harness.killed).toHaveLength(1);
  });

  test("orphans: nothing survives a spawn-refuse-sweep cycle", () => {
    start(harness, "a");
    start(harness, "b");
    expect(startResult(harness, "c")).toBe("refused");

    harness.registry.killAll();

    expect(harness.registry.running()).toEqual([]);
    expect(harness.killed).toHaveLength(2);
    // Every process the registry ever spawned is accounted for.
    expect(harness.children.every((child) => child.killed)).toBe(true);
  });

  // --- giving the slot back ---

  test("slots: a process that exits on its own frees its slot", () => {
    start(harness, "a");
    start(harness, "b");
    expect(harness.registry.hasCapacity()).toBe(false);

    harness.children[0]?.simulateExit(1);

    expect(harness.registry.size).toBe(1);
    expect(startResult(harness, "c")).toBe("started");
  });

  test("slots: a process that fails to spawn frees its slot", () => {
    start(harness, "a");
    start(harness, "b");

    harness.children[0]?.simulateSpawnError();

    expect(harness.registry.size).toBe(1);
    expect(startResult(harness, "c")).toBe("started");
  });

  test("slots: release is idempotent and does not free a slot twice", () => {
    const tracked = start(harness, "a");
    start(harness, "b");

    tracked.release();
    tracked.release();
    tracked.release();

    expect(harness.killed).toHaveLength(1);
    expect(harness.registry.size).toBe(1);
    // Only one slot came back, so exactly one new process fits.
    expect(startResult(harness, "c")).toBe("started");
    expect(startResult(harness, "d")).toBe("refused");
  });

  test("slots: releasing after the process already exited does not double-free", () => {
    const tracked = start(harness, "a");
    start(harness, "b");

    harness.children[0]?.simulateExit();
    tracked.release();

    expect(harness.registry.size).toBe(1);
    expect(harness.killed).toHaveLength(0);
    expect(startResult(harness, "c")).toBe("started");
    expect(startResult(harness, "d")).toBe("refused");
  });

  test("slots: repeated crash-and-restart never leaks capacity", () => {
    for (let round = 0; round < 50; round += 1) {
      const tracked = start(harness, `crash-${round}`);
      expect(harness.registry.size).toBe(1);
      // Half the rounds die on their own, half are stopped by their owner.
      if (round % 2 === 0) {
        harness.children.at(-1)?.simulateExit(139);
      } else {
        tracked.release();
      }
      expect(harness.registry.size).toBe(0);
    }
  });

  // --- what every spawn carries ---

  test("env: MSBuild node reuse is off, so workers exit with the work that started them", () => {
    start(harness, "a");

    expect(harness.spawnCalls[0]?.options.env).toMatchObject({
      MSBUILDDISABLENODEREUSE: "1",
      DOTNET_CLI_TELEMETRY_OPTOUT: "1",
      DOTNET_NOLOGO: "1",
    });
  });

  test("env: the caller's own environment and options survive the merge", () => {
    harness.registry.spawnTracked({
      command: "dotnet",
      args: ["server.dll", "--stdio"],
      options: { cwd: "/repo", env: { PATH: "/usr/bin", CUSTOM: "kept" } },
      kind: "language-server",
      label: "csharp",
    });

    const call = harness.spawnCalls[0];
    expect(call?.command).toBe("dotnet");
    expect(call?.args).toEqual(["server.dll", "--stdio"]);
    expect(call?.options.cwd).toBe("/repo");
    expect(call?.options.env).toMatchObject({ PATH: "/usr/bin", CUSTOM: "kept" });
  });

  test("env: a caller cannot switch node reuse back on", () => {
    harness.registry.spawnTracked({
      command: "dotnet",
      args: [],
      options: { env: { MSBUILDDISABLENODEREUSE: "0" } },
      kind: "language-server",
      label: "csharp",
    });

    expect(harness.spawnCalls[0]?.options.env).toMatchObject({
      MSBUILDDISABLENODEREUSE: "1",
    });
  });

  // --- what is running ---

  test("report: names each tracked process with its kind, owner and pid", () => {
    start(harness, "/repo/App.sln");
    harness.registry.spawnTracked({
      command: "csharp-ls",
      args: [],
      options: {},
      kind: "language-server",
      label: "/repo",
    });

    expect(harness.registry.running()).toEqual([
      {
        pid: harness.children[0]?.pid,
        kind: "solution-sidecar",
        label: "/repo/App.sln",
        startedAt: 1_700_000_000_000,
      },
      {
        pid: harness.children[1]?.pid,
        kind: "language-server",
        label: "/repo",
        startedAt: 1_700_000_000_000,
      },
    ]);
  });

  test("report: is a copy, so a caller cannot mutate the registry through it", () => {
    start(harness, "a");

    const report = harness.registry.running();
    const first = report[0];
    if (first) {
      first.label = "tampered";
    }

    expect(harness.registry.running()[0]?.label).toBe("a");
  });
});
