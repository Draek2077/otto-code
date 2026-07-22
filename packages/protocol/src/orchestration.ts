import { z } from "zod";

import { JudgeVerdictSchema } from "./judge-verdict.js";

// The orchestration data model — a daemon-owned "Run": one execution of a
// declared multi-agent plan, and its observable/resumable projection to clients.
// See projects/agent-orchestration/agent-orchestration.md. This is Otto's
// provider-agnostic answer to a harness "Workflow": the conductor (an
// orchestrator-role agent) DECLARES the shape (typed phases, assignments, the
// loop target) via `start_run`, and the daemon runtime drives control flow —
// fan-out, gather-barrier, gate, loop — in code, so orchestrating is cheaper
// than hand-tracking N agent ids across async notifications.
//
// Wire-forward-compat, per the protocol contract: every open vocabulary (phase
// type, phase/run status) rides as a plain string leaf validated by a
// normalizer, never a z.enum, so the daemon can grow the vocabulary without
// breaking an older client's parse. Objects `.passthrough()`; no transforms.

// ── The deterministic plan vocabulary ──────────────────────────────────────
// Fixed phase types used by the runtime (NOT roles). The dispatcher maps a phase
// type to the role that fills it: research→researcher, plan→planner,
// refactor/implement→coder, design→designer, verify→judger, gate→human (no
// agent), deliver→coder/writer.
export const RUN_PHASE_TYPES = [
  "research",
  "plan",
  "refactor",
  "implement",
  "design",
  "verify",
  "gate",
  "deliver",
] as const;
export type RunPhaseType = (typeof RUN_PHASE_TYPES)[number];

const PHASE_TYPE_SET: ReadonlySet<string> = new Set(RUN_PHASE_TYPES);

export function isRunPhaseType(value: string): value is RunPhaseType {
  return PHASE_TYPE_SET.has(value);
}

// The default role that fills each phase type. `gate` has no role — it's a human
// approval point. `deliver` defaults to coder (a writer may cover small text
// deliverables; the conductor can override per phase).
const PHASE_TYPE_DEFAULT_ROLE: Readonly<Record<RunPhaseType, string | null>> = {
  research: "researcher",
  plan: "planner",
  refactor: "coder",
  implement: "coder",
  design: "designer",
  verify: "judger",
  gate: null,
  deliver: "coder",
};

/** The role a phase type dispatches to by default (null for human `gate`). */
export function defaultRoleForPhaseType(type: RunPhaseType): string | null {
  return PHASE_TYPE_DEFAULT_ROLE[type];
}

// ── Phase + run status (open vocabularies, plain-string on the wire) ─────────
export const RUN_PHASE_STATUSES = [
  "pending",
  "running",
  "blocked", // a gate phase awaiting human approval
  "done",
  "failed",
  "skipped",
] as const;
export type RunPhaseStatus = (typeof RUN_PHASE_STATUSES)[number];

export const RUN_STATUSES = [
  "draft", // a user orchestration created by the dialog, graph not yet executed
  "pending",
  "running",
  "paused", // stopped at an attended gate, awaiting the user
  "done",
  "failed",
  "canceled",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

const PHASE_STATUS_SET: ReadonlySet<string> = new Set(RUN_PHASE_STATUSES);
const RUN_STATUS_SET: ReadonlySet<string> = new Set(RUN_STATUSES);

export function isRunPhaseStatus(value: string): value is RunPhaseStatus {
  return PHASE_STATUS_SET.has(value);
}
export function isRunStatus(value: string): value is RunStatus {
  return RUN_STATUS_SET.has(value);
}

/** Terminal run statuses — no further phases will run. */
export function isTerminalRunStatus(value: string): boolean {
  return value === "done" || value === "failed" || value === "canceled";
}
/** Terminal phase statuses — the phase will not change again on its own. */
export function isTerminalPhaseStatus(value: string): boolean {
  return value === "done" || value === "failed" || value === "skipped";
}

// ── Declaration schema (the `start_run` input) ──────────────────────────────
// What the conductor DECLARES. Kept minimal and schema-validated so a bad plan
// is rejected at the tool boundary. `role` overrides the phase-type default;
// `fanOut` spawns N parallel candidates; `judge` attaches a verify sub-step so a
// making/research phase's output is graded and (with `keepBest`) looped until
// enough candidates pass.
export const RunPhaseJudgeSpecSchema = z
  .object({
    role: z.string().min(1).optional(),
    criteria: z.array(z.string().min(1)).optional(),
  })
  .passthrough();

export const RunPhaseDeclarationSchema = z
  .object({
    // Caller-assigned id, referenced by other phases' `dependsOn`.
    id: z.string().min(1),
    type: z.string().min(1),
    title: z.string().min(1),
    // The instruction handed to the assigned agent(s) as their prompt.
    task: z.string().min(1),
    // Override the phase-type's default role (e.g. deliver→writer).
    role: z.string().min(1).optional(),
    // Phase ids that must reach a terminal state before this phase starts.
    // Absent/empty ⇒ runs after the previous declared phase (linear default).
    dependsOn: z.array(z.string().min(1)).optional(),
    // Spawn N parallel candidates from the same task (different angles). 1 ⇒ solo.
    fanOut: z.number().int().min(1).max(16).optional(),
    // With a judge: keep the best N passers; if fewer pass, the runtime
    // re-dispatches replacements until the target is met or a cap trips.
    keepBest: z.number().int().min(1).max(16).optional(),
    // Attach a structured-judge sub-step to a non-verify phase.
    judge: RunPhaseJudgeSpecSchema.optional(),
  })
  .passthrough();

export type RunPhaseDeclaration = z.infer<typeof RunPhaseDeclarationSchema>;

export const RunPlanSchema = z
  .object({
    title: z.string().min(1),
    // Immutable acceptance criteria — the run is "not done until every one is
    // met." Carried onto the Run and shown at gates.
    requirements: z.array(z.string().min(1)).optional(),
    // Attended by default: the run pauses at `gate` phases for the user.
    // Autopilot runs straight through (eligibility enforced daemon-side).
    autopilot: z.boolean().optional(),
    phases: z.array(RunPhaseDeclarationSchema).min(1).max(64),
  })
  .passthrough();

export type RunPlan = z.infer<typeof RunPlanSchema>;

// ── Projection schema (the Run the daemon persists + pushes to clients) ─────
// One spawned candidate for a phase: the observable child agent plus, when the
// phase judged it, that candidate's verdict.
export const RunPhaseCandidateSchema = z
  .object({
    agentId: z.string().min(1),
    // The personality that filled the role for this candidate, if resolved.
    personalityId: z.string().min(1).optional(),
    verdict: JudgeVerdictSchema.optional(),
    // The candidate's final message (synthesis input); may be large — clients
    // truncate for display.
    summary: z.string().optional(),
  })
  .passthrough();

export type RunPhaseCandidate = z.infer<typeof RunPhaseCandidateSchema>;

export const RunPhaseSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    title: z.string().min(1),
    task: z.string().min(1),
    status: z.string().min(1),
    // Resolved dispatch target. `assigneeRole` is what the type/override asked
    // for; `candidates` are the spawned agents (>1 when fanned out).
    assigneeRole: z.string().min(1).optional(),
    dependsOn: z.array(z.string().min(1)).optional(),
    fanOut: z.number().int().min(1).optional(),
    keepBest: z.number().int().min(1).optional(),
    candidates: z.array(RunPhaseCandidateSchema).optional(),
    // Free-text runtime notes (why it blocked, which cap tripped, gap named).
    notes: z.string().optional(),
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
  })
  .passthrough();

export type RunPhase = z.infer<typeof RunPhaseSchema>;

export const RunSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    // User-authored description from the New Orchestration dialog (what this
    // orchestration is for). Distinct from `summary`, which is AI-generated
    // after the run settles. Absent on conductor-declared (start_run) runs.
    description: z.string().optional(),
    status: z.string().min(1),
    // Which engine drives this orchestration: absent/"phases" = the conductor
    // -declared phase plan; "graph" = a user-authored deterministic graph
    // (projects/orchestration-graphs). Open vocabulary, plain string on the wire.
    kind: z.string().optional(),
    // Graph runs only: the executed graph template and the fill-in values the
    // user supplied for its declared inputs.
    graphId: z.string().optional(),
    graphInputs: z.record(z.string(), z.string()).optional(),
    // Immutable requirements block (see RunPlan.requirements).
    requirements: z.array(z.string().min(1)).optional(),
    autopilot: z.boolean().optional(),
    phases: z.array(RunPhaseSchema).default([]),
    // The conductor agent that owns this run, and the workspace it runs in.
    conductorAgentId: z.string().min(1).optional(),
    cwd: z.string().optional(),
    workspaceId: z.string().optional(),
    // The team that was active when this run started (id for a stable filter key,
    // name for display). Absent on runs started without an active team.
    teamId: z.string().min(1).optional(),
    teamName: z.string().min(1).optional(),
    // Set when the run ends in failure or a cap trips.
    error: z.string().optional(),
    // AI-generated, human-readable summary of the whole run (from a Writer
    // personality). `summaryStatus` is a plain-string, forward-compat leaf:
    // "pending" (being generated), "ready", or "failed". Both absent on daemons
    // or runs without the run-summary feature.
    summary: z.string().optional(),
    summaryStatus: z.string().optional(),
    // Total child agents this run spawned (makers + judgers) — a complexity
    // signal surfaced in the Runs display. Grows as the run executes.
    agentCount: z.number().int().min(0).optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough();

export type Run = z.infer<typeof RunSchema>;

// Summary generation lifecycle (plain-string on the wire; see RunSchema.summaryStatus).
export const RUN_SUMMARY_STATUSES = ["pending", "ready", "failed"] as const;
export type RunSummaryStatus = (typeof RUN_SUMMARY_STATUSES)[number];

// ── Orchestration graphs (user orchestrations) ──────────────────────────────
// The reusable template a User orchestration executes — authored in the graph
// designer, stored host-level, parameterized by declared inputs. Executing a
// graph starts an orchestration (a Run with kind "graph"). See
// projects/orchestration-graphs. Same wire-forward-compat posture as the Run
// schemas: open string vocabularies, `.passthrough()` objects, no transforms.

// A declared fill-in parameter. The New Orchestration dialog renders these as
// a form when the graph is picked; values substitute into node prompts via
// {{inputs.<key>}} and via GraphNode.promptFromInput.
export const GraphInputSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    description: z.string().optional(),
    multiline: z.boolean().optional(),
    required: z.boolean().optional(),
    defaultValue: z.string().optional(),
  })
  .passthrough();

export type GraphInput = z.infer<typeof GraphInputSchema>;

// Node kinds (open vocabulary): "orchestrator" — the single root that hosts
// the orchestration chat and anchors the Visualizer; "agent" — a worker node.
export const GRAPH_NODE_KINDS = ["orchestrator", "agent"] as const;
export type GraphNodeKind = (typeof GRAPH_NODE_KINDS)[number];

// Loop annotation — exactly one of `times` (fixed repeat) or `until` (bounded
// retry graded by a structured judge between iterations; self-grading is not
// an exit test). `max` is a hard cap in both readings.
export const GraphNodeLoopSchema = z
  .object({
    times: z.number().int().min(1).max(64).optional(),
    until: z
      .object({
        // What the judge grades each iteration's output against.
        criteria: z.array(z.string().min(1)).min(1),
        // Role that fills the judge seat; defaults to "judger".
        judgeRole: z.string().min(1).optional(),
        max: z.number().int().min(1).max(16),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type GraphNodeLoop = z.infer<typeof GraphNodeLoopSchema>;

export const GraphNodeSchema = z
  .object({
    id: z.string().min(1),
    kind: z.string().min(1),
    title: z.string().min(1),
    // Team role the node dispatches to (agent nodes). Resolution at execute
    // time: active team fills the role → dialog personality → bare model.
    role: z.string().min(1).optional(),
    // Fixed prompt text; may reference {{inputs.<key>}}.
    prompt: z.string().optional(),
    // Key of a declared input whose value joins (or forms) the prompt.
    promptFromInput: z.string().optional(),
    // Leaf-only: the node may orchestrate its own agents (full otto toolset
    // minus start_run). Non-autonomous nodes get no orchestration tools at all.
    autonomous: z.boolean().optional(),
    loop: GraphNodeLoopSchema.optional(),
    // Explicit model override (otherwise the resolved personality/team decides).
    model: z.string().optional(),
    // Designer canvas layout.
    position: z.object({ x: z.number(), y: z.number() }).passthrough().optional(),
  })
  .passthrough();

export type GraphNode = z.infer<typeof GraphNodeSchema>;

// A directed edge: `from`'s final output becomes labeled input material for
// `to`. Fan-in is an all-inputs barrier held by the daemon — agents never know
// about waiting.
export const GraphEdgeSchema = z
  .object({
    id: z.string().min(1).optional(),
    from: z.string().min(1),
    to: z.string().min(1),
  })
  .passthrough();

export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const OrchestrationGraphSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    inputs: z.array(GraphInputSchema).optional(),
    nodes: z.array(GraphNodeSchema),
    edges: z.array(GraphEdgeSchema).optional(),
    // Bundled starter graphs; copy-on-edit, never deleted in place.
    builtIn: z.boolean().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough();

export type OrchestrationGraph = z.infer<typeof OrchestrationGraphSchema>;

// ── Graph structural validation ──────────────────────────────────────────────
// Shared by the daemon (hard gate before execute) and the designer (live
// feedback). Returns human-readable problems; empty ⇒ executable. Split into
// per-concern helpers to stay under the complexity ceiling.
export function validateOrchestrationGraph(graph: OrchestrationGraph): string[] {
  const nodeIds = new Set<string>();
  const problems: string[] = [];
  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) problems.push(`Duplicate node id "${node.id}".`);
    nodeIds.add(node.id);
  }
  const roots = graph.nodes.filter((n) => n.kind === "orchestrator");
  if (roots.length === 0) {
    problems.push("The graph needs exactly one Orchestrator node (the root).");
  } else if (roots.length > 1) {
    problems.push("The graph has more than one Orchestrator node.");
  }
  problems.push(...validateGraphEdges(graph, nodeIds));
  const declaredInputs = new Set((graph.inputs ?? []).map((i) => i.key));
  for (const node of graph.nodes) {
    problems.push(...validateGraphNode(node, declaredInputs));
  }
  return problems;
}

function validateGraphEdges(graph: OrchestrationGraph, nodeIds: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const edges = graph.edges ?? [];
  const rootId = graph.nodes.find((node) => node.kind === "orchestrator")?.id ?? null;
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    if (!nodeIds.has(edge.from)) problems.push(`Edge from unknown node "${edge.from}".`);
    if (!nodeIds.has(edge.to)) problems.push(`Edge to unknown node "${edge.to}".`);
    if (edge.from === edge.to) problems.push(`Node "${edge.from}" connects to itself.`);
    // Edges INTO the orchestrator are passive answer-delivery, not execution
    // dependencies — excluding them here keeps "root kicks off A, A delivers
    // back to root" from reading as a cycle.
    if (edge.to === rootId) continue;
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
  }
  if (hasGraphCycle(graph, outgoing, incoming)) {
    problems.push("The graph contains a cycle.");
  }
  return problems;
}

// Cycle check (loops are node-level annotations, never cyclic edges): Kahn.
function hasGraphCycle(
  graph: OrchestrationGraph,
  outgoing: ReadonlyMap<string, string[]>,
  incoming: ReadonlyMap<string, string[]>,
): boolean {
  const indegree = new Map<string, number>();
  for (const node of graph.nodes) indegree.set(node.id, incoming.get(node.id)?.length ?? 0);
  const queue = graph.nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift() as string;
    visited += 1;
    for (const next of outgoing.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  return visited !== graph.nodes.length;
}

const GRAPH_INPUT_REF = /\{\{\s*inputs\.([A-Za-z0-9_-]+)\s*\}\}/g;

function validateGraphNode(node: GraphNode, declaredInputs: ReadonlySet<string>): string[] {
  const isRoot = node.kind === "orchestrator";
  if (!isRoot && node.kind !== "agent") return []; // unknown kinds pass through
  const problems: string[] = [];
  // Autonomous nodes may feed results onward via edges; what they must not
  // do is orchestrate deterministic children — which edges don't express, so
  // autonomy is allowed on any node except the root.
  if (node.autonomous && isRoot) {
    problems.push("The Orchestrator node can't be autonomous.");
  }
  if (!isRoot && !node.prompt?.trim() && !node.promptFromInput) {
    problems.push(`Node "${node.title}" has no prompt and no prompt input.`);
  }
  if (node.promptFromInput && !declaredInputs.has(node.promptFromInput)) {
    problems.push(
      `Node "${node.title}" reads input "${node.promptFromInput}", which isn't declared.`,
    );
  }
  for (const match of (node.prompt ?? "").matchAll(GRAPH_INPUT_REF)) {
    if (!declaredInputs.has(match[1] as string)) {
      problems.push(
        `Node "${node.title}" references {{inputs.${match[1]}}}, which isn't declared.`,
      );
    }
  }
  problems.push(...validateGraphNodeLoop(node));
  return problems;
}

function validateGraphNodeLoop(node: GraphNode): string[] {
  if (!node.loop) {
    return [];
  }
  if (node.loop.times === undefined && node.loop.until === undefined) {
    return [`Node "${node.title}" has a loop with neither "times" nor "until".`];
  }
  if (node.loop.times !== undefined && node.loop.until !== undefined) {
    return [`Node "${node.title}" has both loop forms — pick "times" or "until".`];
  }
  return [];
}
