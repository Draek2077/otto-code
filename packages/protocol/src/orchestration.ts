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
    status: z.string().min(1),
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
