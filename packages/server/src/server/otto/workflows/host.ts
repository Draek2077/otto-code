import { randomUUID } from "node:crypto";
import {
  RunPlanSchema,
  describeRunPlanStart,
  isTerminalRunStatus,
  normalizeWorkflowRunRecord,
  workflowRefKey,
  type Run,
  type RunPlan,
  type WorkflowEntry,
  type WorkflowLaunch,
  type WorkflowRef,
  type WorkflowScope,
  type WorkflowScheduleSource,
} from "@getpaseo/plugin/otto/workflows";
import { WorkflowLibrary } from "./library.js";
import { WorkflowJournal, type ActiveWorkflowRecord } from "./journal.js";
import { WorkflowError, workflowDigest } from "./files.js";
import {
  reviewWorkflow,
  seatsFor,
  limitsFor,
  validatePlan,
  graphAccess,
  parseGraphSeat,
  planPhaseAccess,
  type WorkflowReview,
} from "./preflight.js";
import {
  buildRunFromGraph,
  executeGraphRun,
  type GraphEnginePort,
  type GraphEngineSpawnInput,
} from "./graph-engine.js";
import {
  buildRunFromPlan,
  executeRun,
  type RunEnginePort,
  type RunEngineSpawnInput,
  type RunEngineAwaitResult,
} from "./workflow-engine.js";
import { WorkflowSlots, type ActiveWorkflow } from "./run-state.js";
import type {
  WorkflowAgentRequest,
  WorkflowAgentBinding,
  WorkflowRuntimePorts,
} from "./runtime-ports.js";
import { formatStartRunCompletionNotification } from "./workflow-start-lifecycle.js";
import { captureWorkflowTemplates } from "./template-snapshot.js";
import { renderWorkflowTemplate, workflowTemplateVariables } from "./templates.js";
import { WorkflowTurnLease } from "./turn-lease.js";
import { WorkflowSettlement } from "./settlement.js";
import { assertWorkflowLaunchSource } from "./launch-source.js";
import { workflowDelegationAllowed } from "./tool-groups.js";
import { WorkflowRunOutputs, workflowRunManifest, workflowPreview } from "./run-outputs.js";

/** Canonical run host. Paseo owns every agent/session; this owner holds only Workflow identities and bounded control state. */
export class WorkflowHost {
  readonly instanceId = randomUUID();
  private readonly active = new Map<string, ActiveWorkflow>();
  private readonly bindings = new Map<string, WorkflowAgentBinding>();
  private readonly reviews = new Map<string, WorkflowReview>();
  private readonly turns = new WorkflowSlots(6);
  private readonly writers = new Map<string, WorkflowSlots>();
  private releaseObservation: (() => void) | null = null;
  private admitting = 0;
  private readonly admissions = new Set<Promise<WorkflowEntry>>();
  private ready = false;
  private closed = false;
  private startupMessage: string | null = null;
  private readonly reconciling = new Set<string>();
  readonly journal: WorkflowJournal;
  readonly outputs: WorkflowRunOutputs;
  constructor(
    readonly library: WorkflowLibrary,
    readonly ports: WorkflowRuntimePorts,
  ) {
    this.journal = new WorkflowJournal(library.ports.stores.ports.home);
    this.outputs = new WorkflowRunOutputs(library);
  }

  async initialize(): Promise<void> {
    if (this.ready) return;
    for (const record of await this.journal.read()) {
      // No automatic provider resume. Only exact durable owners may be canceled/closed during recovery.
      for (const id of record.agentIds)
        if (await this.ports.ownsAgent(id, record.ref.id, record.ownerInstance)) {
          await this.ports.cancelAgent(id);
          await this.ports.closeAgent(id);
        }
      const entry = await this.library.read(record.ref);
      if (entry.document.kind !== "run")
        throw new WorkflowError("invalid", "Active Workflow journal points to a non-run document.");
      if (!isTerminalRunStatus(entry.document.value.status))
        await this.library.write(
          record.ref.scope,
          {
            kind: "run",
            value: {
              ...entry.document.value,
              status: "failed",
              error:
                "Workflow interrupted by daemon restart. Review retained output before starting a new run.",
              updatedAt: this.ports.now(),
            },
          },
          entry.revision,
          entry.ref,
        );
      await this.journal.update(record.ref.id, null);
    }
    this.ready = true;
  }
  private assertReady() {
    if (!this.ready || this.closed)
      throw new WorkflowError(
        "unavailable",
        "Workflow host is unavailable or still reconciling interrupted runs.",
      );
  }
  unavailable(): void {
    this.startupMessage =
      "Interrupted Workflow recovery could not finish. Inspect retained Workflow history and the owning host log. Ordinary chats remain available.";
  }
  status() {
    return {
      ready: this.ready && !this.closed,
      message: this.startupMessage,
      active: [...this.active.values()].map((state) => ({
        ref: state.entry.ref,
        revision: state.entry.revision,
        status: state.run.status,
        settling: state.closing,
        recoveryRequired: !!state.failure || state.recoveryRequired,
      })),
    };
  }
  async review(
    scope: WorkflowScope,
    workspaceId: string,
    launch: WorkflowLaunch,
    operationId: string,
    scheduleSource?: WorkflowScheduleSource,
  ) {
    this.assertReady();
    for (const [token, value] of this.reviews)
      if (value.expiresAt < Date.now()) this.reviews.delete(token);
    if (this.reviews.size >= 16)
      throw new WorkflowError(
        "busy",
        "Too many pending Workflow reviews. Complete or let an existing review expire.",
      );
    await assertWorkflowLaunchSource(this.library, scope, launch);
    const captured = await captureWorkflowTemplates(this.library, scope, launch);
    const review = await reviewWorkflow(this.ports, scope, workspaceId, captured, operationId);
    if (scheduleSource) {
      review.scheduleSource = structuredClone(scheduleSource);
      review.fingerprint = workflowDigest(JSON.stringify([review.fingerprint, scheduleSource]));
    }
    this.assertReady();
    this.reviews.set(review.token, review);
    return {
      token: review.token,
      issues: [],
      agentCount:
        launch.kind === "graph"
          ? launch.graph.nodes.filter((n) => n.kind === "agent" || n.kind === "orchestrator").length
          : 1,
      fanOutCount: 0,
      expiresAt: new Date(review.expiresAt).toISOString(),
      warnings: [
        "Worker and judge seats are frozen for this run. Native provider permissions remain visible in their dedicated chats.",
        "Canceling a Workflow never reverts edits already made.",
        "Worker and judge turns never wait for interactive permission. Unapproved requests are denied; explicitly selected native modes keep their existing provider semantics.",
      ],
      launch: review.launch,
    };
  }
  async start(scope: WorkflowScope, token: string, operationId: string): Promise<WorkflowEntry> {
    this.assertReady();
    const review = this.reviews.get(token);
    if (
      !review ||
      review.expiresAt < Date.now() ||
      review.operationId !== operationId ||
      review.scope.hostId !== scope.hostId ||
      review.scope.projectId !== scope.projectId
    )
      throw new WorkflowError(
        "conflict",
        "Workflow review expired or no longer matches this operation. Review the exact launch again.",
      );
    const id = `run-${workflowDigest(JSON.stringify([scope.hostId, scope.projectId, operationId])).slice(0, 32)}`;
    const existing = this.active.get(id);
    if (existing) {
      if (existing.run.launchFingerprint !== review.fingerprint)
        throw new WorkflowError(
          "conflict",
          "This operation already owns different reviewed content.",
        );
      return structuredClone(existing.entry);
    }
    const entry = await this.existingRun(scope, id);
    if (entry) {
      if (
        entry.document.kind !== "run" ||
        entry.document.value.launchFingerprint !== review.fingerprint
      )
        throw new WorkflowError(
          "conflict",
          "This launch operation identity already belongs to different reviewed content.",
        );
      return entry;
    }
    if (this.active.size + this.admitting >= 2)
      throw new WorkflowError(
        "busy",
        "Two Workflows are already admitted. Finish or cancel one before starting another.",
      );
    this.assertReady();
    this.admitting++;
    this.reviews.delete(token);
    try {
      await assertWorkflowLaunchSource(this.library, scope, review.launch);
      const admission = this.admit(id, review);
      this.admissions.add(admission);
      try {
        return await admission;
      } finally {
        this.admissions.delete(admission);
      }
    } finally {
      this.admitting--;
    }
  }
  /** Trusted owner cleanup; abandoning a Schedule preflight cannot retain review capacity. */
  discardReview(scope: WorkflowScope, token: string): void {
    const review = this.reviews.get(token);
    if (
      review &&
      review.scope.hostId === scope.hostId &&
      review.scope.projectId === scope.projectId
    )
      this.reviews.delete(token);
  }
  private async admit(id: string, review: WorkflowReview): Promise<WorkflowEntry> {
    const now = this.ports.now();
    const conductorAgentId = randomUUID();
    const base: Run =
      review.launch.kind === "graph"
        ? buildRunFromGraph({
            graph: review.launch.graph,
            graphInputs: review.launch.inputs,
            id,
            title: review.launch.graph.name,
            now,
            conductorAgentId,
            workspaceId: review.workspace.workspaceId,
            cwd: review.workspace.cwd,
            scheduleSource: review.scheduleSource,
          })
        : {
            id,
            title: review.launch.definition.title,
            status: "planning",
            phases: [],
            conductorAgentId,
            workspaceId: review.workspace.workspaceId,
            cwd: review.workspace.cwd,
            createdAt: now,
            updatedAt: now,
          };
    const run = normalizeWorkflowRunRecord({
      ...base,
      ...(review.scheduleSource ? { scheduleSource: review.scheduleSource } : {}),
      launch: review.launch,
      ownerInstance: this.instanceId,
      projectId: review.scope.projectId,
      operationId: review.operationId,
      launchFingerprint: review.fingerprint,
      workerAgentIds: [],
    });
    const entry = await this.library.write(
      review.scope,
      { kind: "run", value: workflowRunManifest(run) },
      null,
    );
    const state: ActiveWorkflow = {
      entry,
      run,
      launch: review.launch,
      workspace: review.workspace,
      abort: new AbortController(),
      engine: null,
      settlement: new WorkflowSettlement(),
      publications: Promise.resolve(),
      failure: null,
      cancelRequested: false,
      admitted: false,
      closing: false,
      recoveryRequired: false,
      agents: new Map(),
      members: new Map(),
      pending: new Set(),
      turns: new Map(),
      turnCapacity: new WorkflowSlots(limitsFor(review.launch).maxConcurrency),
      leases: new Map(),
      gates: new Map(),
      deadline: null,
    };
    this.active.set(id, state);
    this.ensureObservation();
    try {
      await this.journal.update(id, {
        ref: entry.ref,
        ownerInstance: this.instanceId,
        agentIds: [],
      });
      const request = this.request(state, {
        agentId: conductorAgentId,
        role: "conductor",
        seat: seatsFor(review.launch).conductor,
        title: `Workflow: ${run.title}`,
        access: "write",
      });
      // The first projection and owner reservation are durable before native creation or any turn.
      await this.createOwned(state, request);
      if (review.launch.kind === "graph") {
        state.admitted = true;
        this.launchEngine(state);
      } else
        this.beginTurn(
          state,
          conductorAgentId,
          `${review.launch.definition.prompt}\n\nThis is an AI Workflow in Planning. Discuss and clarify the task, then call start_workflow with a bounded typed plan. Do not start independent agents. The daemon owns phases and caps; the user will review the plan before workers start unless autopilot was explicitly selected.`,
        );
      return structuredClone(state.entry);
    } catch (error) {
      await this.requestCancel(id, "Workflow initialization failed.", false);
      throw error;
    }
  }
  private async existingRun(scope: WorkflowScope, id: string): Promise<WorkflowEntry | null> {
    const found: WorkflowEntry[] = [];
    for (const store of await this.library.ports.stores.locations(scope)) {
      const item = await this.library.readAt(store, "run", id);
      if (item) found.push(item.entry);
    }
    if (found.length > 1)
      throw new WorkflowError(
        "conflict",
        "This run identity exists at multiple origins. Review the retained records.",
      );
    return found[0] ?? null;
  }
  private ensureObservation() {
    if (this.releaseObservation) return;
    this.releaseObservation = this.ports.observe((agentId, event) => {
      const binding = this.bindings.get(agentId);
      if (!binding) return;
      const state = this.active.get(binding.ref.id);
      if (!state || state.closing) return;
      if (binding.role !== "conductor") {
        state.members.get(agentId)?.abort(new Error("Workflow member stopped."));
        return;
      }
      if (event === "canceled") return; // An interrupted clarification does not end Planning.
      void this.requestCancel(state.run.id, "Workflow conductor was archived or deleted.").catch(
        (error) => this.ports.logger.error({ error }, "Workflow lifecycle cancellation failed"),
      );
    });
  }
  binding(agentId: string): WorkflowAgentBinding | null {
    const binding = this.bindings.get(agentId);
    const state = binding ? this.active.get(binding.ref.id) : null;
    return binding &&
      state &&
      !state.abort.signal.aborted &&
      !state.members.get(agentId)?.signal.aborted &&
      !state.closing
      ? binding
      : null;
  }
  /** Runtime launch fencing needs retained reservations even after live tool authority was revoked. */
  reservation(agentId: string): WorkflowAgentBinding | null {
    return this.bindings.get(agentId) ?? null;
  }
  controlsConductor(agentId: string): boolean {
    const binding = this.bindings.get(agentId);
    return binding?.role === "conductor" && !!this.active.get(binding.ref.id)?.admitted;
  }
  memberSignal(agentId: string): AbortSignal {
    const binding = this.binding(agentId);
    if (!binding) throw new WorkflowError("unavailable", "Workflow authority has ended.");
    return this.signal(this.state(binding.ref), agentId);
  }
  private signal(state: ActiveWorkflow, agentId: string): AbortSignal {
    const member = state.members.get(agentId);
    return member ? AbortSignal.any([state.abort.signal, member.signal]) : state.abort.signal;
  }
  assertInactive(ref: WorkflowRef): void {
    if (this.active.has(ref.id))
      throw new WorkflowError(
        "busy",
        "Workflow still owns execution or cleanup. Wait for settlement before changing its history/storage.",
      );
  }
  private request(
    state: ActiveWorkflow,
    input: Pick<WorkflowAgentRequest, "agentId" | "role" | "seat" | "title" | "access"> &
      Partial<WorkflowAgentRequest>,
  ): WorkflowAgentRequest {
    return {
      ...input,
      runId: state.run.id,
      ownerInstance: this.instanceId,
      workspace: state.workspace,
      ...(input.role !== "conductor"
        ? { parentAgentId: input.parentAgentId ?? state.run.conductorAgentId }
        : {}),
    };
  }
  private async createOwned(
    state: ActiveWorkflow,
    request: WorkflowAgentRequest,
    member = new AbortController(),
  ): Promise<void> {
    const operation = this.registerOwned(state, request, member);
    state.pending.add(operation);
    try {
      await operation;
    } finally {
      state.pending.delete(operation);
    }
  }
  private async registerOwned(
    state: ActiveWorkflow,
    request: WorkflowAgentRequest,
    member: AbortController,
  ): Promise<void> {
    this.assertReady();
    state.abort.signal.throwIfAborted();
    member.signal.throwIfAborted();
    if (state.agents.size >= limitsFor(state.launch).maxAgents)
      throw new WorkflowError("busy", "Workflow agent limit reached.");
    const binding = { ref: state.entry.ref, role: request.role, request };
    state.agents.set(request.agentId, binding);
    state.members.set(request.agentId, member);
    this.bindings.set(request.agentId, binding);
    if (request.role !== "conductor")
      state.run.workerAgentIds = [...state.agents.values()]
        .filter((item) => item.role !== "conductor")
        .map((item) => item.request.agentId);
    await this.journal.update(state.run.id, {
      ref: state.entry.ref,
      ownerInstance: this.instanceId,
      agentIds: [...state.agents.keys()],
    });
    await this.publish(state, state.run);
    const signal = this.signal(state, request.agentId);
    signal.throwIfAborted();
    this.assertReady();
    await this.ports.createAgent(request);
    // Cancellation during native startup cannot start a late turn, and admission stays held until cleanup.
    if (signal.aborted) {
      await this.ports.cancelAgent(request.agentId);
      await this.ports.closeAgent(request.agentId);
      signal.throwIfAborted();
    }
  }
  private beginTurn(
    state: ActiveWorkflow,
    id: string,
    text: string,
  ): Promise<RunEngineAwaitResult> {
    const binding = state.agents.get(id);
    if (!binding) throw new WorkflowError("invalid", "Workflow does not own this agent.");
    const previous = state.turns.get(id) ?? Promise.resolve();
    const operation = previous
      .then(() => this.runTurn(state, binding, text))
      .catch(
        (error): RunEngineAwaitResult => ({
          failed: true,
          finalMessage: null,
          error: error instanceof Error ? error.message : "Workflow agent failed.",
        }),
      );
    state.turns.set(id, operation);
    state.pending.add(operation);
    void operation.then(() => {
      state.pending.delete(operation);
      return undefined;
    });
    return operation;
  }
  private async runTurn(
    state: ActiveWorkflow,
    binding: WorkflowAgentBinding,
    text: string,
  ): Promise<RunEngineAwaitResult> {
    if (Buffer.byteLength(text) > 128000)
      throw new WorkflowError(
        "invalid",
        "Workflow handoff exceeds 128 KB. Narrow edge fields and return file references instead of large contents.",
      );
    const signal = this.signal(state, binding.request.agentId);
    const lease = new WorkflowTurnLease(this.turns, state.turnCapacity, signal);
    let releaseWriter: (() => void) | null = null;
    try {
      if (binding.request.access === "write") {
        const key = state.workspace.workspaceId;
        let lane = this.writers.get(key);
        if (!lane) {
          lane = new WorkflowSlots(1);
          this.writers.set(key, lane);
        }
        releaseWriter = await lane.acquire(signal);
      }
      await lease.acquire();
      state.leases.set(binding.request.agentId, lease);
      signal.throwIfAborted();
      const result = await this.ports.turn(binding.request.agentId, text, signal);
      signal.throwIfAborted();
      return result;
    } finally {
      state.leases.delete(binding.request.agentId);
      lease.close();
      releaseWriter?.();
    }
  }
  private publish(state: ActiveWorkflow, run: Run): Promise<void> {
    const snapshot = normalizeWorkflowRunRecord(
      structuredClone({
        ...state.run,
        ...run,
        workerAgentIds: state.run.workerAgentIds,
        agentCount: state.agents.size,
        updatedAt: this.ports.now(),
      }),
    );
    const publication = state.publications
      .then(async () => {
        if (state.failure) throw state.failure;
        const manifest = await this.outputs.capture(state.entry.ref, snapshot);
        const entry = await this.library.write(
          state.entry.ref.scope,
          { kind: "run", value: manifest },
          state.entry.revision,
          state.entry.ref,
        );
        state.entry = entry;
        this.ports.changed?.(entry);
        return undefined;
      })
      .catch((error) => {
        state.failure = error;
        state.abort.abort(error);
        throw error;
      });
    state.publications = publication.catch(() => undefined);
    return publication;
  }
  /** Managed, bounded delegation. Shared-checkout writes never fan out; only read/none children are admitted. */
  async delegate(
    callerId: string,
    input: { task: string; access: "read" | "none" },
    callSignal?: AbortSignal,
  ): Promise<RunEngineAwaitResult & { agentId: string }> {
    const parent = this.binding(callerId);
    if (
      !parent ||
      parent.role !== "worker" ||
      !parent.request.autonomous ||
      !workflowDelegationAllowed(parent.request.toolGroups)
    )
      throw new WorkflowError("unsupported", "This node has no managed delegation authority.");
    const state = this.state(parent.ref);
    const depth = (parent.request.delegationDepth ?? 0) + 1;
    if (depth > 3)
      throw new WorkflowError("invalid", "Workflow delegation is limited to three levels.");
    if (parent.request.access === "none" && input.access !== "none")
      throw new WorkflowError("invalid", "A child cannot exceed its parent's workspace access.");
    if (!input.task.trim() || input.task.length > 32000)
      throw new WorkflowError("invalid", "Delegate a task of 1–32,000 characters.");
    const lease = state.leases.get(callerId);
    if (!lease) throw new WorkflowError("conflict", "This parent has no active owned turn.");
    const issues = await this.ports.validateSeat(
      parent.request.seat,
      state.workspace,
      input.access,
    );
    if (issues.length) throw new WorkflowError("unsupported", issues.join(" "));
    const parentSignal = this.signal(state, callerId),
      signal = callSignal ? AbortSignal.any([parentSignal, callSignal]) : parentSignal;
    signal.throwIfAborted();
    const member = new AbortController();
    const aborted = () => member.abort(new Error("Workflow delegation canceled."));
    signal.addEventListener("abort", aborted, { once: true });
    try {
      return await lease.whileWaiting(async () => {
        const agentId = randomUUID();
        await this.createOwned(
          state,
          this.request(state, {
            agentId,
            role: "worker",
            seat: parent.request.seat,
            title: `Delegated: ${parent.request.title}`.slice(0, 240),
            access: input.access,
            parentAgentId: callerId,
            autonomous: depth < 3,
            delegationDepth: depth,
            toolGroups: parent.request.toolGroups,
          }),
          member,
        );
        const result = await this.beginTurn(state, agentId, input.task);
        signal.throwIfAborted();
        return { ...result, agentId };
      });
    } finally {
      signal.removeEventListener("abort", aborted);
    }
  }
  private state(ref: WorkflowRef): ActiveWorkflow {
    const state = this.active.get(ref.id);
    const own = state?.entry.ref;
    if (
      !state ||
      !own ||
      own.id !== ref.id ||
      own.kind !== ref.kind ||
      own.location !== ref.location ||
      own.storeKey !== ref.storeKey ||
      own.scope.hostId !== ref.scope.hostId ||
      own.scope.projectId !== ref.scope.projectId
    )
      throw new WorkflowError("unavailable", "This Workflow is not active at the selected origin.");
    return state;
  }
  async declarePlan(
    ref: WorkflowRef,
    raw: RunPlan,
    callerAgentId?: string,
  ): Promise<WorkflowEntry> {
    const state = this.state(ref);
    if (state.launch.kind !== "ai" || state.plan || state.admitted || state.abort.signal.aborted)
      throw new WorkflowError("conflict", "This Workflow is no longer accepting its initial plan.");
    if (callerAgentId && callerAgentId !== state.run.conductorAgentId)
      throw new WorkflowError("invalid", "Only this Workflow's conductor may declare its plan.");
    const plan = RunPlanSchema.parse(raw);
    plan.autopilot = state.launch.definition.autopilot;
    await validatePlan(this.ports, state, plan);
    state.abort.signal.throwIfAborted();
    if (state.plan) throw new WorkflowError("conflict", "The Workflow plan was already declared.");
    const projected = buildRunFromPlan({
      plan,
      id: state.run.id,
      now: this.ports.now(),
      conductorAgentId: state.run.conductorAgentId,
      cwd: state.workspace.cwd,
      workspaceId: state.workspace.workspaceId,
    });
    state.plan = structuredClone(plan);
    Object.assign(state.run, projected, {
      status: plan.autopilot ? "pending" : "paused",
      awaitingStartConfirmation: !plan.autopilot,
      declaredPlan: structuredClone(plan),
      startShape: describeRunPlanStart(plan),
    });
    await this.publish(state, state.run);
    if (plan.autopilot) {
      state.admitted = true;
      this.launchEngine(state);
    }
    return structuredClone(state.entry);
  }
  async control(
    ref: WorkflowRef,
    revision: string,
    action: "cancel" | "approve" | "reject",
    phaseId?: string,
    note?: string,
  ): Promise<WorkflowEntry> {
    const state = this.state(ref);
    if (state.entry.revision !== revision)
      throw new WorkflowError(
        "conflict",
        "Workflow changed. Refresh before applying this decision.",
      );
    if (action === "cancel" || (action === "reject" && !phaseId))
      return this.requestCancel(ref.id, note ?? "Workflow canceled by the user.");
    if (phaseId) {
      const decide = state.gates.get(phaseId);
      if (!decide)
        throw new WorkflowError("conflict", "This gate is no longer awaiting a decision.");
      decide({ approved: action === "approve", note });
      return structuredClone(state.entry);
    }
    if (action !== "approve" || !state.plan || state.admitted)
      throw new WorkflowError("conflict", "This Workflow has no plan awaiting start confirmation.");
    state.admitted = true;
    state.run.awaitingStartConfirmation = false;
    state.run.status = "pending";
    await this.publish(state, state.run);
    this.launchEngine(state);
    return structuredClone(state.entry);
  }
  private gate(state: ActiveWorkflow, phaseId: string, signal: AbortSignal) {
    return new Promise<{ approved: boolean; note?: string }>((resolve, reject) => {
      signal.throwIfAborted();
      const aborted = () => {
        state.gates.delete(phaseId);
        reject(signal.reason);
      };
      state.gates.set(phaseId, (value) => {
        state.gates.delete(phaseId);
        signal.removeEventListener("abort", aborted);
        resolve(value);
      });
      signal.addEventListener("abort", aborted, { once: true });
    });
  }
  private async spawnPlan(state: ActiveWorkflow, input: RunEngineSpawnInput) {
    const judge = input.phaseType === "verify";
    const phase = state.plan?.phases.find((value) => value.id === input.phaseId);
    let access = phase ? planPhaseAccess(phase) : "write";
    if (judge && phase?.type !== "verify") access = "read";
    const seat = judge ? seatsFor(state.launch).judge : seatsFor(state.launch).worker;
    const agentId = randomUUID();
    await this.createOwned(
      state,
      this.request(state, {
        agentId,
        role: judge ? "judge" : "worker",
        seat,
        title: `${state.run.title}: ${input.phaseId}`,
        access,
      }),
    );
    this.beginTurn(state, agentId, input.task);
    return { agentId };
  }
  private async spawnGraph(state: ActiveWorkflow, input: GraphEngineSpawnInput) {
    const seat = input.model ? parseGraphSeat(input.model) : seatsFor(state.launch)[input.purpose];
    const agentId = randomUUID();
    await this.createOwned(
      state,
      this.request(state, {
        agentId,
        role: input.purpose,
        seat,
        title: input.title,
        access: input.purpose === "judge" ? "read" : graphAccess(input.access),
        outputFields: input.outputFields,
        toolGroups: input.toolGroups,
        queryTools: input.queryTools,
        autonomous: input.policy === "autonomous",
      }),
    );
    this.beginTurn(state, agentId, input.task);
    return { agentId };
  }
  private launchEngine(state: ActiveWorkflow) {
    if (state.engine) throw new WorkflowError("conflict", "Workflow execution is already running.");
    // Planning belongs to the conductor's lifetime. The execution deadline begins only after admission.
    state.deadline = setTimeout(
      () => {
        void this.requestCancel(state.run.id, "Workflow time limit reached.").catch((error) =>
          this.ports.logger.error(
            { error, runId: state.run.id },
            "Workflow deadline cancellation failed",
          ),
        );
      },
      limitsFor(state.launch).timeoutMinutes * 60000,
    );
    state.deadline.unref();
    const common = {
      awaitAgent: async ({ agentId }: { agentId: string }) => {
        const turn = state.turns.get(agentId);
        if (!turn) throw new WorkflowError("invalid", "No owned turn was admitted for this agent.");
        return turn;
      },
      cancelAgent: async ({ agentId }: { agentId: string }) => {
        if (state.agents.has(agentId)) await this.ports.cancelAgent(agentId);
      },
      awaitGate: ({ phaseId, signal }: { phaseId: string; signal: AbortSignal }) =>
        this.gate(state, phaseId, signal),
      emit: (run: Run) => this.publish(state, run),
      now: () => this.ports.now(),
      logger: this.ports.logger,
    };
    const limits = limitsFor(state.launch);
    const caps = { ...limits, maxAgents: Math.max(0, limits.maxAgents - 1) };
    const execute = async () => {
      if (state.run.conductorAgentId) {
        await state.turns.get(state.run.conductorAgentId);
        await this.ports.waitUntilIdle(state.run.conductorAgentId, state.abort.signal);
        state.abort.signal.throwIfAborted();
      }
      if (state.launch.kind === "graph") {
        const port: GraphEnginePort = {
          ...common,
          spawn: (input) => this.spawnGraph(state, input),
          notifyOrchestrator: async ({ text }) => {
            if (state.abort.signal.aborted) return;
            if (isTerminalRunStatus(state.run.status)) await this.deliverCompletion(state, text);
            else await this.ports.notice(state.run.conductorAgentId!, text);
          },
          renderPromptTemplate: ({ ref, graphInputs, upstreamFields }) =>
            renderWorkflowTemplate({
              id: ref.templateId,
              templates:
                state.launch.kind === "graph"
                  ? (state.launch.templateSnapshots ?? []).map((snapshot) => snapshot.template)
                  : [],
              variables: workflowTemplateVariables(ref, graphInputs, upstreamFields),
              allowCode: state.launch.kind === "graph" && state.launch.allowTemplateCode === true,
              signal: state.abort.signal,
            }),
        };
        await executeGraphRun({
          run: state.run,
          graph: state.launch.graph,
          graphInputs: state.launch.inputs,
          caps,
          signal: state.abort.signal,
          port,
        });
      } else {
        const port: RunEnginePort = {
          ...common,
          resolveRole: async (role) => ({ personalityId: `captured:${role}` }),
          spawn: (input) => this.spawnPlan(state, input),
          continueAgent: async ({ agentId, task }) => {
            this.beginTurn(state, agentId, task);
          },
        };
        await executeRun({
          run: state.run,
          plan: state.plan!,
          caps,
          signal: state.abort.signal,
          port,
        });
        if (!state.abort.signal.aborted && state.run.conductorAgentId) {
          await this.deliverCompletion(
            state,
            formatStartRunCompletionNotification({ ...state.run, agentCount: state.agents.size }),
          );
        }
      }
    };
    state.engine = execute()
      .catch((error) => {
        state.run.status = state.cancelRequested ? "canceled" : "failed";
        state.run.error = error instanceof Error ? error.message : "Workflow execution failed.";
        state.abort.abort(error);
      })
      .then(() => this.finish(state))
      .catch((error) => {
        state.recoveryRequired = true;
        state.settlement.fail(error);
        this.ports.logger.error(
          { error, runId: state.run.id },
          "Workflow settlement requires recovery",
        );
      });
  }
  private async deliverCompletion(state: ActiveWorkflow, text: string): Promise<void> {
    const delivered = await this.beginTurn(
      state,
      state.run.conductorAgentId!,
      workflowPreview(text, 64000) ?? "Workflow settled.",
    );
    if (delivered.failed)
      state.run.completionDeliveryError =
        delivered.error ??
        "The conductor could not acknowledge the completed Workflow. The durable result remains available here.";
  }
  private async requestCancel(
    id: string,
    message: string,
    canceled = true,
  ): Promise<WorkflowEntry> {
    const state = this.active.get(id);
    if (!state) throw new WorkflowError("unavailable", "Workflow is no longer active.");
    state.cancelRequested ||= canceled;
    state.run.error = message;
    state.abort.abort(new Error(message));
    const cancels = [...state.agents.keys()].map((agentId) => this.ports.cancelAgent(agentId));
    await Promise.allSettled(cancels);
    if (!state.engine)
      state.engine = this.finish(state).catch((error) => {
        state.recoveryRequired = true;
        state.settlement.fail(error);
        this.ports.logger.error({ error, runId: id }, "Canceled Workflow requires recovery");
      });
    return structuredClone(state.entry);
  }
  private async finish(state: ActiveWorkflow): Promise<void> {
    if (state.closing) return;
    state.closing = true;
    if (state.deadline) clearTimeout(state.deadline);
    await Promise.allSettled(state.pending);
    await state.publications;
    const failures: unknown[] = [];
    for (const id of state.agents.keys()) {
      try {
        await this.ports.cancelAgent(id);
        await this.ports.closeAgent(id);
      } catch (error) {
        failures.push(error);
      }
    }
    if (state.failure || failures.length) {
      // Retain admission, last durable projection, owner bindings and journal for explicit recovery.
      throw new AggregateError(
        [state.failure, ...failures].filter(Boolean),
        "Workflow stopped after a persistence/runtime failure; recovery is required.",
      );
    }
    state.run.status = state.cancelRequested ? "canceled" : state.run.status;
    if (!isTerminalRunStatus(state.run.status)) state.run.status = "failed";
    await this.publish(state, state.run);
    await this.journal.update(state.run.id, null);
    this.releaseState(state);
  }
  private releaseState(state: ActiveWorkflow | undefined): void {
    if (state) {
      this.outputs.forget(state.entry.ref);
      if (state.deadline) clearTimeout(state.deadline);
      this.active.delete(state.run.id);
      for (const id of state.agents.keys()) this.bindings.delete(id);
      state.settlement.complete();
    }
    if (!this.active.size) {
      this.releaseObservation?.();
      this.releaseObservation = null;
      this.writers.clear();
    }
  }
  async settled(ref: WorkflowRef): Promise<void> {
    await this.active.get(ref.id)?.engine;
  }
  /** Schedule adapters wait through AI Planning and human gates, not just the current engine promise. */
  async waitForSettlement(ref: WorkflowRef, signal?: AbortSignal): Promise<WorkflowEntry> {
    const state = this.active.get(ref.id);
    if (state) {
      if (workflowRefKey(state.entry.ref) !== workflowRefKey(ref))
        throw new WorkflowError("invalid", "Select the exact Workflow run origin.");
      await state.settlement.wait(signal);
    }
    signal?.throwIfAborted();
    const entry = await this.library.read(ref);
    if (entry.document.kind !== "run" || !isTerminalRunStatus(entry.document.value.status))
      throw new WorkflowError(
        "unavailable",
        "Workflow settlement requires recovery on its owning host.",
      );
    return entry;
  }
  /** Explicit settlement after a runtime/storage failure. Never resumes a provider or replays work. */
  async reconcile(ref: WorkflowRef, expectedRevision: string): Promise<WorkflowEntry> {
    const key = workflowRefKey(ref);
    if (this.reconciling.has(key))
      throw new WorkflowError("busy", "Workflow recovery is already running.");
    this.reconciling.add(key);
    try {
      return await this.reconcileOwned(ref, expectedRevision);
    } finally {
      this.reconciling.delete(key);
    }
  }
  private async reconcileOwned(ref: WorkflowRef, expectedRevision: string): Promise<WorkflowEntry> {
    const record = (await this.journal.read()).find(
      (item) => workflowRefKey(item.ref) === workflowRefKey(ref),
    );
    if (!record)
      throw new WorkflowError(
        "conflict",
        "No retained active Workflow owns this origin. Refresh its history.",
      );
    const state = this.active.get(ref.id);
    if (state && !state.failure && !state.recoveryRequired)
      throw new WorkflowError(
        "busy",
        "This Workflow is still running or settling normally. Use its run controls.",
      );
    await this.reviewRecovery(ref, expectedRevision, record.ownerInstance);
    if (state) {
      state.cancelRequested = true;
      state.abort.abort(new Error("Explicit Workflow recovery"));
      await Promise.allSettled([...state.agents.keys()].map((id) => this.ports.cancelAgent(id)));
      await Promise.allSettled(state.pending);
      await state.engine;
    }
    await this.stopRetainedAgents(record);
    const { entry: current, run } = await this.reviewRecovery(
      ref,
      expectedRevision,
      record.ownerInstance,
    );
    const entry = await this.library.write(
      ref.scope,
      {
        kind: "run",
        value: {
          ...run,
          status: "canceled",
          error:
            "Interrupted Workflow explicitly settled. Existing output and edits are retained; no work was resumed.",
          updatedAt: this.ports.now(),
        },
      },
      current.revision,
      ref,
    );
    await this.journal.update(ref.id, null);
    this.releaseState(state);
    if (!this.ready && !(await this.journal.read()).length) {
      this.ready = true;
      this.startupMessage = null;
    }
    this.ports.changed?.(entry);
    return entry;
  }
  private async reviewRecovery(ref: WorkflowRef, revision: string, ownerInstance: string) {
    const entry = await this.library.read(ref);
    if (entry.revision !== revision || entry.document.kind !== "run")
      throw new WorkflowError("conflict", "Workflow changed since recovery review.");
    const run = entry.document.value;
    if (run.ownerInstance && run.ownerInstance !== ownerInstance)
      throw new WorkflowError("conflict", "This run now has a different owner.");
    return { entry, run };
  }
  private async stopRetainedAgents(record: ActiveWorkflowRecord): Promise<void> {
    for (const id of record.agentIds)
      if (await this.ports.ownsAgent(id, record.ref.id, record.ownerInstance)) {
        await this.ports.cancelAgent(id);
        await this.ports.closeAgent(id);
      }
  }
  async close(): Promise<void> {
    this.closed = true;
    this.reviews.clear();
    await Promise.allSettled(
      [...this.active.keys()].map((id) =>
        this.requestCancel(id, "Workflow interrupted by daemon shutdown."),
      ),
    );
    await Promise.allSettled(this.admissions);
    await Promise.allSettled(
      [...this.active.keys()].map((id) =>
        this.requestCancel(id, "Workflow interrupted by daemon shutdown."),
      ),
    );
    await Promise.allSettled([...this.active.values()].map((state) => state.engine));
    await this.journal.drain();
    this.releaseObservation?.();
    this.releaseObservation = null;
  }
}
