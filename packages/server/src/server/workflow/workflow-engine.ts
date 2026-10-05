import {
  type Run,
  type RunPhase,
  type RunPhaseCandidate,
  type RunPlan,
  defaultRoleForPhaseType,
  isRunPhaseType,
} from "@otto-code/protocol/workflow";
import { JudgeVerdictSchema, judgeVerdictPassed } from "@otto-code/protocol/judge-verdict";

// The orchestration execution engine - pure control flow over injected seams, so
// it is unit-testable with fakes and reusable across whatever spawns the agents.
// The daemon RunService implements the RunEnginePort with real primitives
// (createAgentCommand / waitForAgentEvent / active-team role resolution); tests
// implement it with in-memory fakes.
//
// Design: phases run in DECLARED ORDER (a valid topo order - dependsOn only
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
  /** Durable diagnostic for a failed child, when the provider supplied one. */
  error?: string;
  /**
   * What the child submitted through submit_output, when its node declared
   * output fields (graph runs only). Already validated against the node's
   * contract by the tool itself - the engine only has to notice it arrived.
   * Absent/null means the tool was never called successfully, which sends the
   * engine to its prose fallback.
   */
  submittedOutput?: Record<string, unknown> | null;
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
   * null when no team member has the role - the engine hard-fails the run and
   * names the gap (the repo's no-fallback rule). Idempotent per role.
   */
  resolveRole(role: string): Promise<{ personalityId: string } | null>;
  /** Spawn one candidate child agent. */
  spawn(input: RunEngineSpawnInput): Promise<RunEngineSpawnResult>;
  /** Wait for a spawned child to reach a terminal state and return its output. */
  awaitAgent(input: { agentId: string; signal: AbortSignal }): Promise<RunEngineAwaitResult>;
  /**
   * Really stop one child agent - the cancel cascade. A canceled run must
   * terminate its in-flight children, not merely stop awaiting them (an
   * abandoned agent keeps running and keeps spending). Optional so in-memory
   * test ports keep working; absent means cancel only stops the await.
   */
  cancelAgent?(input: { agentId: string }): Promise<void>;
  /**
   * Send a follow-up instruction to a settled child so it carries on in its own
   * session - the iterative loop. The engine awaits the child again afterwards
   * through awaitAgent. Optional so in-memory ports keep working; an iterative
   * phase on a port without it fails the run and names the gap rather than
   * silently degrading to replacement, which is the mode the plan rejected.
   */
  continueAgent?(input: { agentId: string; task: string }): Promise<void>;
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
 * order) and that ids are unique - a malformed plan is rejected here, before any
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
    if (decl.mode === "iterative") {
      // The judge is what decides when a continued chat is finished; without
      // one the loop has no exit. A verify phase's candidate IS the judge and a
      // gate spawns nobody, so neither can iterate.
      if (!decl.judge) {
        throw new RunEngineError(
          `Phase "${decl.id}" is iterative but declares no judge; an iterative phase needs a judge to decide when its chat is done`,
          decl.id,
        );
      }
      if (decl.type === "verify" || decl.type === "gate") {
        throw new RunEngineError(
          `Phase "${decl.id}" is iterative, but a ${decl.type} phase cannot iterate`,
          decl.id,
        );
      }
    }
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
      ...(decl.mode ? { mode: decl.mode } : {}),
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
// validate it. Anything unparseable is a FAIL - a gate must never advance on a
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
 * throws for expected outcomes (gate rejection, missing role, cap trip) - those
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
  // The user's decision, not an error: the phase is canceled and the run
  // carries the reason so the library never shows a bare "canceled".
  setPhase(ctx, phase, {
    status: "canceled",
    completedAt: port.now(),
    notes: decision.note ?? "Rejected at gate.",
  });
  run.status = "canceled";
  run.error = decision.note
    ? `Rejected at gate "${phase.title}": ${decision.note}`
    : `Rejected at gate "${phase.title}".`;
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
  return !candidate.error && (candidate.verdict ? judgeVerdictPassed(candidate.verdict) : true);
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
  input: {
    judged: boolean;
    candidates: RunPhaseCandidate[];
    passers: number;
    /** Judged rounds an iterative phase ran; absent for the bounded loop. */
    iterations?: number;
  },
): Promise<void> {
  const { run, port } = ctx;
  // A spawned candidate is not a passing candidate. In particular, an
  // unjudged phase must not report success when every provider turn failed.
  const succeeded = input.passers > 0;
  const candidateError = input.candidates.find((candidate) => candidate.error)?.error;
  // Name the actual cause. A judged phase that produced no passer failed on the
  // work, not on the provider; telling the user to fix a configuration issue
  // sends them to the wrong place.
  const recovery =
    input.judged && !candidateError
      ? "Review the judge verdicts on the failed phase, then start a new Workflow with a narrower phase or an iterative one."
      : "Review the failed phase, correct the underlying provider or configuration issue, then start a new Workflow.";
  let notes: string | undefined;
  if (input.judged) {
    const after = input.iterations !== undefined ? ` after ${input.iterations} iteration(s)` : "";
    notes = `${input.passers}/${input.candidates.length} candidate(s) passed${after}.`;
  } else if (candidateError) {
    notes = `${candidateError} ${recovery}`;
  }
  setPhase(ctx, phase, {
    status: succeeded ? "done" : "failed",
    completedAt: port.now(),
    ...(notes ? { notes } : {}),
  });
  if (!succeeded) {
    run.status = "failed";
    run.error =
      run.error ??
      (candidateError
        ? `Phase "${phase.id}" failed: ${candidateError} ${recovery}`
        : `Phase "${phase.id}" produced no passing candidate. ${recovery}`);
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
// status update - so a judger grades real work; (2) don't fan out to sub-agents
// unless the task genuinely needs it, and if you do, wait for them and fold their
// results in before finishing. Pairs with waitForAgentFullySettled on the daemon
// side: that guarantees we WAIT for a worker's sub-agents; this discourages
// needless fan-out and half-done hand-backs in the first place.
const WORKER_TASK_FRAMING =
  "Return your finished result, not a progress update. Complete this yourself; only delegate to " +
  "sub-agents if the task genuinely requires it, and if you do, wait for them and incorporate their " +
  "output before you finish.";

// Compose the task an assignee actually receives: the declared task, prefixed
// with the outputs of the phases it depends on, followed by any loop feedback,
// and suffixed with the worker framing. Threading upstream results into the
// downstream prompt is what makes `dependsOn` mean "build on this", not just
// "run after this" - the child agent starts a fresh session with no memory of
// sibling phases, so their output must travel in the prompt. Dep blocks are kept
// terse: a labeled block per dependency. The framing stays last so it is the
// freshest instruction when the agent starts, even behind a long feedback block.
function composePhaseTask(
  ctx: ExecuteRunContext,
  phase: RunPhase,
  loopFeedback: string | null = null,
): string {
  const blocks: string[] = [];
  for (const depId of phase.dependsOn ?? []) {
    const dep = ctx.run.phases.find((p) => p.id === depId);
    const output = dep ? phaseOutput(dep) : null;
    if (output) {
      blocks.push(`From "${dep!.title}":\n${output}`);
    }
  }
  const base = blocks.length === 0 ? phase.task : `${blocks.join("\n\n")}\n\n${phase.task}`;
  const withFeedback = loopFeedback ? `${base}\n\n${loopFeedback}` : base;
  return `${withFeedback}\n\n${WORKER_TASK_FRAMING}`;
}

// Bound on each failed attempt's own report when it is fed back to a
// replacement candidate. The feedback has to sit beside the task, not crowd it
// out (docs/token-economy.md); the judge's unmet criteria carry the signal,
// the report is context.
const LOOP_FEEDBACK_REPORT_MAX_CHARS = 3_000;

const LOOP_FEEDBACK_HEADER =
  "A previous round of this phase did not pass. Build on what it did and address the judge's " +
  "feedback; do not repeat the same result.";

/**
 * What a replacement candidate learns from the round it replaces. Re-sending the
 * identical task makes every loop round rediscover the same ceiling (observed on
 * a real run: three candidates, three near-identical "incomplete" reports). The
 * judge's unmet criteria and the failed attempt's own report turn the loop into
 * iteration instead of repetition - the graph engine's judgeFeedback, for plans.
 * Only the failed candidates of the most recent round are carried: that round
 * already built on the feedback before it, and the block must stay bounded.
 * Null when nothing in the round failed (there is then no replacement to brief).
 */
export function buildLoopFeedback(previousRound: readonly RunPhaseCandidate[]): string | null {
  const failed = previousRound.filter((candidate) => !candidatePassed(candidate));
  if (failed.length === 0) {
    return null;
  }
  const blocks = failed.map((candidate, index) => {
    const label = failed.length === 1 ? "The previous attempt" : `Previous attempt ${index + 1}`;
    const lines: string[] = [];
    if (candidate.error) {
      lines.push(`${label} failed before producing a result: ${candidate.error}`);
    } else if (candidate.summary?.trim()) {
      lines.push(
        `${label} reported:\n${truncate(candidate.summary.trim(), LOOP_FEEDBACK_REPORT_MAX_CHARS)}`,
      );
    } else {
      lines.push(`${label} produced no output.`);
    }
    const verdict = candidate.verdict;
    if (verdict) {
      const summary = verdict.summary?.trim();
      lines.push(summary ? `The judge failed it: ${summary}` : "The judge failed it.");
      const unmet = renderUnmetCriteria(verdict);
      if (unmet) {
        lines.push(unmet);
      }
    }
    return lines.join("\n");
  });
  return `${LOOP_FEEDBACK_HEADER}\n\n${blocks.join("\n\n")}`;
}

// Only the criteria the judge marked unmet, each with its evidence: the part a
// worker can act on. Null when the verdict carried none.
function renderUnmetCriteria(verdict: NonNullable<RunPhaseCandidate["verdict"]>): string | null {
  const unmet = (verdict.criteria ?? []).filter((criterion) => !criterion.met);
  if (unmet.length === 0) {
    return null;
  }
  const items = unmet.map((criterion) => {
    const evidence = criterion.evidence?.trim();
    return evidence ? `- ${criterion.name}: ${evidence}` : `- ${criterion.name}`;
  });
  return `Unmet criteria:\n${items.join("\n")}`;
}

const CONTINUATION_HEADER =
  "The judge reviewed your last result and did not pass it. Continue in this same session from " +
  "where you stopped - do not start over, and do not repeat work that is already done.";

/**
 * The follow-up an iterative phase sends to a failed candidate's own chat. Unlike
 * buildLoopFeedback there is no "previous attempt reported" block: the chat
 * already holds its own output, so only the judge's verdict is news to it.
 */
export function buildContinuationPrompt(candidate: RunPhaseCandidate): string {
  const verdict = candidate.verdict;
  const lines: string[] = [];
  if (verdict) {
    const summary = verdict.summary?.trim();
    lines.push(summary ? `The judge said: ${summary}` : "The judge gave no summary.");
    const unmet = renderUnmetCriteria(verdict);
    if (unmet) {
      lines.push(unmet);
    }
  } else {
    lines.push("The judge gave no detail.");
  }
  return `${CONTINUATION_HEADER}\n\n${lines.join("\n")}\n\n${WORKER_TASK_FRAMING}`;
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
    parts.push(`- ${phase.notes}`);
  }
  const output = phaseOutput(phase);
  const line = parts.join(" ");
  return output ? `${line}\n    output: ${truncate(output.replace(/\s+/g, " "), 400)}` : line;
}

/**
 * Build the prompt a Writer uses to summarize a terminal run for the Runs
 * display. Feeds the run's shape (title, outcome, requirements, agent count) and
 * a compact per-phase digest with truncated outputs, and asks for a few plain
 * sentences - what it set out to do, what happened, the outcome, and why it
 * failed if it did.
 */
export function buildRunSummaryPrompt(run: Run): string {
  const header = [
    "Summarize this completed multi-agent orchestration run for a status display.",
    "Write 2–4 plain, concrete sentences covering: what the run set out to do, what happened",
    "across its phases at a high level, the final outcome, and - if it failed - the reason.",
    "Neutral tone. No preamble, no markdown, no headings - just the sentences.",
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

  if (phase.mode === "iterative") {
    await runIterativePhase(ctx, phase, {
      role,
      judgeSpec: judgeSpec ? { role: judgeRole, criteria: judgeSpec.criteria } : null,
    });
    return;
  }

  // Fold upstream dependency outputs into the task once; deps are terminal by
  // the time this phase runs, so this is stable across loop rounds. The judge
  // always grades against this declared task - never against a round's
  // feedback block, which is briefing for the maker, not acceptance criteria.
  const effectiveTask = composePhaseTask(ctx, phase);
  const isVerifyPhase = phase.type === "verify";
  const keepBest = phase.keepBest;
  const fanOut = phase.fanOut ?? 1;
  const candidates: RunPhaseCandidate[] = [];
  let passers = 0;
  let attempt = 0;
  // What the next loop round's replacements learn from the round before it.
  let loopFeedback: string | null = null;

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
      task: loopFeedback ? composePhaseTask(ctx, phase, loopFeedback) : effectiveTask,
      judgeTask: effectiveTask,
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
    loopFeedback = buildLoopFeedback(round);
  }

  // Cancellation is a distinct terminal outcome. The canceled child's failed
  // await result is expected after the cascade and must not overwrite it with
  // a provider-failure diagnosis before executeRun finalizes cancellation.
  if (ctx.signal.aborted) {
    return;
  }

  await finalizePhase(ctx, phase, {
    judged: isVerifyPhase || Boolean(judgeSpec),
    candidates,
    passers,
  });
}

/**
 * The iterative loop: spawn the candidates once, then CONTINUE each failed
 * candidate's own chat with the judge's unmet criteria instead of replacing it.
 * Open-ended work (inventory a platform, plan a project) is where a replacement
 * round is most wasteful: the context a fresh agent would have to rebuild is
 * exactly what the failed attempt already holds. Round accounting, caps and
 * finalization match the bounded loop so both read the same in the Runs display;
 * `maxLoopAttempts` bounds the judged rounds, the first one included.
 */
async function runIterativePhase(
  ctx: ExecuteRunContext,
  phase: RunPhase,
  input: { role: string | null; judgeSpec: { role: string; criteria?: readonly string[] } | null },
): Promise<void> {
  const { run, port } = ctx;
  const continueAgent = port.continueAgent;
  if (!continueAgent) {
    setPhase(ctx, phase, {
      status: "failed",
      completedAt: port.now(),
      notes:
        "This host cannot continue a child chat between rounds. Update the host to use iterative phases, or declare the phase as bounded.",
    });
    run.status = "failed";
    run.error = `Phase "${phase.id}" is iterative, but this host cannot continue child chats.`;
    await port.emit(run);
    return;
  }
  if (!input.judgeSpec) {
    // buildRunFromPlan rejects this shape; a persisted run cannot reach here.
    setPhase(ctx, phase, {
      status: "failed",
      completedAt: port.now(),
      notes: "An iterative phase needs a judge to decide when its chat is done.",
    });
    run.status = "failed";
    run.error = `Phase "${phase.id}" is iterative but has no judge.`;
    await port.emit(run);
    return;
  }
  const judgeSpec = input.judgeSpec;

  const effectiveTask = composePhaseTask(ctx, phase);
  const fanOut = phase.fanOut ?? 1;
  const target = phase.keepBest ?? 1;

  if (ctx.agentsSpawned + fanOut > ctx.caps.maxAgents) {
    appendNote(ctx, phase, `Agent cap (${ctx.caps.maxAgents}) reached; no candidate was spawned.`);
    await finalizePhase(ctx, phase, { judged: true, candidates: [], passers: 0, iterations: 0 });
    return;
  }

  const candidates = await runCandidateRound(ctx, phase, {
    role: input.role,
    task: effectiveTask,
    judgeTask: effectiveTask,
    count: fanOut,
    attempt: 0,
    isVerifyPhase: false,
    judgeSpec,
  });
  for (const candidate of candidates) {
    candidate.attempts = 1;
  }
  phase.candidates = candidates;
  await port.emit(run);

  let iterations = 1;
  let passers = candidates.filter(candidatePassed).length;
  while (!shouldStopLoop(ctx, target, passers, iterations)) {
    // A provider failure is not something a follow-up prompt can talk through;
    // only candidates the judge failed are continued.
    const continuing = candidates.filter(
      (candidate) => !candidatePassed(candidate) && !candidate.error,
    );
    if (continuing.length === 0) {
      break;
    }
    // Each continuation spawns one judge.
    if (ctx.agentsSpawned + continuing.length > ctx.caps.maxAgents) {
      appendNote(
        ctx,
        phase,
        `Agent cap (${ctx.caps.maxAgents}) reached; stopped after ${iterations} iteration(s).`,
      );
      break;
    }
    await mapWithConcurrency(continuing, ctx.caps.maxConcurrency, (candidate, index) =>
      continueCandidate(ctx, phase, {
        candidate,
        continueAgent,
        judgeTask: effectiveTask,
        judgeSpec,
        attempt: iterations,
        index,
      }),
    );
    iterations++;
    passers = candidates.filter(candidatePassed).length;
    await port.emit(run);
  }

  if (ctx.signal.aborted) {
    return;
  }
  await finalizePhase(ctx, phase, { judged: true, candidates, passers, iterations });
}

// One continuation round for one candidate: brief its chat with the verdict,
// wait for it to settle again, then re-judge. Mutates the candidate in place so
// the Runs display keeps one card per chat, with `attempts` counting rounds.
async function continueCandidate(
  ctx: ExecuteRunContext,
  phase: RunPhase,
  input: {
    candidate: RunPhaseCandidate;
    continueAgent: NonNullable<RunEnginePort["continueAgent"]>;
    judgeTask: string;
    judgeSpec: { role: string; criteria?: readonly string[] };
    attempt: number;
    index: number;
  },
): Promise<void> {
  const { candidate } = input;
  await input.continueAgent({
    agentId: candidate.agentId,
    task: buildContinuationPrompt(candidate),
  });
  const result = await awaitWithCancelCascade(ctx, candidate.agentId);
  candidate.attempts = (candidate.attempts ?? 1) + 1;
  if (result.finalMessage) {
    candidate.summary = result.finalMessage;
  }
  if (result.failed) {
    candidate.error = result.error ?? "The assigned agent failed before producing output.";
    candidate.verdict = { verdict: "fail", summary: "Candidate produced no output to judge." };
    return;
  }
  if (!result.finalMessage) {
    candidate.verdict = { verdict: "fail", summary: "Candidate produced no output to judge." };
    return;
  }
  candidate.verdict = await judgeCandidate(ctx, phase, {
    judgeTask: input.judgeTask,
    candidateOutput: result.finalMessage,
    judgeSpec: input.judgeSpec,
    attempt: input.attempt,
    index: input.index,
  });
}

// Grade one maker's output with a separate judger. Counts the judge against
// the run's caps like any other child.
async function judgeCandidate(
  ctx: ExecuteRunContext,
  phase: RunPhase,
  input: {
    judgeTask: string;
    candidateOutput: string;
    judgeSpec: { role: string; criteria?: readonly string[] };
    attempt: number;
    index: number;
  },
): Promise<RunPhaseCandidate["verdict"]> {
  ctx.agentsSpawned += 1;
  ctx.run.agentCount = ctx.agentsSpawned;
  const judgeSpawn = await ctx.port.spawn({
    phaseId: phase.id,
    phaseType: "verify",
    role: input.judgeSpec.role,
    task: buildJudgeTask({
      originalTask: input.judgeTask,
      candidateOutput: input.candidateOutput,
      criteria: input.judgeSpec.criteria,
    }),
    attempt: input.attempt,
    index: input.index,
  });
  const judgeResult = await awaitWithCancelCascade(ctx, judgeSpawn.agentId);
  return judgeResult.failed
    ? { verdict: "fail", summary: "Judger agent errored." }
    : parseVerdict(judgeResult.finalMessage);
}

// Spawn `count` candidates for a phase, await them, and (when judged) grade each.
async function runCandidateRound(
  ctx: ExecuteRunContext,
  phase: RunPhase,
  opts: {
    role: string | null;
    /**
     * What the maker receives: the effective task (declared task + upstream
     * dependency outputs), plus the previous round's feedback on loop rounds.
     */
    task: string;
    /** What the judge grades against: the effective task without loop feedback. */
    judgeTask: string;
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
    const result = await awaitWithCancelCascade(ctx, spawn.agentId);
    const candidate: RunPhaseCandidate = {
      agentId: spawn.agentId,
      ...(spawn.personalityId ? { personalityId: spawn.personalityId } : {}),
      ...(result.finalMessage ? { summary: result.finalMessage } : {}),
      ...(result.failed
        ? { error: result.error ?? "The assigned agent failed before producing output." }
        : {}),
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
        candidate.verdict = await judgeCandidate(ctx, phase, {
          judgeTask: opts.judgeTask,
          candidateOutput: result.finalMessage,
          judgeSpec: opts.judgeSpec,
          attempt: opts.attempt,
          index,
        });
      }
    }
    return candidate;
  });
}

/**
 * Await a child while a run cancel really cancels it. Stopping the await alone
 * abandons a live agent that keeps spending; when the port can cancel, a run
 * abort cascades to the in-flight child. Best-effort by contract.
 */
async function awaitWithCancelCascade(
  ctx: ExecuteRunContext,
  agentId: string,
): Promise<RunEngineAwaitResult> {
  const cancelChild = () => {
    void ctx.port.cancelAgent?.({ agentId });
  };
  if (ctx.signal.aborted) {
    cancelChild();
  } else {
    ctx.signal.addEventListener("abort", cancelChild, { once: true });
  }
  try {
    return await ctx.port.awaitAgent({ agentId, signal: ctx.signal });
  } finally {
    ctx.signal.removeEventListener("abort", cancelChild);
  }
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
