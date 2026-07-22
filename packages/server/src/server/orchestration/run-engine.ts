import {
  type Run,
  type RunPhase,
  type RunPhaseCandidate,
  type RunPlan,
  defaultRoleForPhaseType,
  isRunPhaseType,
} from "@otto-code/protocol/orchestration";
import { JudgeVerdictSchema, judgeVerdictPassed } from "@otto-code/protocol/judge-verdict";

// The orchestration execution engine — pure control flow over injected seams, so
// it is unit-testable with fakes and reusable across whatever spawns the agents.
// The daemon RunService implements the RunEnginePort with real primitives
// (createAgentCommand / waitForAgentEvent / active-team role resolution); tests
// implement it with in-memory fakes.
//
// Design: phases run in DECLARED ORDER (a valid topo order — dependsOn only
// references earlier phases, validated at build). The parallelism that matters
// for the litmus test lives WITHIN a phase (fanOut candidates + per-candidate
// judging), not across phases. Cross-phase parallelism is deliberately deferred;
// it would complicate gate/pause semantics for little gain on real plans.

// A minimal structured logger, shaped like pino's (obj, msg) so the daemon's
// pino logger is directly assignable, while a no-arg test stub is too.
export interface OrchestrationLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  debug?(obj: unknown, msg?: string): void;
}

export interface RunEngineCaps {
  /** Max child agents spawned concurrently across the whole run. */
  maxConcurrency: number;
  /** Hard ceiling on total child agents a run may spawn (runaway backstop). */
  maxAgents: number;
  /** Max replacement rounds for a loop-until-keepBest phase. */
  maxLoopAttempts: number;
}

export const DEFAULT_RUN_CAPS: RunEngineCaps = {
  maxConcurrency: 6,
  maxAgents: 40,
  maxLoopAttempts: 3,
};

export interface RunEngineSpawnInput {
  phaseId: string;
  phaseType: string;
  /** Resolved role this candidate fills (null only for roleless edge cases). */
  role: string | null;
  /** The instruction handed to the spawned agent. */
  task: string;
  /** 0-based attempt round (0 = initial fan-out, >0 = loop replacements). */
  attempt: number;
  /** 0-based index within the round. */
  index: number;
}

export interface RunEngineSpawnResult {
  agentId: string;
  personalityId?: string;
}

export interface RunEngineAwaitResult {
  /** The child's final assistant message, or null if none was produced. */
  finalMessage: string | null;
  /** True when the child ended in an error/failed state. */
  failed: boolean;
}

export interface RunEngineGateDecision {
  approved: boolean;
  note?: string;
}

/**
 * The seams the engine drives. The daemon implements these with real agent
 * spawning + waiting + team resolution; tests implement them in-memory.
 */
export interface RunEnginePort {
  /**
   * Resolve the personality that fills `role` in this run's active team. Returns
   * null when no team member has the role — the engine hard-fails the run and
   * names the gap (the repo's no-fallback rule). Idempotent per role.
   */
  resolveRole(role: string): Promise<{ personalityId: string } | null>;
  /** Spawn one candidate child agent. */
  spawn(input: RunEngineSpawnInput): Promise<RunEngineSpawnResult>;
  /** Wait for a spawned child to reach a terminal state and return its output. */
  awaitAgent(input: { agentId: string; signal: AbortSignal }): Promise<RunEngineAwaitResult>;
  /**
   * Await a human decision at an attended `gate` phase. Never called under
   * autopilot. Should reject/throw if the run is canceled while waiting.
   */
  awaitGate(input: {
    runId: string;
    phaseId: string;
    signal: AbortSignal;
  }): Promise<RunEngineGateDecision>;
  /** Persist + broadcast the current run projection. Called on every change. */
  emit(run: Run): void | Promise<void>;
  /** ISO timestamp source (injected for deterministic tests). */
  now(): string;
  logger: OrchestrationLogger;
}

// A hard-fail the engine raises when a run cannot proceed (missing role, cap).
export class RunEngineError extends Error {
  constructor(
    message: string,
    readonly phaseId?: string,
  ) {
    super(message);
    this.name = "RunEngineError";
  }
}

/**
 * Build the initial Run projection from a declared plan. Pure. Validates that
 * `dependsOn` only references earlier phases (keeps declared order a valid topo
 * order) and that ids are unique — a malformed plan is rejected here, before any
 * agent is spawned.
 */
export function buildRunFromPlan(input: {
  plan: RunPlan;
  id: string;
  now: string;
  conductorAgentId?: string;
  cwd?: string;
  workspaceId?: string;
  teamId?: string;
  teamName?: string;
}): Run {
  const { plan, id, now } = input;
  const seen = new Set<string>();
  const phases: RunPhase[] = plan.phases.map((decl) => {
    if (seen.has(decl.id)) {
      throw new RunEngineError(`Duplicate phase id "${decl.id}" in plan`, decl.id);
    }
    for (const dep of decl.dependsOn ?? []) {
      if (!seen.has(dep)) {
        throw new RunEngineError(
          `Phase "${decl.id}" depends on "${dep}", which is not an earlier phase`,
          decl.id,
        );
      }
    }
    seen.add(decl.id);
    const typeDefaultRole = isRunPhaseType(decl.type) ? defaultRoleForPhaseType(decl.type) : null;
    const role = decl.role ?? typeDefaultRole ?? undefined;
    const phase: RunPhase = {
      id: decl.id,
      type: decl.type,
      title: decl.title,
      task: decl.task,
      status: "pending",
      ...(role ? { assigneeRole: role } : {}),
      ...(decl.dependsOn ? { dependsOn: decl.dependsOn } : {}),
      ...(decl.fanOut ? { fanOut: decl.fanOut } : {}),
      ...(decl.keepBest ? { keepBest: decl.keepBest } : {}),
    };
    return phase;
  });
  return {
    id,
    title: plan.title,
    status: "pending",
    ...(plan.requirements ? { requirements: plan.requirements } : {}),
    ...(plan.autopilot ? { autopilot: true } : {}),
    phases,
    ...(input.conductorAgentId ? { conductorAgentId: input.conductorAgentId } : {}),
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    ...(input.teamId ? { teamId: input.teamId } : {}),
    ...(input.teamName ? { teamName: input.teamName } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/** Run `tasks` with at most `limit` in flight at once, preserving result order. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = Array.from({ length: items.length }) as R[];
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) {
        return;
      }
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

// Default judge instruction embedded around a candidate's output. Kept in the
// engine so the structured-verdict contract travels with the control flow.
// Exported for the graph engine, which reuses the same contract for its
// loop-until exit test (projects/orchestration-graphs).
export function buildJudgeTask(input: {
  originalTask: string;
  candidateOutput: string;
  criteria?: readonly string[];
}): string {
  const criteria =
    input.criteria && input.criteria.length > 0
      ? `\n\nAcceptance criteria:\n${input.criteria.map((c) => `- ${c}`).join("\n")}`
      : "";
  return (
    `You are judging one candidate's work against the task below. Return ONLY a JSON object ` +
    `matching {"verdict":"pass"|"fail","score":0..1,"criteria":[{"name":string,"met":boolean,` +
    `"evidence":string}],"summary":string}. Do not add prose outside the JSON.\n\n` +
    `Task the candidate was given:\n${input.originalTask}${criteria}\n\n` +
    `Candidate's output:\n${input.candidateOutput}`
  );
}

// Pull a JudgeVerdict out of an agent's final message. The message may wrap the
// JSON in prose or a code fence; we extract the first balanced JSON object and
// validate it. Anything unparseable is a FAIL — a gate must never advance on a
// verdict it cannot read (mirrors normalizeJudgeOutcome). Exported for the
// graph engine (same contract for loop-until exit tests).
export function parseVerdict(finalMessage: string | null): RunPhaseCandidate["verdict"] {
  if (!finalMessage) {
    return { verdict: "fail", summary: "No output produced." };
  }
  const candidate = extractJsonObject(finalMessage);
  if (candidate === null) {
    return { verdict: "fail", summary: "No parseable verdict JSON in output." };
  }
  const parsed = JudgeVerdictSchema.safeParse(candidate);
  if (!parsed.success) {
    return { verdict: "fail", summary: "Verdict JSON did not match the schema." };
  }
  return parsed.data;
}

// Extract the first balanced {...} JSON object from a string (tolerates a
// leading ```json fence and surrounding prose). Returns the parsed value or null.
function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start === -1) {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        try {
          return JSON.parse(slice);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

interface ExecuteRunContext {
  run: Run;
  plan: RunPlan;
  caps: RunEngineCaps;
  signal: AbortSignal;
  port: RunEnginePort;
  /** Running total of spawned child agents (cap accounting). */
  agentsSpawned: number;
}

/**
 * Execute a run to completion, driving the injected port. Mutates a working copy
 * of `run`, emitting on every state change, and returns the terminal Run. Never
 * throws for expected outcomes (gate rejection, missing role, cap trip) — those
 * become a terminal run status with an `error`/notes; it only throws if the port
 * itself throws unexpectedly.
 */
export async function executeRun(input: {
  run: Run;
  plan: RunPlan;
  caps: RunEngineCaps;
  signal: AbortSignal;
  port: RunEnginePort;
}): Promise<Run> {
  const ctx: ExecuteRunContext = { ...input, agentsSpawned: 0 };
  const { run, port } = ctx;
  run.status = "running";
  run.updatedAt = port.now();
  await port.emit(run);

  try {
    for (const phase of run.phases) {
      if (ctx.signal.aborted) {
        return finalizeCanceled(ctx);
      }
      // Skip a phase whose dependency didn't reach "done".
      const blockedBy = (phase.dependsOn ?? []).find((depId) => {
        const dep = run.phases.find((p) => p.id === depId);
        return !dep || dep.status !== "done";
      });
      if (blockedBy) {
        setPhase(ctx, phase, {
          status: "skipped",
          notes: `Skipped: dependency "${blockedBy}" did not complete.`,
        });
        await port.emit(run);
        continue;
      }

      phase.startedAt = port.now();
      setPhase(ctx, phase, { status: "running" });
      await port.emit(run);

      if (phase.type === "gate") {
        const stop = await runGatePhase(ctx, phase);
        if (stop) {
          return run;
        }
        continue;
      }

      await runWorkerPhase(ctx, phase);
      if (run.status === "failed") {
        return run;
      }
      if (ctx.signal.aborted) {
        return finalizeCanceled(ctx);
      }
    }

    run.status = "done";
    run.updatedAt = port.now();
    await port.emit(run);
    return run;
  } catch (error) {
    run.status = "failed";
    run.error = error instanceof Error ? error.message : String(error);
    run.updatedAt = port.now();
    await port.emit(run);
    return run;
  }
}

function finalizeCanceled(ctx: ExecuteRunContext): Run {
  ctx.run.status = "canceled";
  ctx.run.updatedAt = ctx.port.now();
  void ctx.port.emit(ctx.run);
  return ctx.run;
}

function setPhase(ctx: ExecuteRunContext, phase: RunPhase, patch: Partial<RunPhase>): void {
  Object.assign(phase, patch);
  ctx.run.updatedAt = ctx.port.now();
}

// Returns true when the run should stop here (gate rejected).
async function runGatePhase(ctx: ExecuteRunContext, phase: RunPhase): Promise<boolean> {
  const { run, port } = ctx;
  if (run.autopilot) {
    setPhase(ctx, phase, {
      status: "done",
      completedAt: port.now(),
      notes: "Auto-approved (autopilot).",
    });
    await port.emit(run);
    return false;
  }
  setPhase(ctx, phase, { status: "blocked" });
  run.status = "paused";
  await port.emit(run);
  const decision = await port.awaitGate({ runId: run.id, phaseId: phase.id, signal: ctx.signal });
  if (decision.approved) {
    setPhase(ctx, phase, {
      status: "done",
      completedAt: port.now(),
      ...(decision.note ? { notes: decision.note } : {}),
    });
    run.status = "running";
    await port.emit(run);
    return false;
  }
  setPhase(ctx, phase, {
    status: "failed",
    completedAt: port.now(),
    notes: decision.note ?? "Rejected at gate.",
  });
  run.status = "canceled";
  run.updatedAt = port.now();
  await port.emit(run);
  return true;
}

// Resolve the phase's role and (when judged) the judger role up front, hard-
// failing the run and naming any gap. Returns false when the run was failed.
async function resolvePhaseRoles(
  ctx: ExecuteRunContext,
  phase: RunPhase,
  role: string | null,
  judgeRole: string | null,
): Promise<boolean> {
  if (role && !(await ctx.port.resolveRole(role))) {
    failRunForMissingRole(ctx, phase, role);
    return false;
  }
  if (judgeRole && !(await ctx.port.resolveRole(judgeRole))) {
    failRunForMissingRole(ctx, phase, judgeRole);
    return false;
  }
  return true;
}

// How many candidates to spawn this round: the full fan-out on the first round,
// then only enough to top up to keepBest on loop rounds.
function computeRoundNeed(
  attempt: number,
  fanOut: number,
  keepBest: number | undefined,
  passers: number,
): number {
  if (attempt === 0) {
    return fanOut;
  }
  if (keepBest) {
    return Math.max(0, keepBest - passers);
  }
  return 0;
}

function candidatePassed(candidate: RunPhaseCandidate): boolean {
  return candidate.verdict ? judgeVerdictPassed(candidate.verdict) : true;
}

// The loop stops once the bar is met or a cap trips.
function shouldStopLoop(
  ctx: ExecuteRunContext,
  keepBest: number | undefined,
  passers: number,
  attempt: number,
): boolean {
  return (
    !keepBest ||
    passers >= keepBest ||
    attempt >= ctx.caps.maxLoopAttempts ||
    ctx.agentsSpawned >= ctx.caps.maxAgents ||
    ctx.signal.aborted
  );
}

async function finalizePhase(
  ctx: ExecuteRunContext,
  phase: RunPhase,
  input: { judged: boolean; candidates: RunPhaseCandidate[]; passers: number },
): Promise<void> {
  const { run, port } = ctx;
  const succeeded = input.judged ? input.passers > 0 : input.candidates.length > 0;
  setPhase(ctx, phase, {
    status: succeeded ? "done" : "failed",
    completedAt: port.now(),
    ...(input.judged
      ? { notes: `${input.passers}/${input.candidates.length} candidate(s) passed.` }
      : {}),
  });
  if (!succeeded) {
    run.status = "failed";
    run.error = run.error ?? `Phase "${phase.id}" produced no passing candidate.`;
  }
  await port.emit(run);
}

// The representative output of a completed phase: the summaries of its passing
// candidates (or all candidates when the phase was not judged), joined. This is
// what a downstream phase that depends on it receives as context.
function phaseOutput(phase: RunPhase): string | null {
  const candidates = phase.candidates ?? [];
  if (candidates.length === 0) {
    return null;
  }
  const passing = candidates.filter((c) => (c.verdict ? judgeVerdictPassed(c.verdict) : true));
  const chosen = passing.length > 0 ? passing : candidates;
  const outputs = chosen.map((c) => c.summary).filter((s): s is string => Boolean(s && s.trim()));
  return outputs.length > 0 ? outputs.join("\n\n---\n\n") : null;
}

// Appended to every worker task. Two nudges: (1) return a finished result, not a
// status update — so a judger grades real work; (2) don't fan out to sub-agents
// unless the task genuinely needs it, and if you do, wait for them and fold their
// results in before finishing. Pairs with waitForAgentFullySettled on the daemon
// side: that guarantees we WAIT for a worker's sub-agents; this discourages
// needless fan-out and half-done hand-backs in the first place.
const WORKER_TASK_FRAMING =
  "Return your finished result, not a progress update. Complete this yourself; only delegate to " +
  "sub-agents if the task genuinely requires it, and if you do, wait for them and incorporate their " +
  "output before you finish.";

// Compose the task an assignee actually receives: the declared task, prefixed
// with the outputs of the phases it depends on and suffixed with the worker
// framing. Threading upstream results into the downstream prompt is what makes
// `dependsOn` mean "build on this", not just "run after this" — the child agent
// starts a fresh session with no memory of sibling phases, so their output must
// travel in the prompt. Dep blocks are kept terse: a labeled block per dependency.
function composePhaseTask(ctx: ExecuteRunContext, phase: RunPhase): string {
  const blocks: string[] = [];
  for (const depId of phase.dependsOn ?? []) {
    const dep = ctx.run.phases.find((p) => p.id === depId);
    const output = dep ? phaseOutput(dep) : null;
    if (output) {
      blocks.push(`From "${dep!.title}":\n${output}`);
    }
  }
  const base = blocks.length === 0 ? phase.task : `${blocks.join("\n\n")}\n\n${phase.task}`;
  return `${base}\n\n${WORKER_TASK_FRAMING}`;
}

/**
 * The run's headline deliverable: the output of the last completed, non-gate
 * phase (typically the `deliver` phase). Null when nothing produced output. The
 * conductor relays this back to whoever asked for the run.
 */
export function summarizeRunOutput(run: Run): string | null {
  for (let i = run.phases.length - 1; i >= 0; i--) {
    const phase = run.phases[i]!;
    if (phase.type === "gate" || phase.status !== "done") {
      continue;
    }
    const output = phaseOutput(phase);
    if (output) {
      return output;
    }
  }
  return null;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

// Render one phase as a compact line (+ an output excerpt) for the summary prompt.
function describePhaseForSummary(phase: RunPhase): string {
  const parts = [`- [${phase.status}] ${phase.type}: ${phase.title}`];
  const candidates = phase.candidates ?? [];
  if (candidates.length > 1) {
    const passed = candidates.filter((c) =>
      c.verdict ? judgeVerdictPassed(c.verdict) : true,
    ).length;
    parts.push(`(${passed}/${candidates.length} candidates passed)`);
  }
  if (phase.notes) {
    parts.push(`— ${phase.notes}`);
  }
  const output = phaseOutput(phase);
  const line = parts.join(" ");
  return output ? `${line}\n    output: ${truncate(output.replace(/\s+/g, " "), 400)}` : line;
}

/**
 * Build the prompt a Writer uses to summarize a terminal run for the Runs
 * display. Feeds the run's shape (title, outcome, requirements, agent count) and
 * a compact per-phase digest with truncated outputs, and asks for a few plain
 * sentences — what it set out to do, what happened, the outcome, and why it
 * failed if it did.
 */
export function buildRunSummaryPrompt(run: Run): string {
  const header = [
    "Summarize this completed multi-agent orchestration run for a status display.",
    "Write 2–4 plain, concrete sentences covering: what the run set out to do, what happened",
    "across its phases at a high level, the final outcome, and — if it failed — the reason.",
    "Neutral tone. No preamble, no markdown, no headings — just the sentences.",
  ].join(" ");
  const facts = [
    `Run: "${run.title}"`,
    `Final status: ${run.status}`,
    ...(run.error ? [`Error: ${run.error}`] : []),
    ...(run.requirements?.length ? [`Requirements: ${run.requirements.join("; ")}`] : []),
    `Child agents spawned: ${run.agentCount ?? run.phases.reduce((n, p) => n + (p.candidates?.length ?? 0), 0)}`,
  ];
  const phases = run.phases.map(describePhaseForSummary);
  return `${header}\n\n${facts.join("\n")}\n\nPhases:\n${phases.join("\n")}`;
}

async function runWorkerPhase(ctx: ExecuteRunContext, phase: RunPhase): Promise<void> {
  const { run, port } = ctx;
  const role = phase.assigneeRole ?? null;
  const declaration = ctx.plan.phases.find((p) => p.id === phase.id);
  const judgeSpec = declaration?.judge;
  const judgeRole = judgeSpec?.role ?? "judger";

  if (!(await resolvePhaseRoles(ctx, phase, role, judgeSpec ? judgeRole : null))) {
    return;
  }

  // Fold upstream dependency outputs into the task once; deps are terminal by
  // the time this phase runs, so this is stable across loop rounds.
  const effectiveTask = composePhaseTask(ctx, phase);
  const isVerifyPhase = phase.type === "verify";
  const keepBest = phase.keepBest;
  const fanOut = phase.fanOut ?? 1;
  const candidates: RunPhaseCandidate[] = [];
  let passers = 0;
  let attempt = 0;

  for (;;) {
    const need = computeRoundNeed(attempt, fanOut, keepBest, passers);
    if (need <= 0) {
      break;
    }
    if (ctx.agentsSpawned + need > ctx.caps.maxAgents) {
      appendNote(
        ctx,
        phase,
        `Agent cap (${ctx.caps.maxAgents}) reached; proceeding with ${candidates.length} candidate(s).`,
      );
      break;
    }

    const round = await runCandidateRound(ctx, phase, {
      role,
      task: effectiveTask,
      count: need,
      attempt,
      isVerifyPhase,
      judgeSpec: judgeSpec ? { role: judgeRole, criteria: judgeSpec.criteria } : null,
    });
    for (const candidate of round) {
      candidates.push(candidate);
      if (candidatePassed(candidate)) {
        passers++;
      }
    }
    phase.candidates = candidates;
    await port.emit(run);

    attempt++;
    if (shouldStopLoop(ctx, keepBest, passers, attempt)) {
      break;
    }
  }

  await finalizePhase(ctx, phase, {
    judged: isVerifyPhase || Boolean(judgeSpec),
    candidates,
    passers,
  });
}

// Spawn `count` candidates for a phase, await them, and (when judged) grade each.
async function runCandidateRound(
  ctx: ExecuteRunContext,
  phase: RunPhase,
  opts: {
    role: string | null;
    /** The effective task (declared task + upstream dependency outputs). */
    task: string;
    count: number;
    attempt: number;
    isVerifyPhase: boolean;
    judgeSpec: { role: string; criteria?: readonly string[] } | null;
  },
): Promise<RunPhaseCandidate[]> {
  const { port } = ctx;
  const indices = Array.from({ length: opts.count }, (_, i) => i);
  ctx.agentsSpawned += opts.count;
  ctx.run.agentCount = ctx.agentsSpawned;

  return mapWithConcurrency(indices, ctx.caps.maxConcurrency, async (_item, index) => {
    const spawn = await port.spawn({
      phaseId: phase.id,
      phaseType: phase.type,
      role: opts.role,
      task: opts.task,
      attempt: opts.attempt,
      index,
    });
    const result = await port.awaitAgent({ agentId: spawn.agentId, signal: ctx.signal });
    const candidate: RunPhaseCandidate = {
      agentId: spawn.agentId,
      ...(spawn.personalityId ? { personalityId: spawn.personalityId } : {}),
      ...(result.finalMessage ? { summary: result.finalMessage } : {}),
    };

    if (opts.isVerifyPhase) {
      // The candidate IS the judger; its message is the verdict.
      candidate.verdict = result.failed
        ? { verdict: "fail", summary: "Judger agent errored." }
        : parseVerdict(result.finalMessage);
    } else if (opts.judgeSpec) {
      // Grade the maker's output with a separate judger.
      if (result.failed || !result.finalMessage) {
        candidate.verdict = { verdict: "fail", summary: "Candidate produced no output to judge." };
      } else {
        ctx.agentsSpawned += 1;
        ctx.run.agentCount = ctx.agentsSpawned;
        const judgeSpawn = await port.spawn({
          phaseId: phase.id,
          phaseType: "verify",
          role: opts.judgeSpec.role,
          task: buildJudgeTask({
            originalTask: opts.task,
            candidateOutput: result.finalMessage,
            criteria: opts.judgeSpec.criteria,
          }),
          attempt: opts.attempt,
          index,
        });
        const judgeResult = await port.awaitAgent({
          agentId: judgeSpawn.agentId,
          signal: ctx.signal,
        });
        candidate.verdict = judgeResult.failed
          ? { verdict: "fail", summary: "Judger agent errored." }
          : parseVerdict(judgeResult.finalMessage);
      }
    }
    return candidate;
  });
}

function failRunForMissingRole(ctx: ExecuteRunContext, phase: RunPhase, role: string): void {
  setPhase(ctx, phase, {
    status: "failed",
    completedAt: ctx.port.now(),
    notes: `This team has no ${role}. Add one to the active team, or change the phase's role.`,
  });
  ctx.run.status = "failed";
  ctx.run.error = `Missing role "${role}" for phase "${phase.id}".`;
  ctx.run.updatedAt = ctx.port.now();
  void ctx.port.emit(ctx.run);
}

function appendNote(ctx: ExecuteRunContext, phase: RunPhase, note: string): void {
  phase.notes = phase.notes ? `${phase.notes} ${note}` : note;
  ctx.run.updatedAt = ctx.port.now();
}
