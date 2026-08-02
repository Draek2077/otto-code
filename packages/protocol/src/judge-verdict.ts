import { z } from "zod";

// The structured verdict a `judger` returns when it evaluates work or a plan, so
// an orchestrator can branch mechanically instead of parsing prose. This is the
// canonical shape shared by the daemon and the app; the orchestration runtime
// (see projects/agent-orchestration) enforces it at the worker tool boundary and
// reads `verdict`/`score` directly to drive gates and the loop-until-N-good
// pattern. Absorbs upstream Paseo's `verify·spec` auditor output ("YES/NO per
// acceptance criterion, with evidence").
//
// Wire-forward-compat: kept a pure structural schema with plain leaves (no
// transforms), so it can later ride a protocol message without breaking older
// peers. The outcome rides as a plain string (like personality roles and effort
// levels) rather than a z.enum, so the vocabulary can grow — consumers normalize
// through `isJudgeOutcome` / `normalizeJudgeOutcome` instead of trusting the raw
// value.

// The pass/fail decision. Binary is enough for the signature loop-until-N-good
// pattern (keep passers, replace failers); a richer vocabulary can be added
// later without breaking peers because the field is a plain string on the wire.
export const JUDGE_OUTCOMES = ["pass", "fail"] as const;
export type JudgeOutcome = (typeof JUDGE_OUTCOMES)[number];

const OUTCOME_SET: ReadonlySet<string> = new Set(JUDGE_OUTCOMES);

export function isJudgeOutcome(value: string): value is JudgeOutcome {
  return OUTCOME_SET.has(value);
}

/**
 * Coerce a raw verdict string to a known outcome. Anything that isn't an exact
 * known outcome is treated as `"fail"` — an unparseable verdict must not be read
 * as a pass, so a gate never advances on a value it doesn't understand.
 */
export function normalizeJudgeOutcome(value: string | undefined): JudgeOutcome {
  return value !== undefined && isJudgeOutcome(value) ? value : "fail";
}

// One acceptance criterion the judge checked, with the evidence that settles it
// (a file/line, a test name, an observed behavior). `met` is the machine-readable
// bit; `evidence` is the human-auditable why.
export const JudgeCriterionSchema = z
  .object({
    name: z.string().min(1),
    met: z.boolean(),
    evidence: z.string().optional(),
  })
  .passthrough();

export type JudgeCriterion = z.infer<typeof JudgeCriterionSchema>;

export const JudgeVerdictSchema = z
  .object({
    // "pass" | "fail" as a plain string (forward-compat); read through
    // normalizeJudgeOutcome, never trusted raw.
    verdict: z.string().min(1),
    // 0..1 quality/confidence score, used to rank passers when the conductor
    // wants the best N of several candidates.
    score: z.number().min(0).max(1).optional(),
    // Per-criterion breakdown. Optional (absent = none reported) rather than
    // defaulted, per the protocol rule against array defaults on wire schemas.
    criteria: z.array(JudgeCriterionSchema).optional(),
    // One-line human summary of the call.
    summary: z.string().optional(),
  })
  .passthrough();

export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;

/** True when the verdict's outcome normalizes to `"pass"`. */
export function judgeVerdictPassed(verdict: Pick<JudgeVerdict, "verdict">): boolean {
  return normalizeJudgeOutcome(verdict.verdict) === "pass";
}
