import {
  type GraphNode,
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
}

export interface GraphEnginePort {
  spawn(input: GraphEngineSpawnInput): Promise<RunEngineSpawnResult>;
  awaitAgent(input: { agentId: string; signal: AbortSignal }): Promise<RunEngineAwaitResult>;
  /** Deliver a labeled node completion (or the final wrap-up) to the orchestrator's chat. */
  notifyOrchestrator(input: { text: string }): Promise<void>;
  emit(run: Run): void | Promise<void>;
  now(): string;
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
  const problems = validateOrchestrationGraph(input.graph);
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

interface NodeResult {
  output: string | null;
  failed: boolean;
}

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
  const upstreamByNode = new Map<string, string[]>();
  for (const node of workers) {
    upstreamByNode.set(
      node.id,
      (ctx.graph.edges ?? [])
        .filter(
          (edge) =>
            edge.to === node.id &&
            edge.from !== root?.id &&
            workers.some((candidate) => candidate.id === edge.from),
        )
        .map((edge) => edge.from),
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
    const promise = executeNode(ctx, node, upstreamByNode.get(node.id) ?? [], runNode);
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
  upstreamIds: string[],
  runNode: (node: GraphNode) => Promise<NodeResult>,
): Promise<NodeResult> {
  const phase = ctx.run.phases.find((candidate) => candidate.id === node.id);
  const upstreamNodes = upstreamIds
    .map((id) => ctx.graph.nodes.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is GraphNode => candidate !== undefined);
  const upstreamResults = await Promise.all(upstreamNodes.map((upstream) => runNode(upstream)));

  if (ctx.signal.aborted || upstreamResults.some((result) => result.failed)) {
    if (phase && phase.status === "pending") {
      phase.status = "skipped";
      phase.notes = ctx.signal.aborted ? "Run canceled." : "An upstream node failed.";
      ctx.run.updatedAt = ctx.port.now();
      await ctx.port.emit(ctx.run);
    }
    return { output: null, failed: true };
  }

  const upstreamMaterial = upstreamNodes.map((upstream, index) => ({
    title: upstream.title,
    output: upstreamResults[index]?.output ?? "",
  }));

  try {
    const output = await dispatchNode(ctx, node, phase, upstreamMaterial);
    if (output !== null) {
      ctx.outputsById.set(node.id, output);
    }
    if (phase) {
      phase.status = "done";
      phase.completedAt = ctx.port.now();
      ctx.run.updatedAt = ctx.port.now();
      await ctx.port.emit(ctx.run);
    }
    await safeNotify(
      ctx,
      `Node "${node.title}" finished.\n\n${truncateForChat(output ?? "(no output)")}`,
    );
    return { output, failed: false };
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
    return { output: null, failed: true };
  }
}

// Run one node to completion, including its loop annotation. Returns the final
// output. Throws on hard failure (agent error, judge never passing, cap trip).
async function dispatchNode(
  ctx: GraphRunContext,
  node: GraphNode,
  phase: RunPhase | undefined,
  upstream: Array<{ title: string; output: string }>,
): Promise<string | null> {
  const basePrompt = buildNodeBasePrompt(node, ctx.inputs);
  const until = node.loop?.until;
  const times = node.loop?.times ?? 1;
  const maxAttempts = until ? until.max : times;

  let lastOutput: string | null = null;
  let judgeFeedback: string | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (ctx.signal.aborted) {
      throw new RunEngineError("Run canceled.", node.id);
    }
    const task = assembleNodeTask({
      basePrompt,
      upstream,
      previousOutput: attempt > 0 ? lastOutput : null,
      judgeFeedback,
      iteration: attempt,
      totalIterations: until ? null : times,
    });
    lastOutput = await spawnAndAwait(ctx, node, phase, {
      role: node.role ?? null,
      model: node.model ?? null,
      task,
      policy: node.autonomous ? "autonomous" : "deterministic",
      attempt,
      purpose: "worker",
    });

    if (!until) {
      continue; // fixed `times` loop: every iteration runs, last output wins.
    }
    const graded = await judgeIteration(ctx, node, phase, {
      until,
      basePrompt,
      output: lastOutput,
      attempt,
    });
    if (graded.passed) {
      return lastOutput;
    }
    judgeFeedback = graded.feedback;
  }

  if (until) {
    throw new RunEngineError(
      `Never passed the judge within ${until.max} iteration${until.max === 1 ? "" : "s"}.`,
      node.id,
    );
  }
  return lastOutput;
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
  const verdictMessage = await spawnAndAwait(ctx, node, phase, {
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
  const verdict = parseVerdict(verdictMessage);
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
async function spawnAndAwait(
  ctx: GraphRunContext,
  node: GraphNode,
  phase: RunPhase | undefined,
  input: {
    role: string | null;
    model: string | null;
    task: string;
    policy: "deterministic" | "autonomous";
    attempt: number;
    purpose: "worker" | "judge";
  },
): Promise<string | null> {
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
    const awaited = await ctx.port.awaitAgent({ agentId: spawned.agentId, signal: ctx.signal });
    if (awaited.failed) {
      throw new RunEngineError(
        input.purpose === "judge" ? "The judge agent failed." : "The node's agent failed.",
        node.id,
      );
    }
    if (phase && input.purpose === "worker") {
      const candidates = phase.candidates ?? [];
      const candidate = candidates.find((entry) => entry.agentId === spawned.agentId);
      if (candidate && awaited.finalMessage) {
        candidate.summary = awaited.finalMessage;
      }
    }
    return awaited.finalMessage;
  } finally {
    ctx.semaphore.release();
  }
}

function assembleNodeTask(input: {
  basePrompt: string;
  upstream: Array<{ title: string; output: string }>;
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
  return parts.join("\n\n");
}

function buildWrapUpMessage(
  run: Run,
  deliverables: Array<{ title: string; output: string }>,
): string {
  const lines = run.phases.map((phase) => `- ${phase.title}: ${phase.status}`);
  let heading: string;
  if (run.status === "done") {
    heading =
      deliverables.length > 0
        ? "Every node has finished. The outputs below are this graph's final answers — relay them to the user (synthesized, not paraphrased away)."
        : "Every node has finished. Synthesize the results above into a final answer for the user.";
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
