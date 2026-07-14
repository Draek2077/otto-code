import { randomBytes } from "node:crypto";

import { type Run, type RunPlan, isTerminalRunStatus } from "@otto-code/protocol/orchestration";

import type { RunStore } from "./run-store.js";
import type { ActivityIncrementFn } from "../activity-stats/activity-stats-store.js";
import {
  DEFAULT_RUN_CAPS,
  type OrchestrationLogger,
  type RunEngineAwaitResult,
  type RunEngineCaps,
  type RunEngineGateDecision,
  type RunEnginePort,
  type RunEngineSpawnInput,
  type RunEngineSpawnResult,
  buildRunFromPlan,
  executeRun,
} from "./run-engine.js";

// The daemon-integration half of the engine port: the spawn/await/role-resolve
// seams. Supplied by the tool layer (otto-tools.ts) where the real
// createAgentCommand / waitForAgentEvent / active-team resolution live. The
// RunService supplies the other half (gate resolution + emit) so those lifecycle
// concerns stay here, testable with a fake spawn port.
export interface RunSpawnPort {
  resolveRole(role: string): Promise<{ personalityId: string } | null>;
  spawn(input: RunEngineSpawnInput): Promise<RunEngineSpawnResult>;
  awaitAgent(input: { agentId: string; signal: AbortSignal }): Promise<RunEngineAwaitResult>;
}

export type RunServiceLogger = OrchestrationLogger;

export interface StartRunInput {
  plan: RunPlan;
  spawnPort: RunSpawnPort;
  conductorAgentId?: string;
  cwd?: string;
  workspaceId?: string;
  teamId?: string;
  teamName?: string;
}

export interface StartRunResult {
  /** The initial run projection (status pending/running), returned immediately. */
  run: Run;
  /** Resolves with the terminal run when execution settles. Never rejects. */
  settled: Promise<Run>;
}

export type RunChangeListener = (run: Run) => void;
export type RunRemoveListener = (runIds: string[]) => void;

/**
 * Generates a human-readable summary of a terminal run (via a Writer). Returns
 * null when it can't produce one. Injected so the RunService stays free of
 * provider/agent wiring and is unit-testable with a fake.
 */
export type RunSummarizer = (run: Run) => Promise<string | null>;

function generateRunId(): string {
  return `run_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}

/**
 * Owns orchestration runs: persistence (via RunStore), the in-memory live map,
 * the change broadcast (for the snapshot session), gate resolution, and driving
 * the engine. Deliberately does NOT know how to spawn agents — that comes in as
 * a RunSpawnPort, so this class is unit-testable and the daemon wiring stays in
 * the tool layer.
 */
export class RunService {
  private readonly store: RunStore;
  private readonly caps: RunEngineCaps;
  private readonly logger: RunServiceLogger;
  private readonly clock: () => string;
  private readonly runs = new Map<string, Run>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly pendingGates = new Map<string, (decision: RunEngineGateDecision) => void>();
  // A decision that arrived before the engine formally registered its gate wait
  // (emit(paused) awaits a disk write before awaitGate runs, so a fast UI
  // response can land in that window). Applied when awaitGate registers.
  private readonly bufferedGateDecisions = new Map<string, RunEngineGateDecision>();
  private readonly changeListeners = new Set<RunChangeListener>();
  private readonly removeListeners = new Set<RunRemoveListener>();
  private readonly summarize: RunSummarizer | undefined;

  private readonly onActivity: ActivityIncrementFn | undefined;

  constructor(options: {
    store: RunStore;
    logger: RunServiceLogger;
    caps?: RunEngineCaps;
    now?: () => string;
    summarize?: RunSummarizer;
    onActivity?: ActivityIncrementFn;
  }) {
    this.store = options.store;
    this.logger = options.logger;
    this.caps = options.caps ?? DEFAULT_RUN_CAPS;
    this.clock = options.now ?? (() => new Date().toISOString());
    this.summarize = options.summarize;
    this.onActivity = options.onActivity;
  }

  /** Load persisted runs into memory on startup. Marks orphaned in-flight runs. */
  async init(): Promise<void> {
    const persisted = await this.store.list();
    for (const run of persisted) {
      // A run that was mid-flight when the daemon stopped has no live engine
      // driving it anymore; mark it failed so it isn't shown as forever-running.
      if (run.status === "running" || run.status === "paused" || run.status === "pending") {
        const recovered: Run = {
          ...run,
          status: "failed",
          error: run.error ?? "Daemon restarted while this run was in flight.",
          updatedAt: this.clock(),
        };
        this.runs.set(recovered.id, recovered);
        await this.safeSave(recovered);
      } else {
        this.runs.set(run.id, run);
      }
    }
  }

  listRuns(): Run[] {
    return [...this.runs.values()].sort((a, b) =>
      (a.createdAt ?? "").localeCompare(b.createdAt ?? ""),
    );
  }

  getRun(id: string): Run | null {
    return this.runs.get(id) ?? null;
  }

  onChange(listener: RunChangeListener): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  onRemove(listener: RunRemoveListener): () => void {
    this.removeListeners.add(listener);
    return () => this.removeListeners.delete(listener);
  }

  /**
   * Delete every terminal (done/failed/canceled) run from memory and disk.
   * Active/paused runs are left untouched. Returns the deleted run ids.
   */
  async clearFinishedRuns(): Promise<string[]> {
    const finishedIds = [...this.runs.values()]
      .filter((run) => isTerminalRunStatus(run.status))
      .map((run) => run.id);
    for (const id of finishedIds) {
      this.runs.delete(id);
      await this.safeDelete(id);
    }
    if (finishedIds.length > 0) {
      for (const listener of this.removeListeners) {
        try {
          listener(finishedIds);
        } catch (error) {
          this.logger.error({ err: error, runIds: finishedIds }, "Run remove listener threw");
        }
      }
    }
    return finishedIds;
  }

  /** Build and start executing a run. Returns immediately; execution runs on. */
  startRun(input: StartRunInput): StartRunResult {
    const id = generateRunId();
    const run = buildRunFromPlan({
      plan: input.plan,
      id,
      now: this.clock(),
      ...(input.conductorAgentId ? { conductorAgentId: input.conductorAgentId } : {}),
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.teamId ? { teamId: input.teamId } : {}),
      ...(input.teamName ? { teamName: input.teamName } : {}),
    });
    this.runs.set(id, run);
    this.onActivity?.("runsOrchestrated");
    const controller = new AbortController();
    this.controllers.set(id, controller);
    // Snapshot the pending state for the caller BEFORE the engine mutates the
    // live object (executeRun flips it to "running" synchronously).
    const initialSnapshot = structuredClone(run);
    void this.persistAndEmit(run);

    const port: RunEnginePort = {
      resolveRole: input.spawnPort.resolveRole,
      spawn: input.spawnPort.spawn,
      awaitAgent: input.spawnPort.awaitAgent,
      awaitGate: (gate) => this.awaitGate(gate),
      emit: (updated) => this.persistAndEmit(updated),
      now: this.clock,
      logger: this.logger,
    };

    const settled = executeRun({
      run,
      plan: input.plan,
      caps: this.caps,
      signal: controller.signal,
      port,
    })
      .then((final) => {
        this.runs.set(final.id, final);
        return this.persistAndEmit(final).then(() => final);
      })
      .catch((error) => {
        this.logger.error({ err: error, runId: id }, "Run execution threw");
        const failed: Run = {
          ...run,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
          updatedAt: this.clock(),
        };
        this.runs.set(id, failed);
        return this.persistAndEmit(failed).then(() => failed);
      })
      .then((terminal) => {
        // Fire-and-forget: summarize AFTER the run settles so it never delays the
        // caller (start_run awaits `settled`); the summary lands via broadcast.
        void this.maybeSummarize(terminal);
        return terminal;
      })
      .finally(() => {
        this.controllers.delete(id);
        this.pendingGates.delete(id);
        this.bufferedGateDecisions.delete(id);
      });

    return { run: initialSnapshot, settled };
  }

  // Generate a Writer summary for a terminal run (done/failed/canceled) and land
  // it on the run via broadcast. Best-effort — a failed generation just marks the
  // summary status "failed" and is otherwise silent.
  private async maybeSummarize(run: Run): Promise<void> {
    if (!this.summarize || !isTerminalRunStatus(run.status)) {
      return;
    }
    await this.patchRun(run.id, { summaryStatus: "pending" });
    try {
      const summary = (await this.summarize(run))?.trim();
      await this.patchRun(
        run.id,
        summary ? { summary, summaryStatus: "ready" } : { summaryStatus: "failed" },
      );
    } catch (error) {
      this.logger.error({ err: error, runId: run.id }, "Run summary generation failed");
      await this.patchRun(run.id, { summaryStatus: "failed" });
    }
  }

  private async patchRun(runId: string, patch: Partial<Run>): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) {
      return;
    }
    await this.persistAndEmit({ ...run, ...patch, updatedAt: this.clock() });
  }

  /**
   * Resolve when a run first reaches a terminal state OR pauses at a gate —
   * whichever comes first — so the conductor can relay the outcome in one turn
   * without hanging on a human gate. Falls back to the latest projection after
   * `timeoutMs` (default 5 min) so a stuck child can't block the caller forever.
   */
  settleOrPause(input: { runId: string; settled: Promise<Run>; timeoutMs?: number }): Promise<Run> {
    const isRestingStatus = (run: Run | null): run is Run =>
      run !== null && (isTerminalRunStatus(run.status) || run.status === "paused");

    const current = this.getRun(input.runId);
    if (isRestingStatus(current)) {
      return Promise.resolve(current);
    }
    return new Promise<Run>((resolve) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (run: Run) => {
        if (done) {
          return;
        }
        done = true;
        unsubscribe();
        if (timer) {
          clearTimeout(timer);
        }
        // eslint-disable-next-line promise/no-multiple-resolved -- the `done` guard above makes finish idempotent; multiple callers (onChange, settled, re-check, timeout) funnel through it.
        resolve(run);
      };
      const unsubscribe = this.onChange((run) => {
        if (run.id === input.runId && run.status === "paused") {
          finish(run);
        }
      });
      void input.settled.then(finish);
      // Re-check in case it transitioned between the guard above and subscribing.
      const now = this.getRun(input.runId);
      if (isRestingStatus(now)) {
        finish(now);
        return;
      }
      timer = setTimeout(
        () => {
          finish(this.getRun(input.runId) ?? current ?? now!);
        },
        input.timeoutMs ?? 5 * 60 * 1000,
      );
    });
  }

  /**
   * Resolve a run's gate. Returns false only when the run isn't awaiting one. If
   * the engine hasn't registered its wait yet (the emit(paused)→awaitGate
   * window), the decision is buffered and applied the moment it does.
   */
  respondToGate(runId: string, decision: RunEngineGateDecision): boolean {
    const resolve = this.pendingGates.get(runId);
    if (resolve) {
      this.pendingGates.delete(runId);
      resolve(decision);
      return true;
    }
    if (this.runs.get(runId)?.status === "paused") {
      this.bufferedGateDecisions.set(runId, decision);
      return true;
    }
    return false;
  }

  /** Abort a run. Any pending gate is rejected so the engine unwinds cleanly. */
  cancelRun(runId: string): boolean {
    const controller = this.controllers.get(runId);
    if (!controller) {
      return false;
    }
    const pendingGate = this.pendingGates.get(runId);
    if (pendingGate) {
      this.pendingGates.delete(runId);
      pendingGate({ approved: false, note: "Run canceled." });
    }
    controller.abort();
    return true;
  }

  private awaitGate(gate: {
    runId: string;
    phaseId: string;
    signal: AbortSignal;
  }): Promise<RunEngineGateDecision> {
    return new Promise((resolve) => {
      if (gate.signal.aborted) {
        resolve({ approved: false, note: "Run canceled." });
        return;
      }
      const buffered = this.bufferedGateDecisions.get(gate.runId);
      if (buffered) {
        this.bufferedGateDecisions.delete(gate.runId);
        resolve(buffered);
        return;
      }
      this.pendingGates.set(gate.runId, resolve);
      gate.signal.addEventListener(
        "abort",
        () => {
          if (this.pendingGates.get(gate.runId) === resolve) {
            this.pendingGates.delete(gate.runId);
            resolve({ approved: false, note: "Run canceled." });
          }
        },
        { once: true },
      );
    });
  }

  private async persistAndEmit(run: Run): Promise<void> {
    // Snapshot point-in-time state: the engine mutates the live `run` object in
    // place across awaits, so listeners and the store must each get a frozen
    // copy or they'd all observe the final state.
    const snapshot = structuredClone(run);
    this.runs.set(snapshot.id, snapshot);
    await this.safeSave(snapshot);
    for (const listener of this.changeListeners) {
      try {
        listener(structuredClone(snapshot));
      } catch (error) {
        this.logger.error({ err: error, runId: snapshot.id }, "Run change listener threw");
      }
    }
  }

  private async safeSave(run: Run): Promise<void> {
    try {
      await this.store.save(run);
    } catch (error) {
      this.logger.error({ err: error, runId: run.id }, "Failed to persist run");
    }
  }

  private async safeDelete(runId: string): Promise<void> {
    try {
      await this.store.delete(runId);
    } catch (error) {
      this.logger.error({ err: error, runId }, "Failed to delete run");
    }
  }
}
