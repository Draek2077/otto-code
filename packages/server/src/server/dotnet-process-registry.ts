import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import type { Logger } from "pino";
import { killProcessTree, MSBUILD_ENV } from "./process-tree.js";

/**
 * The one door every .NET child process goes through.
 *
 * Nothing in Otto may call `spawn` for a `dotnet`-backed process directly. Two subsystems
 * start them - the C# language server and the solution sidecar - and each used to own its
 * own pool with its own cap, which meant the machine's actual .NET process count was the
 * sum of two numbers neither pool could see. Add MSBuild worker nodes, which are children
 * of those processes rather than of ours, and the honest answer to "how many dotnet
 * processes has Otto started" was: nobody knew.
 *
 * This registry makes that answerable and boundable:
 *
 *  - **A hard cap, checked before the spawn.** Over the cap is a refusal, not a queue and
 *    not a best-effort eviction. A caller that cannot get a slot reports the feature
 *    unavailable, exactly as it does on a host with no SDK.
 *  - **Every process is tracked from birth.** Registration cannot be forgotten, because
 *    spawning and registering are the same call.
 *  - **Release kills the tree.** `dotnet` processes have children of their own; signalling
 *    only the process we hold is what left orphans behind.
 *  - **`killAll` is a real sweep.** On shutdown anything still alive is killed by tree,
 *    including processes whose owner leaked its handle.
 *
 * No timers live here, and every decision reads injected collaborators, so the whole
 * lifecycle is testable without spawning a real runtime.
 */

export type DotnetProcessKind = "language-server" | "solution-sidecar";

export class DotnetProcessLimitError extends Error {
  readonly limit: number;
  readonly running: number;

  constructor(limit: number, running: number) {
    super(
      `Otto already has ${running} .NET processes running and the limit is ${limit}. ` +
        `Close a workspace or raise the limit to start another.`,
    );
    this.name = "DotnetProcessLimitError";
    this.limit = limit;
    this.running = running;
  }
}

export interface DotnetProcessRecord {
  pid: number | undefined;
  kind: DotnetProcessKind;
  /** Human-readable owner, e.g. the workspace root or solution path. For diagnostics only. */
  label: string;
  startedAt: number;
}

export interface TrackedDotnetProcess {
  child: ChildProcess;
  /** Kill the tree and give the slot back. Idempotent. */
  release(): void;
}

export interface DotnetProcessRegistryOptions {
  logger: Logger;
  /**
   * Ceiling across every kind. Two solution sidecars plus a C# language server for each of
   * a couple of workspaces is already four resident MSBuild-sized processes; past that a
   * developer machine notices, which is the complaint this exists to answer.
   */
  maxProcesses?: number;
  /** Test seams. Nothing in production passes these. */
  spawn?: typeof nodeSpawn;
  killTree?: typeof killProcessTree;
  now?: () => number;
}

export const DEFAULT_MAX_DOTNET_PROCESSES = 4;

interface Entry {
  child: ChildProcess;
  record: DotnetProcessRecord;
  released: boolean;
}

export class DotnetProcessRegistry {
  private readonly logger: Logger;
  private readonly spawn: typeof nodeSpawn;
  private readonly killTree: typeof killProcessTree;
  private readonly now: () => number;
  private maxProcesses: number;
  private readonly entries = new Set<Entry>();

  constructor(options: DotnetProcessRegistryOptions) {
    this.logger = options.logger.child({ subsystem: "dotnet-processes" });
    this.spawn = options.spawn ?? nodeSpawn;
    this.killTree = options.killTree ?? killProcessTree;
    this.now = options.now ?? Date.now;
    this.maxProcesses = normalizeLimit(options.maxProcesses);
  }

  get limit(): number {
    return this.maxProcesses;
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * Lowering the limit does not kill anything already running: a process holding a warm
   * project model is expensive to rebuild, and the caller that would be killed has done
   * nothing wrong. The new limit binds the next spawn, and the count drains naturally as
   * pools reap their idle members.
   */
  setLimit(maxProcesses: number): void {
    this.maxProcesses = normalizeLimit(maxProcesses);
  }

  /** A copy per row, so a caller inspecting the registry cannot mutate what it tracks. */
  running(): DotnetProcessRecord[] {
    const rows: DotnetProcessRecord[] = [];
    for (const entry of this.entries) {
      rows.push({
        pid: entry.record.pid,
        kind: entry.record.kind,
        label: entry.record.label,
        startedAt: entry.record.startedAt,
      });
    }
    return rows;
  }

  hasCapacity(): boolean {
    return this.entries.size < this.maxProcesses;
  }

  /**
   * Spawn a .NET process under the cap. Throws {@link DotnetProcessLimitError} rather than
   * queueing: a caller waiting on a slot would hold a request open behind work that may
   * take minutes to finish, and "not right now" is an answer both callers can render.
   *
   * `MSBUILD_ENV` is applied here rather than at each call site so no future caller can
   * forget it and reintroduce resident MSBuild worker nodes.
   */
  spawnTracked(input: {
    command: string;
    args: readonly string[];
    options: SpawnOptions;
    kind: DotnetProcessKind;
    label: string;
  }): TrackedDotnetProcess {
    if (!this.hasCapacity()) {
      this.logger.warn(
        {
          kind: input.kind,
          label: input.label,
          running: this.entries.size,
          limit: this.maxProcesses,
        },
        "refused to start a .NET process: at the configured limit",
      );
      throw new DotnetProcessLimitError(this.maxProcesses, this.entries.size);
    }

    const child = this.spawn(input.command, [...input.args], {
      ...input.options,
      env: { ...(input.options.env ?? process.env), ...MSBUILD_ENV },
    });

    const entry: Entry = {
      child,
      record: {
        pid: child.pid,
        kind: input.kind,
        label: input.label,
        startedAt: this.now(),
      },
      released: false,
    };
    this.entries.add(entry);

    // A process that dies on its own must free its slot, or a few crashes would exhaust the
    // cap and the feature would go permanently unavailable with nothing running.
    const forget = (): void => {
      entry.released = true;
      this.entries.delete(entry);
    };
    child.once("exit", forget);
    child.once("error", forget);

    this.logger.debug(
      { kind: input.kind, label: input.label, pid: child.pid, running: this.entries.size },
      "started a .NET process",
    );

    return {
      child,
      release: () => {
        if (entry.released) {
          return;
        }
        entry.released = true;
        this.entries.delete(entry);
        this.killTree(child);
      },
    };
  }

  /**
   * Kill everything still tracked. The shutdown sweep, and the backstop for an owner that
   * dropped its handle without releasing.
   */
  killAll(): void {
    const entries = [...this.entries];
    this.entries.clear();
    for (const entry of entries) {
      if (entry.released) {
        continue;
      }
      entry.released = true;
      this.killTree(entry.child);
    }
    if (entries.length > 0) {
      this.logger.debug({ count: entries.length }, "killed all tracked .NET processes");
    }
  }
}

/**
 * The process table is a machine-global resource, and the cap is only a cap if both
 * subsystems that start .NET processes count against the same one. A module-level instance
 * is the honest model for that: threading a handle through the LSP pool, the solution
 * provider and their two connection layers would let a future call site quietly opt out by
 * not being given one.
 *
 * Tests construct `DotnetProcessRegistry` directly instead of touching this.
 */
let shared: DotnetProcessRegistry | null = null;

export function sharedDotnetProcessRegistry(logger: Logger): DotnetProcessRegistry {
  shared ??= new DotnetProcessRegistry({ logger });
  return shared;
}

/** Applies the host's configured ceiling. Safe to call before anything has spawned. */
export function configureSharedDotnetProcessRegistry(input: {
  logger: Logger;
  maxProcesses: number;
}): void {
  sharedDotnetProcessRegistry(input.logger).setLimit(input.maxProcesses);
}

/** Shutdown sweep: nothing Otto started outlives Otto. */
export function killAllSharedDotnetProcesses(): void {
  shared?.killAll();
}

export function resetSharedDotnetProcessRegistryForTests(): void {
  shared?.killAll();
  shared = null;
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_MAX_DOTNET_PROCESSES;
  }
  // At least one, or the feature could never run at all and every failure would look like
  // a limit breach rather than a misconfiguration.
  return Math.max(1, Math.trunc(value));
}
