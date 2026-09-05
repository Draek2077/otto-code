import { randomBytes } from "node:crypto";

import {
  type OrchestrationGraph,
  type Run,
  type RunPlan,
  type WorkflowStartConfirmation,
  type WorkflowScheduleSource,
  WORKFLOW_START_CONFIRMATION_AGENT_THRESHOLD,
  describeRunPlanStart,
  isTerminalRunStatus,
} from "@otto-code/protocol/workflow";

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
} from "./workflow-engine.js";
import {
  type GraphEnginePort,
  type GraphEngineSpawnInput,
  buildRunFromGraph,
  executeGraphRun,
} from "./graph-engine.js";

// The daemon-integration half of the engine port: the spawn/await/role-resolve
// seams. Supplied by the tool layer (otto-tools.ts) where the real
// createAgentCommand / waitForAgentEvent / active-team resolution live. The
// WorkflowService supplies the other half (gate resolution + emit) so those lifecycle
// concerns stay here, testable with a fake spawn port.
export interface RunSpawnPort {
  resolveRole(role: string): Promise<{ personalityId: string } | null>;
  spawn(input: RunEngineSpawnInput): Promise<RunEngineSpawnResult>;
  awaitAgent(input: { agentId: string; signal: AbortSignal }): Promise<RunEngineAwaitResult>;
  /** The cancel cascade: really stop one child when the run is canceled. */
  cancelAgent?(input: { agentId: string }): Promise<void>;
}

export type WorkflowServiceLogger = OrchestrationLogger;

export interface StartRunInput {
  plan: RunPlan;
  spawnPort: RunSpawnPort;
  /**
   * Activates the pending record created for an AI Workflow launch. Regular
   * conductor-declared runs omit this and mint a new record as before.
   */
  runId?: string;
  conductorAgentId?: string;
  cwd?: string;
  workspaceId?: string;
  teamId?: string;
  teamName?: string;
  /** A model declared this plan; pause for an owner before any child starts. */
  requireStartConfirmation?: boolean;
}

export interface CreateAiRunInput {
  title: string;
  description?: string;
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

// The daemon-integration half of the graph engine port (projects/
// orchestration-graphs) - spawn/await plus routing node completions into the
// orchestrator agent's chat. Role resolution happens inside `spawn` (the graph
// engine passes role/model through and never resolves personalities itself).
export interface GraphSpawnPort {
  spawn(input: GraphEngineSpawnInput): Promise<RunEngineSpawnResult>;
  awaitAgent(input: { agentId: string; signal: AbortSignal }): Promise<RunEngineAwaitResult>;
  /** Stop one agent that reached its node's time limit. */
  cancelAgent(input: { agentId: string }): Promise<void>;
  notifyOrchestrator(input: { text: string }): Promise<void>;
  renderPromptTemplate?: GraphEnginePort["renderPromptTemplate"];
}

export interface CreateDraftGraphRunInput {
  graph: OrchestrationGraph;
  title: string;
  description?: string;
  graphInputs?: Record<string, string>;
  cwd?: string;
  workspaceId?: string;
  teamId?: string;
  teamName?: string;
  scheduleSource?: WorkflowScheduleSource;
  /** Rewrite an existing draft in place (Edit Orchestration), keeping its id. */
  runId?: string;
}

export interface StartGraphRunInput {
  graph: OrchestrationGraph;
  graphInputs: Record<string, string>;
  title: string;
  description?: string;
  spawnPort: GraphSpawnPort;
  /** The already-spawned root agent that hosts the orchestration chat. */
  orchestratorAgentId: string;
  cwd?: string;
  workspaceId?: string;
  teamId?: string;
  teamName?: string;
  scheduleSource?: WorkflowScheduleSource;
  /** Execute an existing draft in place (keeps its id, replaces its record). */
  runId?: string;
}

export type RunChangeListener = (run: Run) => void;
export type RunRemoveListener = (runIds: string[]) => void;

/**
 * Generates a human-readable summary of a terminal run (via a Writer). Returns
 * null when it can't produce one. Injected so the WorkflowService stays free of
 * provider/agent wiring and is unit-testable with a fake.
 */
export type RunSummarizer = (run: Run) => Promise<string | null>;

export interface WorkflowRunStorageResolver {
  provenanceForCwd(cwd: string): Promise<Run["workflowStorage"]>;
}

/** The deliberately small durable-store port WorkflowService needs. */
export interface WorkflowRunPersistence {
  list(): Promise<Run[]>;
  get(id: string): Promise<Run | null>;
  save(run: Run): Promise<void>;
  delete(id: string): Promise<void>;
}

function generateRunId(): string {
  return `run_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}

/**
 * Owns orchestration runs: persistence (via RunStore), the in-memory live map,
 * the change broadcast (for the snapshot session), gate resolution, and driving
 * the engine. Deliberately does NOT know how to spawn agents - that comes in as
 * a RunSpawnPort, so this class is unit-testable and the daemon wiring stays in
 * the tool layer.
 */
export class WorkflowService {
  private readonly store: WorkflowRunPersistence;
  private readonly caps: RunEngineCaps;
  private readonly logger: WorkflowServiceLogger;
  private readonly clock: () => string;
  private readonly runs = new Map<string, Run>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly pendingGates = new Map<string, (decision: RunEngineGateDecision) => void>();
  // A decision that arrived before the engine formally registered its gate wait
  // (emit(paused) awaits a disk write before awaitGate runs, so a fast UI
  // response can land in that window). Applied when awaitGate registers.
  private readonly bufferedGateDecisions = new Map<string, RunEngineGateDecision>();
  // The root chat exists before an AI Workflow declares its phase plan. Keep
  // its cancel bridge here so cancel remains truthful during that planning
  // window and continues to stop the conductor after activation.
  private readonly aiRunCancels = new Map<string, () => Promise<void>>();
  /** Deferred model-declared starts, resolved only by an explicit user decision. */
  private readonly pendingStartConfirmations = new Map<
    string,
    {
      run: Run;
      ready: Promise<boolean>;
      resume: () => Promise<Run>;
      resolve: (run: Run) => void;
    }
  >();
  private readonly changeListeners = new Set<RunChangeListener>();
  private readonly removeListeners = new Set<RunRemoveListener>();
  private readonly summarize: RunSummarizer | undefined;

  private readonly onActivity: ActivityIncrementFn | undefined;

  constructor(options: {
    store: WorkflowRunPersistence;
    logger: WorkflowServiceLogger;
    caps?: RunEngineCaps;
    now?: () => string;
    summarize?: RunSummarizer;
    onActivity?: ActivityIncrementFn;
    /** Resolves the one project store a newly-created Workflow will own. */
    storageResolver?: WorkflowRunStorageResolver;
  }) {
    this.store = options.store;
    this.logger = options.logger;
    this.caps = options.caps ?? DEFAULT_RUN_CAPS;
    this.clock = options.now ?? (() => new Date().toISOString());
    this.summarize = options.summarize;
    this.onActivity = options.onActivity;
    this.storageResolver = options.storageResolver;
  }

  private readonly storageResolver: WorkflowRunStorageResolver | undefined;

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
          error: run.error ?? restartRecoveryReason(run),
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

  /**
   * Review the known initial Graph shape before its root chat is created.
   * Gates and checks cost no agent; retries remain bounded but are not a
   * promised initial count, so the UI calls this a planned count rather than a
   * quote.
   */
  reviewGraphStart(graph: OrchestrationGraph): WorkflowStartConfirmation | null {
    const workerCount = graph.nodes.filter((node) => node.kind === "agent").length;
    const fanOutPhaseCount = graph.nodes.filter(
      (node) => (graph.edges ?? []).filter((edge) => edge.from === node.id).length > 1,
    ).length;
    if (workerCount > this.caps.maxAgents) {
      throw new Error(
        `The Graph starts ${workerCount} worker agents, exceeding this Workflow's ${this.caps.maxAgents}-agent cap.`,
      );
    }
    const plannedAgentCount = workerCount + 1; // the already-known Orchestrator root
    if (plannedAgentCount < WORKFLOW_START_CONFIRMATION_AGENT_THRESHOLD) {
      return null;
    }
    return {
      reason: "agent-threshold",
      plannedAgentCount,
      fanOutPhaseCount,
      phaseCount: graph.nodes.length,
      agentCap: this.caps.maxAgents,
      threshold: WORKFLOW_START_CONFIRMATION_AGENT_THRESHOLD,
    };
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
   * Delete every terminal (done/failed/canceled) run - and any abandoned
   * drafts - from memory and disk. Active/paused runs are left untouched.
   * Returns the deleted run ids.
   */
  async clearFinishedRuns(): Promise<string[]> {
    const finishedIds = [...this.runs.values()]
      .filter((run) => isTerminalRunStatus(run.status) || run.status === "draft")
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

  /**
   * Delete one run from memory and disk. Terminal and draft runs only - an
   * active/paused run is refused so a cleanup click can't orphan its agents;
   * the caller cancels first. Returns why nothing was deleted, if anything.
   */
  async deleteRun(runId: string): Promise<{ deleted: boolean; error?: string }> {
    const run = this.runs.get(runId);
    if (!run) {
      return { deleted: false, error: "Run not found" };
    }
    if (!isTerminalRunStatus(run.status) && run.status !== "draft") {
      return { deleted: false, error: "Cancel the orchestration before deleting it" };
    }
    this.runs.delete(runId);
    this.aiRunCancels.delete(runId);
    await this.safeDelete(runId);
    for (const listener of this.removeListeners) {
      try {
        listener([runId]);
      } catch (error) {
        this.logger.error({ err: error, runId }, "Run remove listener threw");
      }
    }
    return { deleted: true };
  }

  /**
   * Persist an AI Workflow before its orchestrator gets a first turn. The
   * pending state means "planning": it is intentionally not a fake empty
   * phase plan and is therefore a truthful visualizer/history entry.
   */
  async createAiRun(input: CreateAiRunInput): Promise<Run> {
    const now = this.clock();
    const run: Run = await this.withStorage(
      {
        id: generateRunId(),
        title: input.title,
        ...(input.description ? { description: input.description } : {}),
        status: "pending",
        kind: "ai",
        phases: [],
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.teamId ? { teamId: input.teamId } : {}),
        ...(input.teamName ? { teamName: input.teamName } : {}),
        createdAt: now,
        updatedAt: now,
      },
      input.cwd,
    );
    // This is the launch boundary for prompt-and-go Workflows. Do not create
    // the conductor until the immutable planning record is on disk.
    await this.persistInitialAndEmit(run);
    return structuredClone(run);
  }

  /** Bind the pre-created AI Workflow record to its visible planning chat. */
  async bindAiRunConductor(input: {
    runId: string;
    conductorAgentId: string;
    cancelConductor: () => Promise<void>;
  }): Promise<Run> {
    const run = this.requirePendingAiRun(input.runId);
    const bound: Run = {
      ...run,
      conductorAgentId: input.conductorAgentId,
      updatedAt: this.clock(),
    };
    this.aiRunCancels.set(input.runId, input.cancelConductor);
    await this.persistAndEmit(bound);
    return structuredClone(bound);
  }

  /**
   * The planning chat is gone (archived or deleted) without ever declaring a
   * phase plan. Its Workflow must become a durable failure, not a record shown
   * as planning forever. A chat that is merely idle keeps its pending record:
   * the user can still answer a question and the orchestrator can still call
   * start_workflow on a later turn.
   */
  async failPendingAiRunForConductor(conductorAgentId: string, error: string): Promise<void> {
    for (const run of this.runs.values()) {
      if (
        run.kind === "ai" &&
        run.status === "pending" &&
        run.conductorAgentId === conductorAgentId
      ) {
        await this.failPendingAiRun(run.id, error);
      }
    }
  }

  /** Mark a still-planning AI Workflow as failed with a direct reason. */
  async failPendingAiRun(runId: string, error: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run || run.kind !== "ai" || run.status !== "pending") {
      return;
    }
    this.aiRunCancels.delete(runId);
    await this.persistAndEmit({ ...run, status: "failed", error, updatedAt: this.clock() });
  }

  /** Preserve a truthful result when a Graph root cannot be launched. */
  async failPendingGraphRun(runId: string, error: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run || run.kind !== "graph" || run.status !== "pending") {
      return;
    }
    await this.persistAndEmit({ ...run, status: "failed", error, updatedAt: this.clock() });
  }

  /** Build and start executing a Workflow. Returns immediately; execution continues on. */
  startWorkflow(input: StartRunInput): StartRunResult {
    const existing = input.runId ? this.runs.get(input.runId) : undefined;
    const run = this.buildRunForStart(input);
    const shape = describeRunPlanStart(input.plan);
    if (shape.plannedAgentCount > this.caps.maxAgents) {
      throw new Error(
        `The declared plan starts ${shape.plannedAgentCount} agents, exceeding this Workflow's ${this.caps.maxAgents}-agent cap.`,
      );
    }
    const start = this.buildWorkflowStartExecution(run, input);
    if (input.requireStartConfirmation) {
      return this.deferWorkflowStart({
        run,
        start,
        existing,
        confirmation: {
          reason: "model-plan-declared",
          ...shape,
          agentCap: this.caps.maxAgents,
          threshold: WORKFLOW_START_CONFIRMATION_AGENT_THRESHOLD,
        },
      });
    }
    // Snapshot the pending state for the caller BEFORE the engine mutates the
    // live object (executeRun flips it to "running" synchronously).
    const initialSnapshot = structuredClone(run);
    const settled = this.persistInitialAndStart(run, start, existing);

    return { run: initialSnapshot, settled };
  }

  private buildWorkflowStartExecution(run: Run, input: StartRunInput): () => Promise<Run> {
    return () => {
      const controller = new AbortController();
      this.controllers.set(run.id, controller);
      const port: RunEnginePort = {
        resolveRole: input.spawnPort.resolveRole,
        spawn: input.spawnPort.spawn,
        awaitAgent: input.spawnPort.awaitAgent,
        ...(input.spawnPort.cancelAgent
          ? { cancelAgent: input.spawnPort.cancelAgent.bind(input.spawnPort) }
          : {}),
        awaitGate: (gate) => this.awaitGate(gate),
        emit: (updated) => this.persistAndEmit(updated),
        now: this.clock,
        logger: this.logger,
      };
      return executeRun({
        run,
        plan: input.plan,
        caps: this.caps,
        signal: controller.signal,
        port,
      });
    };
  }

  /**
   * Persist a model-declared plan as a separate start confirmation. It does
   * not become a plan gate and it does not rewrite the model's autopilot or
   * permission mode. No child can be spawned until respondToStartConfirmation
   * accepts the owner's decision.
   */
  private deferWorkflowStart(input: {
    run: Run;
    start: () => Promise<Run>;
    existing: Run | undefined;
    confirmation: WorkflowStartConfirmation;
  }): StartRunResult {
    const paused: Run = {
      ...input.run,
      status: "paused",
      startConfirmation: input.confirmation,
      updatedAt: this.clock(),
    };
    let resolveSettled: (run: Run) => void = () => {};
    const settled = new Promise<Run>((resolve) => {
      resolveSettled = resolve;
    });
    const ready = this.persistInitialAndEmit(paused).then(
      () => true,
      (error) => {
        this.pendingStartConfirmations.delete(paused.id);
        resolveSettled(this.rejectUnpersistedLaunch(paused, error, input.existing));
        return false;
      },
    );
    this.pendingStartConfirmations.set(paused.id, {
      run: paused,
      ready,
      resolve: resolveSettled,
      resume: async () => {
        if (!(await ready)) return settled;
        const resumed: Run = {
          ...input.run,
          status: "pending",
          updatedAt: this.clock(),
        };
        await this.persistAndEmit(resumed);
        this.onActivity?.("runsOrchestrated");
        return this.settleExecution(resumed.id, resumed, Promise.resolve().then(input.start));
      },
    });
    return { run: structuredClone(paused), settled };
  }

  // COMPAT(runServiceStartRun): renamed to startWorkflow in v0.9.0; remove
  // after 2027-02-28 once downstream extensions have moved to the Workflow API.
  startRun(input: StartRunInput): StartRunResult {
    return this.startWorkflow(input);
  }

  private buildRunForStart(input: StartRunInput): Run {
    if (!input.runId) {
      return this.buildPhaseRun(input, generateRunId());
    }
    const existing = this.requirePendingAiRun(input.runId);
    if (input.conductorAgentId !== existing.conductorAgentId) {
      throw new Error(`Run ${existing.id} may only be activated by its bound orchestrator`);
    }
    const built = this.buildPhaseRun(input, existing.id, existing);
    return {
      ...built,
      title: existing.title,
      ...(existing.description ? { description: existing.description } : {}),
      kind: "ai",
      createdAt: existing.createdAt,
      ...(existing.workflowStorage ? { workflowStorage: existing.workflowStorage } : {}),
    };
  }

  private buildPhaseRun(input: StartRunInput, id: string, existing?: Run): Run {
    const context = existing ?? input;
    return buildRunFromPlan({
      plan: input.plan,
      id,
      now: this.clock(),
      ...(context.conductorAgentId ? { conductorAgentId: context.conductorAgentId } : {}),
      ...(context.cwd ? { cwd: context.cwd } : {}),
      ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
      ...(context.teamId ? { teamId: context.teamId } : {}),
      ...(context.teamName ? { teamName: context.teamName } : {}),
    });
  }

  /**
   * Create a Draft graph run - the record the New Orchestration dialog mints
   * before the user finishes designing the graph. Not executed; no orchestrator
   * agent exists yet. Executing later (startGraphRun with this id) replaces the
   * record in place, keeping the id stable for clients.
   *
   * With `runId`, this re-saves an existing draft in place instead - the Edit
   * Orchestration flow, where the dialog reopens on a draft and saves without
   * running. Only a draft may be rewritten; anything else is a loud error.
   */
  async createDraftGraphRun(input: CreateDraftGraphRunInput): Promise<Run> {
    if (input.runId) {
      const existing = this.runs.get(input.runId);
      if (!existing) {
        throw new Error(`Run ${input.runId} not found`);
      }
      if (existing.status !== "draft") {
        throw new Error(`Run ${input.runId} is not a draft (status: ${existing.status})`);
      }
    }
    const run = await this.withStorage(
      buildRunFromGraph({
        graph: input.graph,
        graphInputs: input.graphInputs ?? {},
        id: input.runId ?? generateRunId(),
        title: input.title,
        ...(input.description ? { description: input.description } : {}),
        now: this.clock(),
        status: "draft",
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.teamId ? { teamId: input.teamId } : {}),
        ...(input.teamName ? { teamName: input.teamName } : {}),
        ...(input.scheduleSource ? { scheduleSource: input.scheduleSource } : {}),
      }),
      input.cwd,
    );
    await this.persistAndEmit(run);
    return structuredClone(run);
  }

  /**
   * Persist a Graph Workflow's immutable execution snapshot before its root
   * chat is spawned. Unlike a draft, this record is a pending launch and may
   * be activated only by startGraphRun with the same id.
   */
  async prepareGraphRun(input: CreateDraftGraphRunInput): Promise<Run> {
    if (input.runId) {
      const existing = this.runs.get(input.runId);
      if (!existing) {
        throw new Error(`Run ${input.runId} not found`);
      }
      if (existing.status !== "draft") {
        throw new Error(`Run ${input.runId} is not a draft (status: ${existing.status})`);
      }
    }
    const run = await this.withStorage(
      buildRunFromGraph({
        graph: input.graph,
        graphInputs: input.graphInputs ?? {},
        id: input.runId ?? generateRunId(),
        title: input.title,
        ...(input.description ? { description: input.description } : {}),
        now: this.clock(),
        status: "pending",
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.teamId ? { teamId: input.teamId } : {}),
        ...(input.teamName ? { teamName: input.teamName } : {}),
        ...(input.scheduleSource ? { scheduleSource: input.scheduleSource } : {}),
      }),
      input.cwd,
    );
    await this.persistInitialAndEmit(run);
    return structuredClone(run);
  }

  /**
   * Build and start executing a graph run (projects/orchestration-graphs).
   * Mirrors startRun: returns immediately with the initial projection while the
   * graph engine drives execution on. Throws (before any spawn) when the graph
   * fails structural validation or `runId` names a non-draft record.
   */
  startGraphRun(input: StartGraphRunInput): StartRunResult {
    let existing: Run | undefined;
    if (input.runId) {
      existing = this.runs.get(input.runId);
      if (!existing) {
        throw new Error(`Run ${input.runId} not found`);
      }
      if (existing.status !== "draft" && existing.status !== "pending") {
        throw new Error(
          `Run ${input.runId} is not a draft or pending launch (status: ${existing.status})`,
        );
      }
    }
    const id = input.runId ?? generateRunId();
    const run = buildRunFromGraph({
      graph: input.graph,
      graphInputs: input.graphInputs,
      id,
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      now: this.clock(),
      conductorAgentId: input.orchestratorAgentId,
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.teamId ? { teamId: input.teamId } : {}),
      ...(input.teamName ? { teamName: input.teamName } : {}),
      ...(input.scheduleSource ? { scheduleSource: input.scheduleSource } : {}),
    });
    if (existing?.status === "pending") {
      run.createdAt = existing.createdAt;
    }
    if (existing?.workflowStorage) {
      run.workflowStorage = existing.workflowStorage;
    }
    const initialSnapshot = structuredClone(run);
    const settled = this.persistInitialAndStart(
      run,
      () => {
        const controller = new AbortController();
        this.controllers.set(id, controller);
        const port: GraphEnginePort = {
          spawn: input.spawnPort.spawn,
          awaitAgent: input.spawnPort.awaitAgent,
          cancelAgent: input.spawnPort.cancelAgent,
          awaitGate: (gate) => this.awaitGate(gate),
          notifyOrchestrator: input.spawnPort.notifyOrchestrator,
          ...(input.spawnPort.renderPromptTemplate
            ? { renderPromptTemplate: input.spawnPort.renderPromptTemplate }
            : {}),
          emit: (updated) => this.persistAndEmit(updated),
          now: this.clock,
          logger: this.logger,
        };
        return executeGraphRun({
          run,
          graph: input.graph,
          graphInputs: input.graphInputs,
          caps: this.caps,
          signal: controller.signal,
          port,
        });
      },
      existing,
    );

    return { run: initialSnapshot, settled };
  }

  /**
   * A new launch has no recovery point until this write succeeds. Keep it out
   * of memory and off the event stream on failure, and never invoke an engine
   * (whose first action may spawn an agent) before that boundary is crossed.
   */
  private persistInitialAndStart(
    run: Run,
    start: () => Promise<Run>,
    previous?: Run,
  ): Promise<Run> {
    // Keep the synchronous control surface coherent while the write is in
    // flight (for example, a same-tick delete still sees an active launch),
    // but never publish this provisional entry. A failed write removes it.
    this.runs.set(run.id, structuredClone(run));
    return this.persistInitialAndEmit(run).then(
      () => {
        this.onActivity?.("runsOrchestrated");
        return this.settleExecution(run.id, run, Promise.resolve().then(start));
      },
      (error) => this.rejectUnpersistedLaunch(run, error, previous),
    );
  }

  private rejectUnpersistedLaunch(run: Run, error: unknown, previous?: Run): Run {
    if (previous) {
      // The prior snapshot was durably announced. Preserve it in memory when
      // activation fails, rather than hiding an existing recoverable record.
      this.runs.set(previous.id, previous);
    } else {
      this.runs.delete(run.id);
    }
    this.controllers.delete(run.id);
    const reason = error instanceof Error ? error.message : String(error);
    this.logger.error(
      { err: error, runId: run.id },
      "Workflow launch rejected: initial snapshot was not persisted",
    );
    return {
      ...run,
      status: "failed",
      error: `Workflow did not start because its initial snapshot could not be persisted: ${reason}`,
      updatedAt: this.clock(),
    };
  }

  // Shared tail for both engines: land the terminal run (or the failure), kick
  // the after-settle summary, and release the per-run control state.
  private settleExecution(id: string, run: Run, execution: Promise<Run>): Promise<Run> {
    return execution
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
        // caller (start_workflow awaits `settled`); the summary lands via broadcast.
        void this.maybeSummarize(terminal);
        return terminal;
      })
      .finally(() => {
        this.controllers.delete(id);
        this.aiRunCancels.delete(id);
        this.pendingGates.delete(id);
        this.bufferedGateDecisions.delete(id);
      });
  }

  // Generate a Writer summary for a terminal run (done/failed/canceled) and land
  // it on the run via broadcast. Best-effort - a failed generation just marks the
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
   * Resolve when a run first reaches a terminal state OR pauses at a gate -
   * whichever comes first - so the conductor can relay the outcome in one turn
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
  respondToGate(input: {
    runId: string;
    phaseId: string;
    decision: RunEngineGateDecision;
  }): boolean {
    const run = this.runs.get(input.runId);
    const gate = run?.phases.find(
      (phase) => phase.id === input.phaseId && phase.type === "gate" && phase.status === "blocked",
    );
    // The response names a particular gate. Refuse a stale action instead of
    // letting it approve whichever later gate happens to be parked on this run.
    if (!run || !gate) {
      return false;
    }
    const resolve = this.pendingGates.get(input.runId);
    if (resolve) {
      this.pendingGates.delete(input.runId);
      resolve(input.decision);
      return true;
    }
    if (run.status === "paused") {
      this.bufferedGateDecisions.set(input.runId, input.decision);
      return true;
    }
    return false;
  }

  /**
   * Resolve the daemon-owned confirmation that sits before a model-declared
   * plan. This is intentionally distinct from respondToGate: ordinary plan
   * gates retain their declared phase id and their autopilot semantics.
   */
  respondToStartConfirmation(input: { runId: string; approved: boolean }): boolean {
    const pending = this.pendingStartConfirmations.get(input.runId);
    if (!pending) {
      return false;
    }
    const run = pending.run;
    if (!run.startConfirmation || run.status !== "paused") {
      return false;
    }
    this.pendingStartConfirmations.delete(input.runId);
    if (!input.approved) {
      const { startConfirmation: _startConfirmation, ...withoutConfirmation } = run;
      const canceled: Run = {
        ...withoutConfirmation,
        status: "canceled",
        error: "Workflow start was rejected.",
        updatedAt: this.clock(),
      };
      // The initial paused snapshot may still be writing when the owner rejects.
      // Preserve write/emission order and await the cancellation save attempt.
      void pending.ready.then(async (ready) => {
        if (!ready) return undefined;
        await this.persistAndEmit(canceled);
        pending.resolve(canceled);
        return undefined;
      });
      this.cancelAiConductor(input.runId);
      return true;
    }
    void pending
      .resume()
      .then(pending.resolve)
      .catch(async (error) => {
        const failed: Run = {
          ...run,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
          updatedAt: this.clock(),
        };
        await this.persistAndEmit(failed);
        pending.resolve(failed);
      });
    return true;
  }

  /** Abort a run. Any pending gate is rejected so the engine unwinds cleanly. */
  cancelRun(runId: string): boolean {
    const controller = this.controllers.get(runId);
    const cancelAiConductor = this.aiRunCancels.get(runId);
    const pendingStart = this.pendingStartConfirmations.get(runId);
    if (!controller && !cancelAiConductor && !pendingStart) {
      return false;
    }
    if (pendingStart) {
      return this.respondToStartConfirmation({ runId, approved: false });
    }
    if (!controller) {
      const run = this.runs.get(runId);
      if (run?.kind === "ai" && run.status === "pending") {
        void this.persistAndEmit({
          ...run,
          status: "canceled",
          error: "Workflow canceled while the orchestrator was planning.",
          updatedAt: this.clock(),
        });
      }
      this.aiRunCancels.delete(runId);
    }
    const pendingGate = this.pendingGates.get(runId);
    if (pendingGate) {
      this.pendingGates.delete(runId);
      pendingGate({ approved: false, note: "Run canceled." });
    }
    controller?.abort();
    this.cancelAiConductor(runId, cancelAiConductor);
    return true;
  }

  private cancelAiConductor(runId: string, cancel = this.aiRunCancels.get(runId)): void {
    if (!cancel) {
      return;
    }
    this.aiRunCancels.delete(runId);
    void cancel().catch((error) => {
      this.logger.warn({ err: error, runId }, "Could not cancel an AI Workflow conductor");
    });
  }

  private requirePendingAiRun(runId: string): Run {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }
    if (run.kind !== "ai" || run.status !== "pending") {
      throw new Error(`Run ${runId} is not a pending AI Workflow`);
    }
    return run;
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

  /**
   * The first write is where ownership becomes durable. If resolution fails,
   * creation fails before a root agent can be spawned; a new Workflow never
   * falls back into a daemon-global bucket.
   */
  private async withStorage(run: Run, cwd: string | undefined): Promise<Run> {
    if (!this.storageResolver || !cwd) return run;
    return { ...run, workflowStorage: await this.storageResolver.provenanceForCwd(cwd) };
  }

  /**
   * Strictly persist the first immutable snapshot. Later engine updates remain
   * best-effort so a transient storage error cannot turn into an unhandled
   * engine rejection; this first write is different because no durable record
   * exists to recover after a restart.
   */
  private async persistInitialAndEmit(run: Run): Promise<void> {
    const snapshot = structuredClone(run);
    await this.store.save(snapshot);
    this.runs.set(snapshot.id, snapshot);
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

// COMPAT(runServiceClass): renamed to WorkflowService in v0.9.0; remove after
// 2027-02-28 once downstream extensions have moved to the Workflow API.
export const RunService = WorkflowService;

// A run interrupted by a restart failed for different reasons depending on
// where it was, and the record must say which so the user knows what to redo.
function restartRecoveryReason(run: Run): string {
  if (run.startConfirmation) {
    return "Daemon restarted before this Workflow's start was confirmed. Nothing ran; start it again.";
  }
  if (run.kind === "ai" && run.status === "pending") {
    return "Daemon restarted while the orchestrator was still planning this Workflow.";
  }
  if (run.status === "paused") {
    return "Daemon restarted while this Workflow was waiting at a gate.";
  }
  return "Daemon restarted while this Workflow was in flight.";
}

/**
 * The projection every client receives. `graphSnapshot` is the run's frozen
 * source document and is kept on disk for history, but it is not sent on
 * every phase transition: no client reads it yet and it multiplies each
 * `runs.updated.notification` by the size of the Graph.
 */
export function toWireRun(run: Run): Run {
  if (!run.graphSnapshot) return run;
  const { graphSnapshot: _graphSnapshot, ...wire } = run;
  return wire;
}
