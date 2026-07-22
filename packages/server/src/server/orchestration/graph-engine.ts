import {
  type GraphEdge,
  type GraphNode,
  type GraphOutputField,
  type GraphQueryTool,
  type GraphSkipReason,
  type NodePromptTemplateRef,
  type OrchestrationGraph,
  type Run,
  type RunPhase,
  type RunPhaseCandidate,
  validateOrchestrationGraph,
} from "@otto-code/protocol/orchestration";
import { judgeVerdictPassed } from "@otto-code/protocol/judge-verdict";

import {
  type OrchestrationLogger,
  type RunEngineAwaitResult,
  type RunEngineCaps,
  type RunEngineSpawnResult,
  RunEngineError,
  buildJudgeTask,
  parseVerdict,
} from "./run-engine.js";
import { buildOutputInstruction, extractOutputFieldsFromProse } from "./node-output.js";
import {
  resolveEdgeCondition,
  selectCarriedFields,
  validateEdgeConditions,
} from "./edge-conditions.js";

// The deterministic-graph engine (projects/orchestration-graphs): executes a
// user-authored OrchestrationGraph exactly as drawn. Pure control flow over an
// injected port, mirroring run-engine.ts — no daemon deps, unit-testable with
// a fake port. Key semantics:
//
// - The single orchestrator node is NOT executed here: its agent (the run's
//   conductorAgentId) is spawned by the caller before execution and hosts the
//   orchestration chat. The engine routes node completions to it via
//   `notifyOrchestrator` — it activates when information arrives.
// - Fan-in is an all-inputs barrier held HERE: a node's agent is spawned only
//   when every upstream node has finished. Agents never know about waiting.
// - Loops are node-level annotations: `times` re-dispatches with the previous
//   iteration's output; `until` grades each iteration with a structured judge
//   (run-engine's verdict contract) and stops on pass or the hard `max`.
// - No fallbacks: a failed node fails the run and skips its downstream nodes;
//   independent branches already in flight run to completion.

export interface GraphEngineSpawnInput {
  nodeId: string;
  title: string;
  /** Team role to resolve (null ⇒ the node's explicit model must be used). */
  role: string | null;
  /** Explicit model override ("provider" or "provider/model"). */
  model: string | null;
  /** The fully assembled prompt (inputs substituted, upstream material inlined). */
  task: string;
  /** Tool policy the spawned agent must carry (see agent-labels). */
  policy: "deterministic" | "autonomous";
  /** 0-based loop iteration. */
  attempt: number;
  /** Worker does the node's work; judge grades an `until` iteration. */
  purpose: "worker" | "judge";
  /**
   * The node's declared output fields, when it has them. The port stamps them
   * on the spawned agent so its tool catalog can register submit_output —
   * which is how structured output reaches every provider identically.
   */
  outputFields?: GraphOutputField[];
  /** Workspace access ceiling for this node's agent ("none" | "read" | "write"). */
  access?: string;
  /** Per-node Otto tool-group allowlist; narrows what the spawned agent gets. */
  toolGroups?: string[];
  /** Read-only lookups registered for this agent alone. */
  queryTools?: GraphQueryTool[];
}

export interface GraphEnginePort {
  spawn(input: GraphEngineSpawnInput): Promise<RunEngineSpawnResult>;
  awaitAgent(input: { agentId: string; signal: AbortSignal }): Promise<RunEngineAwaitResult>;
  /**
   * Really stop one agent — used when a node hits its time limit. Racing a
   * timer against `awaitAgent` would only stop *waiting*; the agent would keep
   * running and keep spending. Best-effort: an agent that already settled is
   * not an error.
   */
  cancelAgent(input: { agentId: string }): Promise<void>;
  /** Deliver a labeled node completion (or the final wrap-up) to the orchestrator's chat. */
  notifyOrchestrator(input: { text: string }): Promise<void>;
  emit(run: Run): void | Promise<void>;
  now(): string;
  /**
   * Render a node's prompt from a stored template. Absent on hosts without the
   * template store — a node bound to a template then falls back to its inline
   * prompt, which is the same degradation as a deleted template.
   */
  renderPromptTemplate?(input: {
    ref: NodePromptTemplateRef;
    graphInputs: Record<string, string>;
    upstreamFields: Map<string, Record<string, unknown>>;
  }): Promise<string | null>;
  logger: OrchestrationLogger;
}

/** Substitute `{{inputs.key}}` references with the user's fill-in values. */
export function substituteGraphInputs(text: string, inputs: Record<string, string>): string {
  return text.replace(
    /\{\{\s*inputs\.([A-Za-z0-9_-]+)\s*\}\}/g,
    (whole, key: string) => inputs[key] ?? whole,
  );
}

/**
 * Build the initial Run projection for a graph execution. Pure. Worker nodes
 * project into `phases[]` (type "graph-node") so existing clients render the
 * run without a new list schema; `dependsOn` carries the drawn edges (root
 * edges excluded — they are ordering-only and satisfied at start).
 */
export function buildRunFromGraph(input: {
  graph: OrchestrationGraph;
  graphInputs: Record<string, string>;
  id: string;
  title: string;
  description?: string;
  now: string;
  status?: string;
  conductorAgentId?: string;
  cwd?: string;
  workspaceId?: string;
  teamId?: string;
  teamName?: string;
}): Run {
  // Structural problems first, then expression syntax — the latter needs the
  // JSONata parser, which is daemon-only (the designer's shared validator must
  // stay dependency-free for the client bundle).
  const problems = [
    ...validateOrchestrationGraph(input.graph),
    ...validateEdgeConditions(input.graph.edges ?? []),
  ];
  if (problems.length > 0) {
    throw new RunEngineError(`Graph is not executable: ${problems.join(" ")}`);
  }
  const phases = buildGraphPhases(input.graph, input.graphInputs);
  return {
    id: input.id,
    title: input.title,
    ...(input.description ? { description: input.description } : {}),
    status: input.status ?? "pending",
    kind: "graph",
    graphId: input.graph.id,
    graphInputs: input.graphInputs,
    phases,
    ...(input.conductorAgentId ? { conductorAgentId: input.conductorAgentId } : {}),
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    ...(input.teamId ? { teamId: input.teamId } : {}),
    ...(input.teamName ? { teamName: input.teamName } : {}),
    agentCount: 0,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

// Project worker nodes into RunPhases (type "graph-node") with edge-derived
// dependsOn; root edges are ordering-only and excluded.
function buildGraphPhases(
  graph: OrchestrationGraph,
  graphInputs: Record<string, string>,
): RunPhase[] {
  const root = graph.nodes.find((node) => node.kind === "orchestrator");
  const workers = graph.nodes.filter((node) => node.kind !== "orchestrator");
  const workerIds = new Set(workers.map((node) => node.id));
  return workers.map((node) => {
    const dependsOn = (graph.edges ?? [])
      .filter((edge) => edge.to === node.id && edge.from !== root?.id && workerIds.has(edge.from))
      .map((edge) => edge.from);
    const phase: RunPhase = {
      id: node.id,
      type: "graph-node",
      title: node.title,
      task: buildNodeBasePrompt(node, graphInputs) || node.title,
      status: "pending",
    };
    if (node.role) {
      phase.assigneeRole = node.role;
    }
    if (dependsOn.length > 0) {
      phase.dependsOn = dependsOn;
    }
    return phase;
  });
}

/** The node's own instruction: fixed prompt (inputs substituted) + bound input value. */
function buildNodeBasePrompt(node: GraphNode, inputs: Record<string, string>): string {
  const parts: string[] = [];
  if (node.prompt?.trim()) {
    parts.push(substituteGraphInputs(node.prompt.trim(), inputs));
  }
  if (node.promptFromInput) {
    const value = inputs[node.promptFromInput]?.trim();
    if (value) {
      parts.push(value);
    }
  }
  return parts.join("\n\n");
}

// A node settles three ways, not two. `skipped` is control flow routing around
// the node — an ordinary outcome that must never read as an error, and never as
// silence: every skip carries a reason so the run can say why part of the graph
// didn't run. Adding the third state before conditional edges exist is
// deliberate; threading it through joins and the wrap-up afterwards is strictly
// harder.
type NodeResult =
  | { status: "done"; output: string | null; fields: Record<string, unknown> | null }
  | { status: "failed" }
  | { status: "skipped"; reason: GraphSkipReason };

/** One upstream node's contribution to a downstream node's task. */
interface UpstreamMaterial {
  nodeId: string;
  title: string;
  output: string;
  fields: Record<string, unknown> | null;
}

const SKIP_SENTENCES: Record<GraphSkipReason, string> = {
  condition: "A condition on an incoming edge routed around this node.",
  "upstream-skipped": "An upstream node was skipped.",
  "upstream-failed": "An upstream node failed.",
  canceled: "Run canceled.",
};

// Minimal counting semaphore — bounds concurrent child agents without waves
// (a node whose inputs are ready never waits on an unrelated branch).
class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(limit: number) {
    this.available = Math.max(1, limit);
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
      return;
    }
    this.available += 1;
  }
}

interface GraphRunContext {
  run: Run;
  graph: OrchestrationGraph;
  inputs: Record<string, string>;
  caps: RunEngineCaps;
  signal: AbortSignal;
  port: GraphEnginePort;
  semaphore: Semaphore;
  agentsSpawned: number;
  /** First hard failure message (names the node), if any. */
  failure: string | null;
  /** Final output per completed node, for the deliverables wrap-up. */
  outputsById: Map<string, string>;
}

/**
 * Execute a graph run to completion. Mutates the working copy of `run`,
 * emitting on every state change, and returns the terminal Run. Expected
 * outcomes (node failure, cancel, cap trip) become a terminal run status —
 * this only throws if the port itself throws unexpectedly.
 */
export async function executeGraphRun(input: {
  run: Run;
  graph: OrchestrationGraph;
  graphInputs: Record<string, string>;
  caps: RunEngineCaps;
  signal: AbortSignal;
  port: GraphEnginePort;
}): Promise<Run> {
  const ctx: GraphRunContext = {
    run: input.run,
    graph: input.graph,
    inputs: input.graphInputs,
    caps: input.caps,
    signal: input.signal,
    port: input.port,
    semaphore: new Semaphore(input.caps.maxConcurrency),
    agentsSpawned: 0,
    failure: null,
    outputsById: new Map(),
  };
  const { run, port } = ctx;
  run.status = "running";
  run.updatedAt = port.now();
  await port.emit(run);

  const root = ctx.graph.nodes.find((node) => node.kind === "orchestrator");
  const workers = ctx.graph.nodes.filter((node) => node.kind !== "orchestrator");
  // Incoming edges, not just upstream ids: a condition and a field selection
  // belong to the edge, so two edges between the same pair are two different
  // deliveries.
  const incomingByNode = new Map<string, GraphEdge[]>();
  for (const node of workers) {
    incomingByNode.set(
      node.id,
      (ctx.graph.edges ?? []).filter(
        (edge) =>
          edge.to === node.id &&
          edge.from !== root?.id &&
          workers.some((candidate) => candidate.id === edge.from),
      ),
    );
  }

  // One memoized promise per node; a node awaits its upstream promises, so the
  // schedule is event-driven (no barrier waves) and the DAG check in
  // buildRunFromGraph guarantees termination.
  const results = new Map<string, Promise<NodeResult>>();
  const runNode = (node: GraphNode): Promise<NodeResult> => {
    const existing = results.get(node.id);
    if (existing) {
      return existing;
    }
    const promise = executeNode(ctx, node, incomingByNode.get(node.id) ?? [], runNode);
    results.set(node.id, promise);
    return promise;
  };

  await Promise.all(workers.map((node) => runNode(node)));

  if (ctx.signal.aborted) {
    run.status = "canceled";
    run.error = run.error ?? "Orchestration canceled.";
  } else if (ctx.failure) {
    run.status = "failed";
    run.error = ctx.failure;
  } else {
    run.status = "done";
  }
  run.updatedAt = port.now();
  await port.emit(run);
  await safeNotify(ctx, buildWrapUpMessage(run, collectDeliverables(ctx, root)));
  return run;
}

// The graph's final answers are whatever nothing else consumes: a node with no
// downstream node is producing for the user, so its full output lands in the
// wrap-up for the orchestrator to relay rather than a recap of everything.
// (Every node's completion still streamed into the chat as it happened.)
//
// The root has no input port — it is the entry point, fed by the orchestration's
// own prompt — but graphs authored before that carried explicit deliver-back
// edges into it, and those still count.
function collectDeliverables(
  ctx: GraphRunContext,
  root: GraphNode | undefined,
): Array<{ title: string; output: string }> {
  const edges = ctx.graph.edges ?? [];
  const workers = ctx.graph.nodes.filter((node) => node.kind !== "orchestrator");
  const consumed = new Set(edges.filter((edge) => edge.to !== root?.id).map((edge) => edge.from));
  const deliverables: Array<{ title: string; output: string }> = [];
  for (const node of workers) {
    const isDeliverable =
      !consumed.has(node.id) || edges.some((edge) => edge.from === node.id && edge.to === root?.id);
    const output = ctx.outputsById.get(node.id);
    if (isDeliverable && output !== undefined) {
      deliverables.push({ title: node.title, output });
    }
  }
  return deliverables;
}

async function executeNode(
  ctx: GraphRunContext,
  node: GraphNode,
  incoming: GraphEdge[],
  runNode: (node: GraphNode) => Promise<NodeResult>,
): Promise<NodeResult> {
  const phase = ctx.run.phases.find((candidate) => candidate.id === node.id);
  const upstreams = incoming.flatMap((edge) => {
    const upstream = ctx.graph.nodes.find((candidate) => candidate.id === edge.from);
    return upstream ? [{ edge, node: upstream }] : [];
  });
  // Awaiting every upstream before deciding anything is what lets the
  // memoised-promise schedule carry conditional edges with no fixed-point
  // pass: by the time this node decides, nothing it read can still change.
  const settled: SettledUpstream[] = await Promise.all(
    upstreams.map(async (upstream): Promise<SettledUpstream> => {
      const result = await runNode(upstream.node);
      return { edge: upstream.edge, node: upstream.node, result };
    }),
  );

  if (ctx.signal.aborted) {
    await markSkipped(ctx, phase, "canceled");
    return { status: "skipped", reason: "canceled" };
  }
  if (settled.some((upstream) => upstream.result.status === "failed")) {
    await markSkipped(ctx, phase, "upstream-failed");
    return { status: "skipped", reason: "upstream-failed" };
  }

  const gate = await resolveIncomingEdges(node, settled);
  if (gate.status === "error") {
    return failNode(ctx, node, phase, gate.message);
  }
  if (gate.status === "skip") {
    await markSkipped(ctx, phase, gate.reason, gate.detail);
    return { status: "skipped", reason: gate.reason };
  }
  const upstreamMaterial = gate.material;

  try {
    const dispatched = await dispatchNode(ctx, node, phase, upstreamMaterial);
    if (dispatched.output !== null) {
      ctx.outputsById.set(node.id, dispatched.output);
    }
    if (phase) {
      phase.status = "done";
      phase.completedAt = ctx.port.now();
      ctx.run.updatedAt = ctx.port.now();
      await ctx.port.emit(ctx.run);
    }
    await safeNotify(
      ctx,
      `Node "${node.title}" finished.\n\n${truncateForChat(dispatched.output ?? "(no output)")}`,
    );
    return { status: "done", output: dispatched.output, fields: dispatched.fields };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.failure = ctx.failure ?? `Node "${node.title}" failed: ${message}`;
    if (phase) {
      phase.status = "failed";
      phase.notes = message;
      phase.completedAt = ctx.port.now();
      ctx.run.updatedAt = ctx.port.now();
      await ctx.port.emit(ctx.run);
    }
    await safeNotify(ctx, `Node "${node.title}" FAILED: ${truncateForChat(message)}`);
    return { status: "failed" };
  }
}

async function failNode(
  ctx: GraphRunContext,
  node: GraphNode,
  phase: RunPhase | undefined,
  message: string,
): Promise<NodeResult> {
  ctx.failure = ctx.failure ?? `Node "${node.title}" failed: ${message}`;
  if (phase) {
    phase.status = "failed";
    phase.notes = message;
    phase.completedAt = ctx.port.now();
    ctx.run.updatedAt = ctx.port.now();
    await ctx.port.emit(ctx.run);
  }
  await safeNotify(ctx, `Node "${node.title}" FAILED: ${truncateForChat(message)}`);
  return { status: "failed" };
}

interface SettledUpstream {
  edge: GraphEdge;
  node: GraphNode;
  result: NodeResult;
}

type IncomingGate =
  | { status: "run"; material: UpstreamMaterial[] }
  | { status: "skip"; reason: GraphSkipReason; detail?: string }
  | { status: "error"; message: string };

/**
 * Decide whether this node runs, from the state of its incoming edges.
 *
 * A drawn edge is a *requirement*, so the rule is: run when at least one edge
 * delivers and none was ruled out by its own condition. That distinction —
 * between an edge whose condition said no (this node is not on the taken path)
 * and an edge whose upstream was itself skipped (the path died further back) —
 * is what makes a diamond work: a join below two conditional branches still
 * runs off whichever branch executed, because the pruned side reaches it as
 * *upstream-skipped* rather than as a veto.
 */
async function resolveIncomingEdges(
  node: GraphNode,
  settled: SettledUpstream[],
): Promise<IncomingGate> {
  if (settled.length === 0) {
    return { status: "run", material: [] };
  }
  const material: UpstreamMaterial[] = [];
  let vetoedBy: string | null = null;
  for (const upstream of settled) {
    if (upstream.result.status !== "done") {
      continue; // skipped upstream: contributes nothing, vetoes nothing.
    }
    const resolution = await resolveEdgeCondition(upstream.edge, {
      fields: upstream.result.fields,
      output: upstream.result.output,
    });
    if (resolution.status === "error") {
      return { status: "error", message: resolution.message };
    }
    if (resolution.status === "inactive") {
      vetoedBy = vetoedBy ?? upstream.node.title;
      continue;
    }
    material.push({
      nodeId: upstream.node.id,
      title: upstream.node.title,
      output: upstream.result.output ?? "",
      fields: selectCarriedFields(upstream.result.fields, upstream.edge.fields),
    });
  }
  if (vetoedBy) {
    return {
      status: "skip",
      reason: "condition",
      detail: `The condition on the edge from "${vetoedBy}" chose another branch.`,
    };
  }
  if (material.length === 0) {
    return {
      status: "skip",
      reason: "upstream-skipped",
      detail: `Every node feeding "${node.title}" was skipped.`,
    };
  }
  return { status: "run", material };
}

// Record a skip on the projection: the machine-readable reason for clients and
// the sentence for humans. Never touches an already-settled phase.
async function markSkipped(
  ctx: GraphRunContext,
  phase: RunPhase | undefined,
  reason: GraphSkipReason,
  detail?: string,
): Promise<void> {
  if (!phase || phase.status !== "pending") {
    return;
  }
  phase.status = "skipped";
  phase.skipReason = reason;
  phase.notes = detail ?? SKIP_SENTENCES[reason];
  phase.completedAt = ctx.port.now();
  ctx.run.updatedAt = ctx.port.now();
  await ctx.port.emit(ctx.run);
}

// Run one node to completion, including its loop annotation. Returns the final
// output. Throws on hard failure (agent error, judge never passing, cap trip).
/**
 * Run a node, retrying transient failure within its policy.
 *
 * One loop, one counter, and every attempt spawns through the same capped path
 * — so a retry is charged to the run's agent budget like any other agent. The
 * failure path never re-enters this function: retry that can be triggered from
 * inside a failure handler compounds without bound, which is a real failure
 * mode in the prior art this design learned from.
 */
async function dispatchNode(
  ctx: GraphRunContext,
  node: GraphNode,
  phase: RunPhase | undefined,
  upstream: UpstreamMaterial[],
): Promise<NodeDispatchResult> {
  const maxAttempts = Math.max(1, node.retry?.maxAttempts ?? 1);
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      const backoff = backoffDelayMs(node.retry, attempt);
      ctx.port.logger.warn(
        { nodeId: node.id, attempt, backoff },
        "Retrying node after a failed attempt",
      );
      await delay(backoff, ctx.signal);
      if (phase) {
        phase.retryAttempts = attempt;
        ctx.run.updatedAt = ctx.port.now();
        await ctx.port.emit(ctx.run);
      }
    }
    try {
      return await dispatchNodeAttempt(ctx, node, phase, upstream);
    } catch (error) {
      // A cancelled run is not a transient failure — stop immediately.
      if (ctx.signal.aborted) {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function backoffDelayMs(retry: GraphNode["retry"], attempt: number): number {
  if (!retry) {
    return 0;
  }
  const multiplier = retry.multiplier ?? 2;
  return Math.round(retry.backoffMs * Math.pow(multiplier, attempt - 1));
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  // Whichever comes first — a backoff must never outlive the run it belongs to,
  // so a cancel ends the wait immediately.
  return Promise.race([
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    }),
    new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true });
    }),
  ]);
}

async function dispatchNodeAttempt(
  ctx: GraphRunContext,
  node: GraphNode,
  phase: RunPhase | undefined,
  upstream: UpstreamMaterial[],
): Promise<NodeDispatchResult> {
  const basePrompt = await resolveNodePrompt(ctx, node, upstream);
  const declaredFields = node.output?.fields ?? null;
  const until = node.loop?.until;
  const times = node.loop?.times ?? 1;
  const maxAttempts = until ? until.max : times;

  let last: NodeDispatchResult = { output: null, fields: null };
  let judgeFeedback: string | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (ctx.signal.aborted) {
      throw new RunEngineError("Run canceled.", node.id);
    }
    const task = assembleNodeTask({
      basePrompt,
      upstream,
      declaredFields,
      previousOutput: attempt > 0 ? last.output : null,
      judgeFeedback,
      iteration: attempt,
      totalIterations: until ? null : times,
    });
    last = await spawnAndAwait(ctx, node, phase, {
      ...buildWorkerSpawn(node, declaredFields),
      task,
      attempt,
    });

    if (!until) {
      continue; // fixed `times` loop: every iteration runs, last output wins.
    }
    const graded = await judgeIteration(ctx, node, phase, {
      until,
      basePrompt,
      output: last.output,
      attempt,
    });
    if (graded.passed) {
      return last;
    }
    judgeFeedback = graded.feedback;
  }

  if (until) {
    throw new RunEngineError(
      `Never passed the judge within ${until.max} iteration${until.max === 1 ? "" : "s"}.`,
      node.id,
    );
  }
  return last;
}

// Everything about a worker spawn that comes from the node itself rather than
// from the iteration. Authority (tools, lookups) is deliberately the node's
// alone: a judge grades output and never needs the node's reach.
function buildWorkerSpawn(
  node: GraphNode,
  declaredFields: GraphOutputField[] | null,
): Omit<SpawnRequest, "task" | "attempt"> {
  return {
    role: node.role ?? null,
    model: node.model ?? null,
    policy: node.autonomous ? "autonomous" : "deterministic",
    purpose: "worker",
    ...(declaredFields ? { outputFields: declaredFields } : {}),
    ...(node.access ? { access: node.access } : {}),
    ...(node.tools ? { toolGroups: node.tools } : {}),
    ...(node.queryTools?.length ? { queryTools: node.queryTools } : {}),
  };
}

// Grade one `until` iteration with a structured judge; a pass ends the loop,
// a fail returns the feedback the next iteration must address.
async function judgeIteration(
  ctx: GraphRunContext,
  node: GraphNode,
  phase: RunPhase | undefined,
  input: {
    until: NonNullable<NonNullable<GraphNode["loop"]>["until"]>;
    basePrompt: string;
    output: string | null;
    attempt: number;
  },
): Promise<{ passed: boolean; feedback: string }> {
  const judged = await spawnAndAwait(ctx, node, phase, {
    role: input.until.judgeRole ?? "judger",
    model: null,
    task: buildJudgeTask({
      originalTask: input.basePrompt || node.title,
      candidateOutput: input.output ?? "(no output)",
      criteria: input.until.criteria,
    }),
    policy: "deterministic",
    attempt: input.attempt,
    purpose: "judge",
  });
  const verdict = parseVerdict(judged.output);
  const candidates = phase?.candidates;
  const lastCandidate = candidates?.[candidates.length - 1];
  if (lastCandidate && verdict) {
    lastCandidate.verdict = verdict;
  }
  if (verdict && judgeVerdictPassed(verdict)) {
    if (phase) {
      phase.notes = `Passed judge on iteration ${input.attempt + 1} of ${input.until.max}.`;
    }
    return { passed: true, feedback: "" };
  }
  return {
    passed: false,
    feedback: verdict?.summary ?? "The judge failed the previous iteration.",
  };
}

// Spawn one agent for a node iteration, record it on the phase, and await its
// terminal output. Applies the concurrency semaphore and the total-agents cap.
interface NodeDispatchResult {
  output: string | null;
  fields: Record<string, unknown> | null;
}

/**
 * The node's own instruction — from its bound template when it has one, and
 * from its inline prompt otherwise.
 *
 * A template that can't be rendered (deleted, bad syntax, host without the
 * store) falls back to the inline prompt and logs. This is the one place a
 * fallback is right: the alternative is that removing a shared snippet breaks
 * every graph that referenced it, and a node with a stale prompt is a far
 * better failure than a run that won't start.
 */
async function resolveNodePrompt(
  ctx: GraphRunContext,
  node: GraphNode,
  upstream: UpstreamMaterial[],
): Promise<string> {
  const inline = buildNodeBasePrompt(node, ctx.inputs);
  const ref = node.promptTemplate;
  if (!ref || !ctx.port.renderPromptTemplate) {
    return inline;
  }
  const upstreamFields = new Map<string, Record<string, unknown>>();
  for (const material of upstream) {
    if (material.fields) {
      upstreamFields.set(material.nodeId, material.fields);
    }
  }
  try {
    const rendered = await ctx.port.renderPromptTemplate({
      ref,
      graphInputs: ctx.inputs,
      upstreamFields,
    });
    if (rendered?.trim()) {
      return inline ? `${rendered}\n\n${inline}` : rendered;
    }
  } catch (error) {
    ctx.port.logger.error(
      { err: error, nodeId: node.id, templateId: ref.templateId },
      "Prompt template failed to render; using the node's inline prompt",
    );
  }
  return inline;
}

/**
 * Await one agent, bounded by the node's time limit.
 *
 * The limit has to *cancel*, not just stop waiting: an abandoned agent keeps
 * running and keeps spending, which is the difference between a time limit and
 * a wishful one. Otto can do this because node agents are managed processes.
 */
async function awaitWithTimeLimit(
  ctx: GraphRunContext,
  node: GraphNode,
  phase: RunPhase | undefined,
  agentId: string,
): Promise<RunEngineAwaitResult> {
  const limit = node.timeoutMs;
  if (!limit) {
    return ctx.port.awaitAgent({ agentId, signal: ctx.signal });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      void ctx.port
        .cancelAgent({ agentId })
        .catch((error: unknown) =>
          ctx.port.logger.error({ err: error, agentId }, "Time-limit cancel failed"),
        );
      reject(
        new RunEngineError(
          `Reached its ${Math.round(limit / 1000)}s time limit; the agent was canceled.`,
          node.id,
        ),
      );
    }, limit);
  });
  try {
    return await Promise.race([ctx.port.awaitAgent({ agentId, signal: ctx.signal }), expiry]);
  } finally {
    clearTimeout(timer);
    if (timedOut && phase) {
      phase.timedOut = true;
    }
  }
}

interface SpawnRequest {
  role: string | null;
  model: string | null;
  task: string;
  policy: "deterministic" | "autonomous";
  attempt: number;
  purpose: "worker" | "judge";
  outputFields?: GraphOutputField[];
  access?: string;
  toolGroups?: string[];
  queryTools?: GraphQueryTool[];
}

async function spawnAndAwait(
  ctx: GraphRunContext,
  node: GraphNode,
  phase: RunPhase | undefined,
  input: SpawnRequest,
): Promise<NodeDispatchResult> {
  if (ctx.agentsSpawned >= ctx.caps.maxAgents) {
    throw new RunEngineError(
      `Agent cap reached (${ctx.caps.maxAgents}) — the run stops rather than sprawl.`,
      node.id,
    );
  }
  await ctx.semaphore.acquire();
  try {
    if (ctx.signal.aborted) {
      throw new RunEngineError("Run canceled.", node.id);
    }
    ctx.agentsSpawned += 1;
    ctx.run.agentCount = ctx.agentsSpawned;
    const spawned = await ctx.port.spawn({
      nodeId: node.id,
      title: input.purpose === "judge" ? `Judge: ${node.title}` : node.title,
      role: input.role,
      model: input.model,
      task: input.task,
      policy: input.policy,
      attempt: input.attempt,
      purpose: input.purpose,
      ...(input.outputFields ? { outputFields: input.outputFields } : {}),
      ...(input.access ? { access: input.access } : {}),
      ...(input.toolGroups ? { toolGroups: input.toolGroups } : {}),
      ...(input.queryTools ? { queryTools: input.queryTools } : {}),
    });
    if (phase) {
      const candidate: RunPhaseCandidate = {
        agentId: spawned.agentId,
        ...(spawned.personalityId ? { personalityId: spawned.personalityId } : {}),
      };
      phase.candidates = [...(phase.candidates ?? []), candidate];
      if (phase.status === "pending") {
        phase.status = "running";
        phase.startedAt = ctx.port.now();
      }
      ctx.run.updatedAt = ctx.port.now();
      await ctx.port.emit(ctx.run);
    }
    const awaited = await awaitWithTimeLimit(ctx, node, phase, spawned.agentId);
    if (awaited.failed) {
      throw new RunEngineError(
        input.purpose === "judge" ? "The judge agent failed." : "The node's agent failed.",
        node.id,
      );
    }
    const fields = input.outputFields
      ? harvestOutputFields(node, input.outputFields, awaited)
      : null;
    if (input.purpose === "worker") {
      recordWorkerResult(phase, spawned.agentId, awaited.finalMessage, fields);
    }
    return { output: awaited.finalMessage, fields };
  } finally {
    ctx.semaphore.release();
  }
}

// Attach what a worker produced to its candidate row on the phase, so the
// Orchestrations page and any later phase read it from the run record.
function recordWorkerResult(
  phase: RunPhase | undefined,
  agentId: string,
  finalMessage: string | null,
  fields: Record<string, unknown> | null,
): void {
  const candidate = phase?.candidates?.find((entry) => entry.agentId === agentId);
  if (!candidate) {
    return;
  }
  if (finalMessage) {
    candidate.summary = finalMessage;
  }
  if (fields) {
    candidate.outputFields = fields;
  }
}

/**
 * Take what the node actually produced against what it declared.
 *
 * The submit_output tool is the contract, and a node that declared fields and
 * never delivered them has failed at its job — but a model that wrote correct
 * JSON in prose instead of calling the tool has done the work, and small local
 * models do this often enough that discarding it would be the wrong kind of
 * strict. So: tool call first, prose second, failure third — and the failure
 * names the contract so the author can see what was missing.
 */
function harvestOutputFields(
  node: GraphNode,
  declared: readonly GraphOutputField[],
  awaited: RunEngineAwaitResult,
): Record<string, unknown> {
  if (awaited.submittedOutput) {
    return awaited.submittedOutput;
  }
  const recovered = extractOutputFieldsFromProse(declared, awaited.finalMessage);
  if (recovered) {
    return recovered;
  }
  throw new RunEngineError(
    `Declared output fields (${declared
      .map((field) => field.key)
      .join(
        ", ",
      )}) but never submitted them — the submit_output tool was not called and the final message had no matching object.`,
    node.id,
  );
}

function assembleNodeTask(input: {
  basePrompt: string;
  upstream: UpstreamMaterial[];
  declaredFields: GraphOutputField[] | null;
  previousOutput: string | null;
  judgeFeedback: string | null;
  iteration: number;
  totalIterations: number | null;
}): string {
  const parts: string[] = [];
  if (input.basePrompt) {
    parts.push(input.basePrompt);
  }
  for (const material of input.upstream) {
    // Structured fields go first and labelled: they are the part a downstream
    // node can act on without re-reading anything. The prose still follows —
    // it carries the reasoning the fields deliberately don't.
    if (material.fields) {
      parts.push(
        `Input from "${material.title}" (fields):\n\`\`\`json\n${JSON.stringify(
          material.fields,
          null,
          2,
        )}\n\`\`\``,
      );
    }
    if (material.output.trim()) {
      parts.push(`Input from "${material.title}":\n${material.output.trim()}`);
    }
  }
  if (input.totalIterations !== null && input.totalIterations > 1) {
    parts.push(`This is iteration ${input.iteration + 1} of ${input.totalIterations}.`);
  }
  if (input.previousOutput?.trim()) {
    parts.push(`Your previous iteration produced:\n${input.previousOutput.trim()}`);
  }
  if (input.judgeFeedback?.trim()) {
    parts.push(
      `A judge reviewed the previous iteration and failed it. Address this feedback:\n${input.judgeFeedback.trim()}`,
    );
  }
  // Last, so it is the freshest instruction in the context when the agent
  // starts working — and so it survives a long upstream material block.
  if (input.declaredFields) {
    parts.push(buildOutputInstruction(input.declaredFields));
  }
  return parts.join("\n\n");
}

function buildWrapUpMessage(
  run: Run,
  deliverables: Array<{ title: string; output: string }>,
): string {
  const lines = run.phases.map((phase) => {
    const reason =
      phase.status === "skipped" && phase.skipReason
        ? ` — ${SKIP_SENTENCES[phase.skipReason as GraphSkipReason] ?? phase.skipReason}`
        : "";
    return `- ${phase.title}: ${phase.status}${reason}`;
  });
  const skipped = run.phases.filter((phase) => phase.status === "skipped");
  let heading: string;
  if (run.status === "done") {
    // A run that skipped part of the graph is still done — but saying so
    // silently is the one outcome this engine must never produce.
    const skipNote =
      skipped.length > 0
        ? ` ${skipped.length} node${skipped.length === 1 ? "" : "s"} did not run (see the outcomes below) — say so in your answer.`
        : "";
    heading =
      deliverables.length > 0
        ? `Every node has settled.${skipNote} The outputs below are this graph's final answers — relay them to the user (synthesized, not paraphrased away).`
        : `Every node has settled.${skipNote} Synthesize the results above into a final answer for the user.`;
  } else if (run.status === "canceled") {
    heading = "The orchestration was canceled. Briefly summarize what completed before the cancel.";
  } else {
    heading = `The orchestration failed: ${run.error ?? "unknown error"}. Briefly summarize what completed and what failed.`;
  }
  const deliverableBlock =
    deliverables.length > 0
      ? `\n\n${deliverables
          .map((entry) => `## ${entry.title}\n${truncateForChat(entry.output)}`)
          .join("\n\n")}`
      : "";
  return `${heading}\n\nNode outcomes:\n${lines.join("\n")}${deliverableBlock}`;
}

// Node outputs can be long; the orchestrator's chat gets a bounded excerpt (the
// full text still flows to downstream nodes and phase candidate summaries).
const CHAT_EXCERPT_LIMIT = 4000;

function truncateForChat(text: string): string {
  if (text.length <= CHAT_EXCERPT_LIMIT) {
    return text;
  }
  return `${text.slice(0, CHAT_EXCERPT_LIMIT)}\n… (truncated)`;
}

async function safeNotify(ctx: GraphRunContext, text: string): Promise<void> {
  try {
    await ctx.port.notifyOrchestrator({ text });
  } catch (error) {
    ctx.port.logger.error({ err: error, runId: ctx.run.id }, "Orchestrator notify failed");
  }
}
