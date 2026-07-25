import { dirname } from "node:path";
import type { Logger } from "pino";
import { documentKey } from "../../lsp/uri.js";
import { resolveDotnetRuntime } from "./bootstrap.js";
import { DotnetProbe, ProbeUnavailableError } from "./probe.js";

/**
 * Live sidecars, keyed by (workspace × solution).
 *
 * The lifecycle deliberately mirrors `lsp/pool.ts` — lazy spawn, idle reap, a hard cap, capped
 * backoff after a crash — because the cost profile is the same: a process holding an MSBuild
 * project model, on the same machine as the agents. What it does **not** mirror is that
 * subsystem's defect, where the reaping methods existed with no production caller and idle
 * servers therefore never exited. `SolutionService.reapIdle` is called on an interval by the
 * daemon and `stopAll` on shutdown, and both are covered by a test that asserts the wiring rather
 * than the method.
 *
 * Keyed per solution, not per workspace, because a warm `ProjectCollection` is scoped to one
 * solution's import graph; sharing it across two solutions in one repo would let a change in one
 * invalidate the other's evaluations.
 *
 * No timers live here. Every decision reads an injected clock, which is what makes the lifecycle
 * testable without waiting on wall time.
 */

export interface DotnetProbePoolLimits {
  maxRunningProbes: number;
  idleMs: number;
  crashBackoffMs: number;
  maxCrashBackoffMs: number;
  handshakeTimeoutMs: number;
  requestTimeoutMs: number;
}

export const DEFAULT_PROBE_LIMITS: DotnetProbePoolLimits = {
  maxRunningProbes: 2,
  idleMs: 10 * 60_000,
  crashBackoffMs: 2000,
  maxCrashBackoffMs: 60_000,
  // MSBuild's first SDK resolution dominates a cold start; 60 s is the same allowance the LSP
  // pool gives a language server's initialize.
  handshakeTimeoutMs: 60_000,
  // Evaluating a large project is the long tail here, and it is bounded by disk, not by network.
  requestTimeoutMs: 60_000,
};

export interface DotnetProbePoolOptions {
  logger: Logger;
  limits?: Partial<DotnetProbePoolLimits>;
  now?: () => number;
}

export interface ProbeKey {
  /**
   * Workspace root — what `stopWorkspace` matches on. Deliberately not derived from the
   * solution's directory: a solution can live in a subdirectory, and a closed workspace must not
   * be left holding a live process because the two paths did not compare equal.
   */
  root: string;
  /** Absolute path of the solution this probe is warm for. */
  solutionPath: string;
}

export interface RunningProbe {
  root: string;
  solutionPath: string;
  sdkVersion: string | null;
  startedAt: number;
  uptimeMs: number;
  lastUsedAt: number;
}

interface StartingEntry {
  status: "starting";
  key: ProbeKey;
  pending: Promise<DotnetProbe>;
}

interface RunningEntry {
  status: "running";
  key: ProbeKey;
  probe: DotnetProbe;
  startedAt: number;
  lastUsedAt: number;
}

interface BackoffEntry {
  status: "backoff";
  key: ProbeKey;
  nextRetryAt: number;
}

type PoolEntry = StartingEntry | RunningEntry | BackoffEntry;

export class DotnetProbePool {
  private readonly logger: Logger;
  private limits: DotnetProbePoolLimits;
  private readonly now: () => number;
  private readonly entries = new Map<string, PoolEntry>();
  /** Consecutive crashes per key; survives restart so the backoff can grow. */
  private readonly failures = new Map<string, number>();
  /** Keys we are deliberately stopping, so their exit is not read as a crash. */
  private readonly stopping = new Set<string>();

  constructor(options: DotnetProbePoolOptions) {
    this.logger = options.logger.child({ subsystem: "solution-model" });
    this.limits = { ...DEFAULT_PROBE_LIMITS, ...options.limits };
    this.now = options.now ?? Date.now;
  }

  setLimits(limits: Partial<DotnetProbePoolLimits>): void {
    this.limits = { ...this.limits, ...limits };
  }

  async acquire(key: ProbeKey): Promise<DotnetProbe> {
    const mapKey = keyOf(key);
    const existing = this.entries.get(mapKey);

    if (existing?.status === "running") {
      if (existing.probe.isAlive) {
        existing.lastUsedAt = this.now();
        return existing.probe;
      }
      this.entries.delete(mapKey);
    } else if (existing?.status === "starting") {
      return existing.pending;
    } else if (existing?.status === "backoff") {
      const remaining = existing.nextRetryAt - this.now();
      if (remaining > 0) {
        throw new ProbeUnavailableError(
          `The .NET solution sidecar crashed; retrying in ${Math.ceil(remaining / 1000)}s`,
        );
      }
      this.entries.delete(mapKey);
    }

    // Nothing may be awaited between the lookup above and this write, or two concurrent callers
    // both miss and spawn a second process for the same solution.
    const pending = this.start(mapKey, key);
    this.entries.set(mapKey, { status: "starting", key, pending });
    return pending;
  }

  running(): RunningProbe[] {
    const now = this.now();
    const rows: RunningProbe[] = [];
    for (const entry of this.entries.values()) {
      if (entry.status === "running") {
        rows.push({
          root: entry.key.root,
          solutionPath: entry.key.solutionPath,
          sdkVersion: entry.probe.sdkVersion,
          startedAt: entry.startedAt,
          uptimeMs: now - entry.startedAt,
          lastUsedAt: entry.lastUsedAt,
        });
      }
    }
    return rows;
  }

  reapIdle(): void {
    const now = this.now();
    for (const [mapKey, entry] of Array.from(this.entries)) {
      if (entry.status === "running" && now - entry.lastUsedAt > this.limits.idleMs) {
        this.stopEntry(mapKey);
      }
    }
  }

  stopSolution(key: ProbeKey): void {
    this.stopEntry(keyOf(key));
  }

  stopWorkspace(root: string): void {
    const rootKey = documentKey(root);
    for (const [mapKey, entry] of Array.from(this.entries)) {
      if (documentKey(entry.key.root) === rootKey) {
        this.stopEntry(mapKey);
      }
    }
  }

  stopAll(): void {
    for (const mapKey of Array.from(this.entries.keys())) {
      this.stopEntry(mapKey);
    }
  }

  private async start(mapKey: string, key: ProbeKey): Promise<DotnetProbe> {
    this.enforceRunningCap(mapKey);

    const bootstrap = await resolveDotnetRuntime();
    if (bootstrap.status === "unavailable") {
      // Absence is a fact about this machine, not a failure to back off from — there is nothing
      // to retry, and a backoff entry would only delay the same answer.
      this.entries.delete(mapKey);
      throw new ProbeUnavailableError(bootstrap.reason);
    }

    try {
      const probe = await DotnetProbe.start({
        runtime: bootstrap.runtime,
        logger: this.logger,
        // The solution's own directory, not the workspace root: MSBuild resolves
        // `Directory.Build.props` and `global.json` by walking up from where it starts, so
        // starting anywhere else would silently read a different configuration than
        // `dotnet build` does.
        cwd: dirname(key.solutionPath),
        handshakeTimeoutMs: this.limits.handshakeTimeoutMs,
        requestTimeoutMs: this.limits.requestTimeoutMs,
        onExit: () => this.handleExit(mapKey, key),
      });
      const startedAt = this.now();
      this.entries.set(mapKey, { status: "running", key, probe, startedAt, lastUsedAt: startedAt });
      this.failures.delete(mapKey);
      return probe;
    } catch (error) {
      this.recordCrash(mapKey, key);
      throw error;
    }
  }

  private handleExit(mapKey: string, key: ProbeKey): void {
    if (this.stopping.has(mapKey)) {
      this.stopping.delete(mapKey);
      return;
    }
    const entry = this.entries.get(mapKey);
    if (entry === undefined || entry.status !== "running") {
      // Died mid-handshake; `start` records the failure so the backoff is not counted twice.
      return;
    }
    this.recordCrash(mapKey, key);
  }

  private recordCrash(mapKey: string, key: ProbeKey): void {
    const failures = (this.failures.get(mapKey) ?? 0) + 1;
    this.failures.set(mapKey, failures);
    const backoff = Math.min(
      this.limits.crashBackoffMs * 2 ** (failures - 1),
      this.limits.maxCrashBackoffMs,
    );
    this.entries.set(mapKey, { status: "backoff", key, nextRetryAt: this.now() + backoff });
    this.logger.warn(
      { solutionPath: key.solutionPath, failures, backoffMs: backoff },
      "solution sidecar crashed; backing off",
    );
  }

  /** Least-recently-used eviction, so the cap is a cap rather than a refusal. */
  private enforceRunningCap(incomingKey: string): void {
    const running = [...this.entries]
      .filter(([mapKey, entry]) => entry.status === "running" && mapKey !== incomingKey)
      .map(([mapKey, entry]) => ({ mapKey, lastUsedAt: (entry as RunningEntry).lastUsedAt }))
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt);

    let overBy = running.length - (this.limits.maxRunningProbes - 1);
    for (const candidate of running) {
      if (overBy <= 0) {
        break;
      }
      this.stopEntry(candidate.mapKey);
      overBy -= 1;
    }
  }

  private stopEntry(mapKey: string): void {
    const entry = this.entries.get(mapKey);
    if (entry === undefined) {
      return;
    }
    this.entries.delete(mapKey);
    if (entry.status !== "running") {
      return;
    }
    this.stopping.add(mapKey);
    entry.probe.stop();
    this.logger.debug({ solutionPath: entry.key.solutionPath }, "solution sidecar stopped");
  }
}

/**
 * Case-folded through `documentKey`, because `C:/Repo/App.sln` and `c:/repo/App.sln` are one
 * process on Windows and two distinct strings everywhere else.
 */
function keyOf(key: ProbeKey): string {
  return `${documentKey(key.root)}\u0000${documentKey(key.solutionPath)}`;
}
