import { z } from "zod";

import { JudgeVerdictSchema } from "./judge-verdict.js";

// The orchestration data model - a daemon-owned "Run": one execution of a
// declared multi-agent plan, and its observable/resumable projection to clients.
// See projects/agent-orchestration/agent-orchestration.md. This is Otto's
// provider-agnostic answer to a harness "Workflow": the conductor (an
// orchestrator-role agent) DECLARES the shape (typed phases, assignments, the
// loop target) via `start_workflow`, and the daemon runtime drives control flow -
// fan-out, gather-barrier, gate, loop - in code, so orchestrating is cheaper
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

// The default role that fills each phase type. `gate` has no role - it's a human
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
  "canceled", // stopped by the user (run cancel or gate rejection), not by an error
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

/** Terminal run statuses - no further phases will run. */
export function isTerminalRunStatus(value: string): boolean {
  return value === "done" || value === "failed" || value === "canceled";
}
/** Terminal phase statuses - the phase will not change again on its own. */
export function isTerminalPhaseStatus(value: string): boolean {
  return value === "done" || value === "failed" || value === "skipped" || value === "canceled";
}

// ── Declaration schema (the `start_workflow` input) ─────────────────────────
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
    // Immutable acceptance criteria - the run is "not done until every one is
    // met." Carried onto the Run and shown at gates.
    requirements: z.array(z.string().min(1)).optional(),
    // Attended by default: the run pauses at `gate` phases for the user.
    // Autopilot runs straight through (eligibility enforced daemon-side).
    autopilot: z.boolean().optional(),
    phases: z.array(RunPhaseDeclarationSchema).min(1).max(64),
  })
  .passthrough();

export type RunPlan = z.infer<typeof RunPlanSchema>;

/**
 * A Workflow with this many known agents needs an explicit user confirmation
 * before it starts. This is an agent-count boundary, not a price estimate:
 * providers do not expose one reliable comparable cost signal.
 */
export const WORKFLOW_START_CONFIRMATION_AGENT_THRESHOLD = 4;

/**
 * The known initial shape of a Workflow start. It intentionally excludes
 * retries and loop top-ups: those are bounded by the daemon's hard cap but
 * cannot truthfully be promised before execution.
 */
export interface WorkflowStartShape {
  plannedAgentCount: number;
  fanOutPhaseCount: number;
  phaseCount: number;
}

/** Count the children a declared AI plan asks the daemon to start initially. */
export function describeRunPlanStart(plan: RunPlan): WorkflowStartShape {
  const workerPhases = plan.phases.filter((phase) => phase.type !== "gate");
  return {
    plannedAgentCount: workerPhases.reduce((total, phase) => total + (phase.fanOut ?? 1), 0),
    fanOutPhaseCount: workerPhases.filter((phase) => (phase.fanOut ?? 1) > 1).length,
    phaseCount: plan.phases.length,
  };
}

// ── Projection schema (the Run the daemon persists + pushes to clients) ─────
// One spawned candidate for a phase: the observable child agent plus, when the
// phase judged it, that candidate's verdict.
export const RunPhaseCandidateSchema = z
  .object({
    agentId: z.string().min(1),
    // The personality that filled the role for this candidate, if resolved.
    personalityId: z.string().min(1).optional(),
    verdict: JudgeVerdictSchema.optional(),
    // The candidate's final message (synthesis input); may be large - clients
    // truncate for display.
    summary: z.string().optional(),
    // A durable terminal error when this candidate could not produce a result.
    // Optional so persisted runs from older daemons continue to parse.
    error: z.string().optional(),
    // Validated output fields, when the node declared them (GraphNode.output).
    // Values only - anything large belongs in a file the next node reads.
    outputFields: z.record(z.string(), z.unknown()).optional(),
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
    // Machine-readable reason a phase is "skipped" - the human sentence stays in
    // `notes`. Absent on a skipped phase means an older daemon wrote it (read it
    // as "upstream-failed", the only skip that existed then). Open vocabulary,
    // plain string on the wire; known values in GRAPH_SKIP_REASONS.
    skipReason: z.string().optional(),
    // How many extra attempts a node's retry policy spent (0/absent = none).
    retryAttempts: z.number().int().min(0).optional(),
    // True when the phase's last attempt ended at its time limit rather than
    // by failing on its own - a different diagnosis, so a different flag.
    timedOut: z.boolean().optional(),
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
  })
  .passthrough();

export type RunPhase = z.infer<typeof RunPhaseSchema>;

// Why a phase is "skipped" (see RunPhase.skipReason). A skip is never an error:
// "condition" means an edge's condition routed around this node, the other two
// mean an upstream node was itself skipped or failed. Plain string on the wire.
export const GRAPH_SKIP_REASONS = [
  "condition",
  "port",
  "upstream-skipped",
  "upstream-failed",
  "canceled",
] as const;
export type GraphSkipReason = (typeof GRAPH_SKIP_REASONS)[number];

// The exact Graph document captured when a Graph Run is drafted or started.
// This must remain declared before RunSchema: the protocol's generated
// validators load schemas eagerly. Graph documents evolve independently, so
// their nested fields stay open here; the graph was already validated against
// OrchestrationGraphSchema before the daemon persisted this snapshot.
export const RunGraphSnapshotSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    inputs: z.array(z.unknown()).optional(),
    nodes: z.array(z.unknown()),
    edges: z.array(z.unknown()).optional(),
    builtIn: z.boolean().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough();

export type RunGraphSnapshot = z.infer<typeof RunGraphSnapshotSchema>;

// New Workflow records carry this only when created through the category store.
// Optional means legacy daemon-global records remain readable and visible.
// COMPAT(categoryStorageResolver): added in v0.9.0, remove after 2027-02-28.
export const WorkflowStorageProvenanceSchema = z
  .object({
    schemaVersion: z.number().int().min(1),
    projectRoot: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    projectKey: z.string().min(1).optional(),
    location: z.enum(["repository", "host"]),
    storeKey: z.string().min(1),
    hostId: z.string().min(1).optional(),
    hostName: z.string().min(1).optional(),
    source: z.enum(["project-store", "legacy-host-library"]),
  })
  .passthrough();

/** Selects only the destination for future project-owned Workflow writes. */
export const ProjectWorkflowStoreSetRequestSchema = z.object({
  type: z.literal("project.workflow.store.set.request"),
  projectId: z.string(),
  // Null inherits the independent host-wide Workflow default.
  location: z.enum(["repository", "host"]).nullable(),
  requestId: z.string(),
});

export const ProjectWorkflowStoreSetResponseSchema = z.object({
  type: z.literal("project.workflow.store.set.response"),
  payload: z.object({
    requestId: z.string(),
    projectId: z.string(),
    accepted: z.boolean(),
    error: z.string().nullable(),
  }),
});

export type WorkflowStorageProvenance = z.infer<typeof WorkflowStorageProvenanceSchema>;

/** The durable Schedule fire that launched this Workflow, when applicable. */
export const WorkflowScheduleSourceSchema = z
  .object({
    scheduleId: z.string().min(1),
    scheduleRunId: z.string().min(1),
  })
  .passthrough();
export type WorkflowScheduleSource = z.infer<typeof WorkflowScheduleSourceSchema>;

/**
 * A daemon-owned start boundary, separate from an ordinary declared gate.
 * `model-plan-declared` pauses before any child agent starts; `agent-threshold`
 * is used by the Graph start review. The client presents the known shape and
 * sends an explicit decision back to the daemon.
 */
export const WorkflowStartConfirmationSchema = z
  .object({
    reason: z.string().min(1),
    plannedAgentCount: z.number().int().min(0),
    fanOutPhaseCount: z.number().int().min(0),
    phaseCount: z.number().int().min(0),
    agentCap: z.number().int().min(1),
    threshold: z.number().int().min(1),
  })
  .passthrough();

export type WorkflowStartConfirmation = z.infer<typeof WorkflowStartConfirmationSchema>;

export const WorkflowSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    // User-authored description from the New Orchestration dialog (what this
    // orchestration is for). Distinct from `summary`, which is AI-generated
    // after the run settles. Absent on conductor-declared (start_workflow) runs.
    description: z.string().optional(),
    status: z.string().min(1),
    // Which engine drives this orchestration: absent/"phases" = the conductor
    // -declared phase plan; "graph" = a user-authored deterministic graph
    // (projects/orchestration-graphs). Open vocabulary, plain string on the wire.
    kind: z.string().optional(),
    // Graph runs only: the graph template id, its exact source document, and
    // the fill-in values the user supplied for inputs. A draft may be re-saved;
    // an execution keeps this source document as immutable history. Optional so
    // older persisted runs and clients continue to parse.
    graphId: z.string().optional(),
    graphSnapshot: RunGraphSnapshotSchema.optional(),
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
    // A pending cost/agent confirmation before an AI-declared plan starts.
    // This is not a Graph/phase gate and never changes the plan's autopilot or
    // permission mode.
    startConfirmation: WorkflowStartConfirmationSchema.optional(),
    workflowStorage: WorkflowStorageProvenanceSchema.optional(),
    // A Schedule may start a saved definition, but it must not erase the
    // source identity that explains why this durable run exists.
    scheduleSource: WorkflowScheduleSourceSchema.optional(),
    // Total child agents this run spawned (makers + judgers) - a complexity
    // signal surfaced in the Runs display. Grows as the run executes.
    agentCount: z.number().int().min(0).optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough();

export type Workflow = z.infer<typeof WorkflowSchema>;

// COMPAT(runDomainType): renamed to Workflow in v0.9.0; remove after
// 2027-02-28 once downstream extensions have moved to the Workflow API.
export const RunSchema = WorkflowSchema;
export type Run = Workflow;

// Summary generation lifecycle (plain-string on the wire; see RunSchema.summaryStatus).
export const RUN_SUMMARY_STATUSES = ["pending", "ready", "failed"] as const;
export type RunSummaryStatus = (typeof RUN_SUMMARY_STATUSES)[number];

// ── Orchestration graphs (user orchestrations) ──────────────────────────────
// The reusable template a User orchestration executes - authored in the graph
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

// ── Prompt templates ────────────────────────────────────────────────────────
// Host-level reusable prompts, stored like Graphs. A template with
// `snippet: true` is meant to be included by other templates rather than bound
// to a node directly - the shared "how to submit your output" block is the
// motivating case, since repeating it in every node is both duplication and
// tokens on every dispatch.
export const PromptTemplateSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    // EJS source. Rendered with HTML escaping disabled - these are prompts,
    // not markup, and characters like & must survive verbatim.
    content: z.string(),
    // Variables the template expects, so the designer can render a binding
    // form instead of asking the author to remember them.
    variables: z.array(GraphInputSchema).optional(),
    snippet: z.boolean().optional(),
    builtIn: z.boolean().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    workflowStorage: WorkflowStorageProvenanceSchema.optional(),
  })
  .passthrough();

export type PromptTemplate = z.infer<typeof PromptTemplateSchema>;

// A node's binding to a stored template. A value is a literal, `$inputs.<key>`
// (a declared graph input), or `$output.<nodeId>.<field>` (an upstream node's
// output field).
export const NodePromptTemplateRefSchema = z
  .object({
    templateId: z.string().min(1),
    variables: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

export type NodePromptTemplateRef = z.infer<typeof NodePromptTemplateRefSchema>;

// Node kinds (open vocabulary): "orchestrator" - the single root that hosts
// the orchestration chat and anchors the Visualizer; "agent" - a worker node;
// "gate" - an attended human approval boundary; "check" - a deterministic
// JSONata assertion over upstream output. Gates and checks make no model call.
export const GRAPH_NODE_KINDS = ["orchestrator", "agent", "gate", "check"] as const;
export type GraphNodeKind = (typeof GRAPH_NODE_KINDS)[number];

// Loop annotation - exactly one of `times` (fixed repeat) or `until` (bounded
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

// ── Output fields (the value plane) ─────────────────────────────────────────
// What a node declares it will produce. Plain JSON descriptors, never a
// serialized Zod schema: they have to be three things at once - wire-safe, a
// form the designer can render, and compilable to both Zod (validation) and
// JSON Schema (the submit_output tool's input). `type` is an open string
// vocabulary so a new type can never break an old parser.
export const GRAPH_OUTPUT_FIELD_TYPES = ["string", "number", "boolean", "array"] as const;
export type GraphOutputFieldType = (typeof GRAPH_OUTPUT_FIELD_TYPES)[number];

export const GraphOutputFieldSchema = z
  .object({
    key: z.string().min(1),
    type: z.string().min(1),
    // Shown to the node's agent as the field's description - this is the whole
    // instruction it gets about what to put here, so it earns its place.
    description: z.string().optional(),
    // Absent ⇒ required. You declared the field; producing it is the contract.
    required: z.boolean().optional(),
  })
  .passthrough();

export type GraphOutputField = z.infer<typeof GraphOutputFieldSchema>;

export const GraphNodeOutputSchema = z
  .object({
    fields: z.array(GraphOutputFieldSchema),
  })
  .passthrough();

export type GraphNodeOutput = z.infer<typeof GraphNodeOutputSchema>;

// ── Query tools (per-node read-only lookups) ────────────────────────────────
// Author-defined tools that exist only inside one node's session, so a node can
// be given exactly the lookup it needs instead of the whole workspace.
//
// Three kinds, all read-only by construction:
//   command    argv array only - no shell, so no operators and no injection
//              surface. A pipeline belongs in a script the tool points at.
//   http-get   GET only, no author-supplied headers (credentials can't leak
//              into a graph template).
//   file-read  path must resolve inside the run's cwd.
export const GRAPH_QUERY_TOOL_KINDS = ["command", "http-get", "file-read"] as const;
export type GraphQueryToolKind = (typeof GRAPH_QUERY_TOOL_KINDS)[number];

export const GraphQueryToolSchema = z
  .object({
    // Tool name the agent calls. Namespaced at registration so it can never
    // shadow a built-in Otto tool.
    name: z.string().min(1),
    description: z.string().min(1),
    kind: z.string().min(1),
    // Declared parameters, reusing the output-field descriptor shape.
    parameters: z.array(GraphOutputFieldSchema).optional(),
    // kind "command": the executable plus its arguments, each argument a
    // separate entry. `{{param}}` substitutes a declared parameter's value as
    // one argument - never as a fragment the shell could re-split.
    command: z.array(z.string()).optional(),
    // kind "http-get": the URL, with `{{param}}` substitution (encoded).
    url: z.string().optional(),
    // kind "file-read": workspace-relative path, with `{{param}}` substitution.
    path: z.string().optional(),
  })
  .passthrough();

export type GraphQueryTool = z.infer<typeof GraphQueryToolSchema>;

// Bounded re-dispatch with exponential backoff. `maxAttempts` counts the first
// try, so 1 means "no retry" and is allowed (a designer default that hasn't
// been changed yet shouldn't be a validation error).
export const GraphNodeRetrySchema = z
  .object({
    maxAttempts: z.number().int().min(1).max(10),
    backoffMs: z.number().int().min(0).max(600_000),
    multiplier: z.number().min(1).max(4).optional(),
  })
  .passthrough();

export type GraphNodeRetry = z.infer<typeof GraphNodeRetrySchema>;

// A deterministic assertion over the named upstream material that reached a
// Check node. JSONata keeps user-authored graph data out of JavaScript `eval`.
// `message` is the actionable failure text shown on the durable Run.
export const GraphNodeCheckSchema = z
  .object({
    expression: z.string().min(1),
    message: z.string().min(1).optional(),
  })
  .passthrough();

export type GraphNodeCheck = z.infer<typeof GraphNodeCheckSchema>;

/**
 * A Check settles on exactly one named control-flow output. These are open
 * wire strings on GraphEdge so a newer client can still parse on an older
 * daemon, but the shared validator rejects an unsupported Check port before a
 * run begins.
 */
export const GRAPH_CHECK_OUTPUT_PORTS = ["pass", "fail"] as const;
export type GraphCheckOutputPort = (typeof GRAPH_CHECK_OUTPUT_PORTS)[number];

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
    // Load this node's prompt from a stored template instead of `prompt`.
    // Resolution failure falls back to `prompt`, so a deleted template
    // degrades a node rather than breaking a graph.
    promptTemplate: NodePromptTemplateRefSchema.optional(),
    // Leaf-only: the node may orchestrate its own agents (full otto toolset
    // minus start_run). Non-autonomous nodes get no orchestration tools at all.
    autonomous: z.boolean().optional(),
    loop: GraphNodeLoopSchema.optional(),
    // Declared output fields. Present ⇒ the node's agent gets a submit_output
    // tool it must call, its result is validated, and downstream nodes receive
    // the fields as data instead of re-reading prose. Absent ⇒ today exactly.
    output: GraphNodeOutputSchema.optional(),
    // How much of the workspace this node's agent may touch: "none" (no
    // filesystem), "read", or "write". Absent ⇒ "write", today's behaviour.
    //
    // Enforced by withholding tools at spawn, never by asking the model - and a
    // provider that can't enforce it refuses the node at compile time rather
    // than running it with full access. Open string vocabulary; known values in
    // WORKSPACE_ACCESS_LEVELS (protocol/agent-types).
    access: z.string().optional(),
    // Per-node Otto tool allowlist, by group (see OTTO_TOOL_GROUPS). Absent ⇒
    // whatever the node's tool policy already allows. Present ⇒ only these
    // groups, intersected with that policy and the daemon-wide allowlist - a
    // node can narrow its own authority, never widen it.
    //
    // Narrowing is a cost lever as much as a safety one: the tool catalog is
    // paid for in input tokens on every request the node's agent makes, and a
    // smaller catalog measurably helps smaller models stay on task.
    tools: z.array(z.string().min(1)).optional(),
    // Read-only lookups available only inside this node's session.
    queryTools: z.array(GraphQueryToolSchema).optional(),
    // Resilience against transient failure. Distinct from `loop`, which is
    // quality iteration: a loop re-runs work that succeeded but wasn't good
    // enough; a retry re-runs work that never completed. Retry wraps the whole
    // node including its loop, and every attempt is charged to the run's agent
    // cap - a retry is never a private allowance.
    retry: GraphNodeRetrySchema.optional(),
    // Check nodes only: a deterministic pass/fail assertion over the named
    // upstream output material. It never dispatches an agent.
    check: GraphNodeCheckSchema.optional(),
    // Wall-clock ceiling for one attempt of this node. On expiry the agent is
    // really cancelled (not merely stopped being awaited) and the node fails,
    // which its retry policy may then catch.
    timeoutMs: z.number().int().min(1000).max(21_600_000).optional(),
    // Explicit model override (otherwise the resolved personality/team decides).
    model: z.string().optional(),
    // Designer canvas layout.
    position: z.object({ x: z.number(), y: z.number() }).passthrough().optional(),
  })
  .passthrough();

export type GraphNode = z.infer<typeof GraphNodeSchema>;

// An edge condition. Kept as a wrapper object rather than a bare string so a
// future evaluation dialect can be named without a second field.
export const GraphEdgeConditionSchema = z
  .object({
    expression: z.string().min(1),
  })
  .passthrough();

export type GraphEdgeCondition = z.infer<typeof GraphEdgeConditionSchema>;

// A directed edge: `from`'s final output becomes labeled input material for
// `to`. Fan-in is an all-inputs barrier held by the daemon - agents never know
// about waiting.
export const GraphEdgeSchema = z
  .object({
    id: z.string().min(1).optional(),
    from: z.string().min(1),
    to: z.string().min(1),
    // Named ports. Absent ⇒ "output" → "input", which is every edge today, so
    // existing graphs parse and execute identically. Reserved ahead of the
    // control nodes that need more than one outcome (a gate's approved/rejected,
    // a check's pass/fail): adding two optional fields now is free, and adding a
    // second port later would mean changing the canvas, the schema and the
    // engine's value routing at once.
    fromPort: z.string().min(1).optional(),
    toPort: z.string().min(1).optional(),
    // Condition: a JSONata expression evaluated against the upstream node's
    // output fields once it settles (falling back to its prose as `output`
    // when it declared none). Truthy ⇒ this edge delivers; falsy ⇒ the edge is
    // inactive and its target is skipped with reason "condition". Absent ⇒
    // always delivers, which is every edge today.
    //
    // The condition lives on the edge rather than inside a node so the branch
    // is visible as a labelled wire - the graph shows its own control flow.
    when: GraphEdgeConditionSchema.optional(),
    // Which of the upstream node's output fields this edge carries. Absent ⇒
    // all of them. Selection only, never renaming: downstream is a prompt, not
    // a typed function signature, so remapping keys would buy nothing and
    // cost the reader the ability to trace a value by name.
    fields: z.array(z.string().min(1)).optional(),
    // Display-only label for the wire.
    label: z.string().optional(),
  })
  .passthrough();

export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

// ── Graph document compatibility ────────────────────────────────────────────
//
// Graphs were originally daemon-local records, so their persisted shape has no
// document version. Keep that legacy shape executable, but give caller-supplied
// documents a stable compatibility boundary before import/export exists. The
// schema remains additive and parser-safe; version interpretation happens here,
// after parsing, rather than in a wire-schema transform.
export const GRAPH_DOCUMENT_FORMAT = "otto.workflow.graph";
export const GRAPH_DOCUMENT_FORMAT_VERSION = 1;

export interface GraphValidationDiagnostic {
  code: string;
  severity: "error" | "warning";
  path: string;
  message: string;
  recovery: string;
}

export const OrchestrationGraphSchema = z
  .object({
    // A missing format/version is a legacy daemon-local Graph. New portable
    // documents write both fields; their semantics are checked explicitly by
    // `validateGraphDocument` below.
    format: z.string().min(1).optional(),
    formatVersion: z.number().int().min(1).optional(),
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    inputs: z.array(GraphInputSchema).optional(),
    nodes: z.array(GraphNodeSchema),
    edges: z.array(GraphEdgeSchema).optional(),
    // Bundled starter graphs; copy-on-edit, never deleted in place.
    builtIn: z.boolean().optional(),
    // Capability declarations are reserved for portable documents. They are
    // intentionally open strings so a newer exporter still parses on an older
    // peer; execution compatibility is a daemon-side preflight concern.
    requires: z.array(z.string().min(1)).optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    workflowStorage: WorkflowStorageProvenanceSchema.optional(),
  })
  .passthrough();

export type OrchestrationGraph = z.infer<typeof OrchestrationGraphSchema>;

// A portable Graph package is intentionally data-only. Its source descriptor is
// display/audit provenance supplied by the exporter, never an authority grant:
// the destination daemon independently validates the Graph and only persists it
// after the caller confirms the review response.
export const WorkflowGraphShareLocationSchema = z
  .object({
    storeKey: z.string().min(1),
    location: z.enum(["repository", "host"]),
    hostName: z.string().min(1).optional(),
    source: z.enum(["project-store", "legacy-host-library"]),
  })
  .passthrough();

export const WorkflowGraphExportSchema = z
  .object({
    schemaVersion: z.literal(1),
    graph: OrchestrationGraphSchema,
    source: WorkflowGraphShareLocationSchema,
    exportedAt: z.string().min(1),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .passthrough();

export type WorkflowGraphExport = z.infer<typeof WorkflowGraphExportSchema>;

export const WorkflowGraphImportResultSchema = z
  .object({
    status: z.enum(["review_required", "imported", "failed"]),
    graph: OrchestrationGraphSchema.optional(),
    source: WorkflowGraphShareLocationSchema.optional(),
    destination: WorkflowGraphShareLocationSchema.optional(),
    contentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    remediation: z.string().min(1),
  })
  .passthrough();

export type WorkflowGraphImportResult = z.infer<typeof WorkflowGraphImportResultSchema>;

/**
 * Validate the portable-document wrapper without changing a Graph's content.
 * A caller can use this in a local, read-only validation path; it never
 * resolves templates, evaluates expressions, or consults a daemon.
 */
export function validateGraphDocument(graph: OrchestrationGraph): GraphValidationDiagnostic[] {
  const diagnostics: GraphValidationDiagnostic[] = [];
  // `passthrough()` preserved arbitrary fields before this contract existed.
  // Treat a pre-existing unrelated `format` key as legacy unless its companion
  // version, or our exact portable format marker, says it is a document header.
  const declaresPortableFormat =
    graph.formatVersion !== undefined || graph.format === GRAPH_DOCUMENT_FORMAT;
  if (!declaresPortableFormat) {
    diagnostics.push({
      code: "GRAPH_DOCUMENT_LEGACY_UNVERSIONED",
      severity: "warning",
      path: "",
      message: "This Graph has no portable document format version.",
      recovery: `Export it as ${GRAPH_DOCUMENT_FORMAT} v${GRAPH_DOCUMENT_FORMAT_VERSION} before sharing it.`,
    });
    return diagnostics;
  }
  if (graph.format !== GRAPH_DOCUMENT_FORMAT) {
    diagnostics.push({
      code: "GRAPH_DOCUMENT_FORMAT_UNSUPPORTED",
      severity: "error",
      path: "/format",
      message: `Graph format "${graph.format ?? "(missing)"}" is not supported.`,
      recovery: `Use format "${GRAPH_DOCUMENT_FORMAT}".`,
    });
  }
  if (graph.formatVersion === undefined) {
    diagnostics.push({
      code: "GRAPH_DOCUMENT_VERSION_MISSING",
      severity: "error",
      path: "/formatVersion",
      message: "A portable Graph document needs formatVersion.",
      recovery: `Use formatVersion ${GRAPH_DOCUMENT_FORMAT_VERSION}.`,
    });
  } else if (graph.formatVersion > GRAPH_DOCUMENT_FORMAT_VERSION) {
    diagnostics.push({
      code: "GRAPH_DOCUMENT_VERSION_UNSUPPORTED",
      severity: "error",
      path: "/formatVersion",
      message: `Graph document version ${graph.formatVersion} is newer than this Otto host supports.`,
      recovery: "Update Otto, or export the Graph in a supported format version.",
    });
  }
  return diagnostics;
}

// A Graph id becomes a file name in every Graph store (`{id}.json`) and, since
// Graph packages can be imported from another host, it is untrusted input.
// Reject anything that is not one plain path segment so an id can never leave
// its store directory or shadow another store's file.
const SAFE_GRAPH_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export function isSafeGraphId(id: string): boolean {
  return SAFE_GRAPH_ID.test(id) && id !== "." && id !== "..";
}

// ── Graph structural validation ──────────────────────────────────────────────
// Shared by the daemon (hard gate before execute) and the designer (live
// feedback). Returns human-readable problems; empty ⇒ executable. Split into
// per-concern helpers to stay under the complexity ceiling.
export function validateOrchestrationGraph(graph: OrchestrationGraph): string[] {
  const nodeIds = new Set<string>();
  const problems: string[] = [];
  if (!isSafeGraphId(graph.id)) {
    problems.push(
      `Graph id "${graph.id}" must be a single file-name segment (letters, digits, "-", "_", ".").`,
    );
  }
  for (const diagnostic of validateGraphDocument(graph)) {
    if (diagnostic.severity === "error") {
      problems.push(diagnostic.message);
    }
  }
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
  const declaredInputs = new Set<string>();
  for (const input of graph.inputs ?? []) {
    if (declaredInputs.has(input.key)) {
      problems.push(`Duplicate Graph input key "${input.key}".`);
    }
    declaredInputs.add(input.key);
  }
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
    const source = graph.nodes.find((node) => node.id === edge.from);
    if (
      source?.kind === "check" &&
      edge.fromPort !== undefined &&
      !GRAPH_CHECK_OUTPUT_PORTS.includes(edge.fromPort as GraphCheckOutputPort)
    ) {
      problems.push(
        `Check "${source.title}" has edge port "${edge.fromPort}"; use "pass" or "fail".`,
      );
    }
    // Edges INTO the orchestrator are passive answer-delivery, not execution
    // dependencies - excluding them here keeps "root kicks off A, A delivers
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

/**
 * Advisory findings: things that are almost certainly authoring mistakes but
 * leave the graph executable. Separate from `validateOrchestrationGraph`
 * because that one is the daemon's hard gate - anything it returns stops a run,
 * and none of these should.
 *
 * Expression *syntax* is not checked here: the JSONata parser is daemon-side,
 * so this stays dependency-free for the client bundle.
 */
export function reviewOrchestrationGraph(graph: OrchestrationGraph): string[] {
  const warnings: string[] = [];
  for (const edge of graph.edges ?? []) {
    if (!edge.when?.expression?.trim()) {
      continue;
    }
    const source = graph.nodes.find((node) => node.id === edge.from);
    if (source && !source.output?.fields?.length) {
      warnings.push(
        `The edge from "${source.title}" has a condition, but "${source.title}" declares no output fields - the condition can only test its prose as \`output\`.`,
      );
    }
  }
  return warnings;
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
  const isGate = node.kind === "gate";
  const isCheck = node.kind === "check";
  if (!isRoot && node.kind !== "agent" && !isGate && !isCheck) return []; // unknown kinds pass through
  const problems: string[] = [];
  // Autonomous nodes may feed results onward via edges; what they must not
  // do is orchestrate deterministic children - which edges don't express, so
  // autonomy is allowed on any node except the root.
  if (node.autonomous && isRoot) {
    problems.push("The Orchestrator node can't be autonomous.");
  }
  if (!isRoot && !isGate && !isCheck && !node.prompt?.trim() && !node.promptFromInput) {
    problems.push(`Node "${node.title}" has no prompt and no prompt input.`);
  }
  problems.push(...validateGraphNodeCheck(node, isCheck));
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
  problems.push(...validateGraphNodeOutput(node));
  return problems;
}

function validateGraphNodeCheck(node: GraphNode, isCheck: boolean): string[] {
  return isCheck && !node.check?.expression.trim()
    ? [`Check "${node.title}" needs a JSONata expression.`]
    : [];
}

function validateGraphNodeOutput(node: GraphNode): string[] {
  if (!node.output) {
    return [];
  }
  const fields = node.output.fields ?? [];
  if (fields.length === 0) {
    return [`Node "${node.title}" declares output fields but lists none.`];
  }
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const field of fields) {
    if (seen.has(field.key)) {
      problems.push(`Node "${node.title}" declares the output field "${field.key}" twice.`);
    }
    seen.add(field.key);
  }
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
    return [`Node "${node.title}" has both loop forms - pick "times" or "until".`];
  }
  return [];
}

// ── Orchestration runs (agent-orchestration) ────────────────────────────────
// Daemon-owned multi-agent Run projection + control. Gated by
// server_info.features.agentOrchestration. See projects/agent-orchestration.
export const RunsGetSnapshotRequestSchema = z.object({
  type: z.literal("runs.get_snapshot.request"),
  requestId: z.string(),
});

export const RunsGetSnapshotResponseSchema = z.object({
  type: z.literal("runs.get_snapshot.response"),
  payload: z.object({
    runs: z.array(RunSchema),
    requestId: z.string(),
  }),
});

// Single-run push, broadcast on every phase/status change. Clients merge by id.
export const RunsUpdatedNotificationSchema = z.object({
  type: z.literal("runs.updated.notification"),
  payload: z.object({
    run: RunSchema,
  }),
});

// Answer an attended run's `gate` phase (approve or reject, with an optional
// note). `accepted` is false when the run wasn't awaiting a gate.
export const RunsGateRespondRequestSchema = z.object({
  type: z.literal("runs.gate_respond.request"),
  runId: z.string(),
  phaseId: z.string(),
  approved: z.boolean(),
  note: z.string().optional(),
  requestId: z.string(),
});

export const RunsGateRespondResponseSchema = z.object({
  type: z.literal("runs.gate_respond.response"),
  payload: z.object({
    runId: z.string(),
    accepted: z.boolean(),
    requestId: z.string(),
  }),
});

export const RunsCancelRequestSchema = z.object({
  type: z.literal("runs.cancel.request"),
  runId: z.string(),
  requestId: z.string(),
});

export const RunsCancelResponseSchema = z.object({
  type: z.literal("runs.cancel.response"),
  payload: z.object({
    runId: z.string(),
    canceled: z.boolean(),
    requestId: z.string(),
  }),
});

// Delete every finished (done/failed/canceled) run from disk and memory.
// Active/paused runs are left untouched. Gated by
// server_info.features.runsClear.
export const RunsClearRequestSchema = z.object({
  type: z.literal("runs.clear.request"),
  requestId: z.string(),
});

export const RunsClearResponseSchema = z.object({
  type: z.literal("runs.clear.response"),
  payload: z.object({
    runIds: z.array(z.string()),
    requestId: z.string(),
  }),
});

// Delete one run by id. Terminal (done/failed/canceled) and draft runs only -
// deleting an active run is refused so a cleanup click can't silently orphan
// running agents; cancel it first. Gated by server_info.features.runsDelete.
export const RunsDeleteRequestSchema = z.object({
  type: z.literal("runs.delete.request"),
  requestId: z.string(),
  runId: z.string(),
});

export const RunsDeleteResponseSchema = z.object({
  type: z.literal("runs.delete.response"),
  payload: z.object({
    // The deleted id, or absent when nothing was deleted (unknown or still
    // active) - `error` then carries why.
    runId: z.string().optional(),
    error: z.string().optional(),
    requestId: z.string(),
  }),
});

// Broadcast to every connected client (including the requester) so all
// caches drop the same runs, mirroring runs.updated.notification's upsert.
// Serves both runs.clear (many ids) and runs.delete (one).
export const RunsClearedNotificationSchema = z.object({
  type: z.literal("runs.cleared.notification"),
  payload: z.object({
    runIds: z.array(z.string()),
  }),
});

// ── Orchestration graphs (user orchestrations) ──────────────────────────────
// Host-level reusable graph templates + user-initiated orchestration start.
// Gated by server_info.features.orchestrationGraphs. UI says "Orchestration"
// and "Graph"; the wire keeps the short `runs.` namespace (see docs/glossary.md).
// See projects/orchestration-graphs.
export const RunsGraphsListRequestSchema = z.object({
  type: z.literal("runs.graphs.list.request"),
  requestId: z.string(),
});

export const RunsGraphsListResponseSchema = z.object({
  type: z.literal("runs.graphs.list.response"),
  payload: z.object({
    graphs: z.array(OrchestrationGraphSchema),
    requestId: z.string(),
  }),
});

// Upsert a graph template (create when the id is new). Built-in graphs are
// copy-on-edit daemon-side: saving over a builtIn id persists a user copy.
export const RunsGraphsSaveRequestSchema = z.object({
  type: z.literal("runs.graphs.save.request"),
  graph: OrchestrationGraphSchema,
  requestId: z.string(),
});

export const RunsGraphsSaveResponseSchema = z.object({
  type: z.literal("runs.graphs.save.response"),
  payload: z.object({
    graph: OrchestrationGraphSchema.optional(),
    error: z.string().optional(),
    requestId: z.string(),
  }),
});

export const RunsGraphsDeleteRequestSchema = z.object({
  type: z.literal("runs.graphs.delete.request"),
  graphId: z.string(),
  requestId: z.string(),
});

export const RunsGraphsDeleteResponseSchema = z.object({
  type: z.literal("runs.graphs.delete.response"),
  payload: z.object({
    deleted: z.boolean(),
    error: z.string().optional(),
    requestId: z.string(),
  }),
});

// Broadcast after any save/delete so every client's graph cache converges,
// mirroring runs.updated.notification's role for runs.
export const RunsGraphsChangedNotificationSchema = z.object({
  type: z.literal("runs.graphs.changed.notification"),
  payload: z.object({
    graphs: z.array(OrchestrationGraphSchema),
  }),
});

// Graph sharing is deliberately separate from save/run. Export is explicit;
// import first returns a review and needs a second confirmed request before a
// destination store is touched. New names use the dotted RPC contract.
export const WorkflowsGraphsListRequestSchema = z.object({
  type: z.literal("workflows.graphs.list.request"),
  cwd: z.string().min(1),
  requestId: z.string(),
});

export const WorkflowsGraphsListResponseSchema = z.object({
  type: z.literal("workflows.graphs.list.response"),
  payload: z.object({
    graphs: z.array(OrchestrationGraphSchema),
    error: z.string().optional(),
    requestId: z.string(),
  }),
});

/** Project-scoped Graph writes. Legacy runs.graphs.* remains the visible library. */
export const WorkflowsGraphSaveRequestSchema = z.object({
  type: z.literal("workflows.graph.save.request"),
  cwd: z.string().min(1),
  graph: OrchestrationGraphSchema,
  requestId: z.string(),
});

export const WorkflowsGraphSaveResponseSchema = z.object({
  type: z.literal("workflows.graph.save.response"),
  payload: z.object({
    graph: OrchestrationGraphSchema.optional(),
    error: z.string().optional(),
    requestId: z.string(),
  }),
});

export const WorkflowsGraphExportRequestSchema = z.object({
  type: z.literal("workflows.graph.export.request"),
  graphId: z.string().min(1),
  requestId: z.string(),
});

export const WorkflowsGraphExportResponseSchema = z.object({
  type: z.literal("workflows.graph.export.response"),
  payload: z.object({
    export: WorkflowGraphExportSchema.optional(),
    error: z.string().optional(),
    requestId: z.string(),
  }),
});

export const WorkflowsGraphImportRequestSchema = z.object({
  type: z.literal("workflows.graph.import.request"),
  cwd: z.string().min(1),
  export: WorkflowGraphExportSchema,
  confirmed: z.boolean(),
  requestId: z.string(),
});

export const WorkflowsGraphImportResponseSchema = z.object({
  type: z.literal("workflows.graph.import.response"),
  payload: z.object({
    result: WorkflowGraphImportResultSchema.optional(),
    error: z.string().optional(),
    requestId: z.string(),
  }),
});

// ── Prompt templates ────────────────────────────────────────────────────────
// Host-level reusable prompts and snippets a graph node can bind to. Same shape
// as the graph trio above, for the same reason: one store, list/save/delete,
// plus a full-list push so every client converges.
export const RunsTemplatesListRequestSchema = z.object({
  type: z.literal("runs.templates.list.request"),
  requestId: z.string(),
});

export const RunsTemplatesListResponseSchema = z.object({
  type: z.literal("runs.templates.list.response"),
  payload: z.object({
    templates: z.array(PromptTemplateSchema),
    requestId: z.string(),
  }),
});

export const RunsTemplatesSaveRequestSchema = z.object({
  type: z.literal("runs.templates.save.request"),
  template: PromptTemplateSchema,
  requestId: z.string(),
});

export const RunsTemplatesSaveResponseSchema = z.object({
  type: z.literal("runs.templates.save.response"),
  payload: z.object({
    template: PromptTemplateSchema.optional(),
    error: z.string().optional(),
    requestId: z.string(),
  }),
});

export const RunsTemplatesDeleteRequestSchema = z.object({
  type: z.literal("runs.templates.delete.request"),
  templateId: z.string(),
  requestId: z.string(),
});

export const RunsTemplatesDeleteResponseSchema = z.object({
  type: z.literal("runs.templates.delete.response"),
  payload: z.object({
    deleted: z.boolean(),
    error: z.string().optional(),
    requestId: z.string(),
  }),
});

export const RunsTemplatesChangedNotificationSchema = z.object({
  type: z.literal("runs.templates.changed.notification"),
  payload: z.object({
    templates: z.array(PromptTemplateSchema),
  }),
});

export const WorkflowsTemplatesListRequestSchema = z.object({
  type: z.literal("workflows.templates.list.request"),
  cwd: z.string().min(1),
  requestId: z.string(),
});

export const WorkflowsTemplatesListResponseSchema = z.object({
  type: z.literal("workflows.templates.list.response"),
  payload: z.object({
    templates: z.array(PromptTemplateSchema),
    error: z.string().optional(),
    requestId: z.string(),
  }),
});

export const WorkflowsTemplateSaveRequestSchema = z.object({
  type: z.literal("workflows.template.save.request"),
  cwd: z.string().min(1),
  template: PromptTemplateSchema,
  requestId: z.string(),
});

export const WorkflowsTemplateSaveResponseSchema = z.object({
  type: z.literal("workflows.template.save.response"),
  payload: z.object({
    template: PromptTemplateSchema.optional(),
    error: z.string().optional(),
    requestId: z.string(),
  }),
});

// Transfer addresses records by stable id plus the current project scope. The
// caller never receives a daemon file path, and a receipt is written before a
// destination record so an interrupted attempt stays explainable.
export const WorkflowTransferReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  receiptId: z.string().min(1),
  recordKind: z.enum(["graph", "template", "run"]),
  recordId: z.string().min(1),
  mode: z.enum(["copy", "move"]),
  source: z.object({
    source: z.enum(["legacy-host-library", "repository", "host"]),
    storeKey: z.string().min(1),
  }),
  destination: z.object({
    location: z.enum(["repository", "host"]),
    storeKey: z.string().min(1),
  }),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["prepared", "verified", "moved", "source-retained", "failed"]),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  recovery: z.string().optional(),
});

export const WorkflowsStorageTransferRequestSchema = z.object({
  type: z.literal("workflows.storage.transfer.request"),
  cwd: z.string().min(1),
  recordKind: z.enum(["graph", "template", "run"]),
  recordId: z.string().min(1),
  source: z.enum(["legacy-host-library", "repository", "host"]),
  destination: z.enum(["repository", "host"]),
  mode: z.enum(["copy", "move"]),
  requestId: z.string(),
});

export const WorkflowsStorageTransferResponseSchema = z.object({
  type: z.literal("workflows.storage.transfer.response"),
  payload: z.object({
    receipt: WorkflowTransferReceiptSchema.optional(),
    error: z.string().optional(),
    requestId: z.string(),
  }),
});

// Start (or draft) a user-initiated Workflow. `flavor` is an open vocabulary:
// "ai" (prompt-and-go - the daemon spawns an orchestrator agent that declares
// its own plan via start_workflow) or "graph" (deterministic - the daemon
// executes `graphId` with `graphInputs`). `draft: true` creates the record
// without executing (the designer flow); `runId` executes an existing draft in
// place - or, with `draft: true`, re-saves that draft in place.
const WorkflowStartRequestFieldsSchema = z.object({
  flavor: z.string(),
  cwd: z.string(),
  workspaceId: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  // Orchestrator seat when the active team doesn't fill it: a personality, or
  // a bare provider/model pair.
  orchestratorPersonalityId: z.string().optional(),
  orchestratorProvider: z.string().optional(),
  orchestratorModel: z.string().optional(),
  orchestratorThinkingOptionId: z.string().optional(),
  prompt: z.string().optional(),
  graphId: z.string().optional(),
  graphInputs: z.record(z.string(), z.string()).optional(),
  // A daemon-issued, request-bound token is required after Graph review. It
  // cannot be replaced by a client-side "confirmed" assertion.
  startConfirmationToken: z.string().min(1).optional(),
  draft: z.boolean().optional(),
  runId: z.string().optional(),
  requestId: z.string(),
});

const WorkflowStartResponsePayloadSchema = z.object({
  runId: z.string().optional(),
  // The root/orchestrator agent whose chat the client navigates to, and the
  // workspace the daemon resolved it into (the dialog only knows a project
  // target's cwd).
  agentId: z.string().optional(),
  workspaceId: z.string().optional(),
  // Returned without starting anything when the daemon requires an explicit
  // Graph-start confirmation. The caller renders this factual shape, then
  // resubmits the daemon-issued token with the unchanged launch request.
  confirmation: WorkflowStartConfirmationSchema.optional(),
  confirmationToken: z.string().min(1).optional(),
  error: z.string().optional(),
  requestId: z.string(),
});

/** The canonical Workflow launch RPC. */
export const WorkflowsStartRequestSchema = WorkflowStartRequestFieldsSchema.extend({
  type: z.literal("workflows.start.request"),
});

export const WorkflowsStartResponseSchema = z.object({
  type: z.literal("workflows.start.response"),
  payload: WorkflowStartResponsePayloadSchema,
});

// COMPAT(runsStartRpc): renamed to workflows.start in v0.9.0; accept and
// answer the legacy pair through 2027-02-28 so separately shipped apps and
// daemons retain the established Workflow-launch behavior.
export const RunsStartRequestSchema = WorkflowStartRequestFieldsSchema.extend({
  type: z.literal("runs.start.request"),
});

export const RunsStartResponseSchema = z.object({
  type: z.literal("runs.start.response"),
  payload: WorkflowStartResponsePayloadSchema,
});

/** Respond to an AI Workflow's daemon-owned start confirmation. */
export const WorkflowsStartConfirmationRespondRequestSchema = z.object({
  type: z.literal("workflows.start_confirmation.respond.request"),
  runId: z.string().min(1),
  approved: z.boolean(),
  requestId: z.string(),
});

export const WorkflowsStartConfirmationRespondResponseSchema = z.object({
  type: z.literal("workflows.start_confirmation.respond.response"),
  payload: z.object({
    runId: z.string(),
    accepted: z.boolean(),
    requestId: z.string(),
  }),
});

export type RunsGraphsListRequest = z.infer<typeof RunsGraphsListRequestSchema>;
export type RunsGraphsListResponse = z.infer<typeof RunsGraphsListResponseSchema>;
export type RunsGraphsSaveRequest = z.infer<typeof RunsGraphsSaveRequestSchema>;
export type RunsGraphsSaveResponse = z.infer<typeof RunsGraphsSaveResponseSchema>;
export type RunsGraphsDeleteRequest = z.infer<typeof RunsGraphsDeleteRequestSchema>;
export type RunsGraphsDeleteResponse = z.infer<typeof RunsGraphsDeleteResponseSchema>;
export type RunsGraphsChangedNotification = z.infer<typeof RunsGraphsChangedNotificationSchema>;
export type WorkflowsGraphsListRequest = z.infer<typeof WorkflowsGraphsListRequestSchema>;
export type WorkflowsGraphsListResponse = z.infer<typeof WorkflowsGraphsListResponseSchema>;
export type WorkflowsGraphSaveRequest = z.infer<typeof WorkflowsGraphSaveRequestSchema>;
export type WorkflowsGraphSaveResponse = z.infer<typeof WorkflowsGraphSaveResponseSchema>;
export type RunsTemplatesListRequest = z.infer<typeof RunsTemplatesListRequestSchema>;
export type RunsTemplatesListResponse = z.infer<typeof RunsTemplatesListResponseSchema>;
export type RunsTemplatesSaveRequest = z.infer<typeof RunsTemplatesSaveRequestSchema>;
export type RunsTemplatesSaveResponse = z.infer<typeof RunsTemplatesSaveResponseSchema>;
export type RunsTemplatesDeleteRequest = z.infer<typeof RunsTemplatesDeleteRequestSchema>;
export type RunsTemplatesDeleteResponse = z.infer<typeof RunsTemplatesDeleteResponseSchema>;
export type RunsTemplatesChangedNotification = z.infer<
  typeof RunsTemplatesChangedNotificationSchema
>;
export type WorkflowsTemplatesListRequest = z.infer<typeof WorkflowsTemplatesListRequestSchema>;
export type WorkflowsTemplatesListResponse = z.infer<typeof WorkflowsTemplatesListResponseSchema>;
export type WorkflowsTemplateSaveRequest = z.infer<typeof WorkflowsTemplateSaveRequestSchema>;
export type WorkflowsTemplateSaveResponse = z.infer<typeof WorkflowsTemplateSaveResponseSchema>;
export type WorkflowTransferReceipt = z.infer<typeof WorkflowTransferReceiptSchema>;
export type WorkflowsStorageTransferRequest = z.infer<typeof WorkflowsStorageTransferRequestSchema>;
export type WorkflowsStorageTransferResponse = z.infer<
  typeof WorkflowsStorageTransferResponseSchema
>;
export type WorkflowsStartRequest = z.infer<typeof WorkflowsStartRequestSchema>;
export type WorkflowsStartResponse = z.infer<typeof WorkflowsStartResponseSchema>;
export type WorkflowsStartConfirmationRespondRequest = z.infer<
  typeof WorkflowsStartConfirmationRespondRequestSchema
>;
export type WorkflowsStartConfirmationRespondResponse = z.infer<
  typeof WorkflowsStartConfirmationRespondResponseSchema
>;
// COMPAT(runsStartRpc): legacy exported types retire with the wire pair after 2027-02-28.
export type RunsStartRequest = z.infer<typeof RunsStartRequestSchema>;
export type RunsStartResponse = z.infer<typeof RunsStartResponseSchema>;

export type RunsGetSnapshotRequest = z.infer<typeof RunsGetSnapshotRequestSchema>;
export type RunsGetSnapshotResponse = z.infer<typeof RunsGetSnapshotResponseSchema>;
export type RunsUpdatedNotification = z.infer<typeof RunsUpdatedNotificationSchema>;
export type RunsGateRespondRequest = z.infer<typeof RunsGateRespondRequestSchema>;
export type RunsGateRespondResponse = z.infer<typeof RunsGateRespondResponseSchema>;
export type RunsCancelRequest = z.infer<typeof RunsCancelRequestSchema>;
export type RunsCancelResponse = z.infer<typeof RunsCancelResponseSchema>;
export type RunsClearRequest = z.infer<typeof RunsClearRequestSchema>;
export type RunsClearResponse = z.infer<typeof RunsClearResponseSchema>;
export type RunsDeleteRequest = z.infer<typeof RunsDeleteRequestSchema>;
export type RunsDeleteResponse = z.infer<typeof RunsDeleteResponseSchema>;
export type RunsClearedNotification = z.infer<typeof RunsClearedNotificationSchema>;
