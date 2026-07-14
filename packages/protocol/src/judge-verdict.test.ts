import { describe, expect, test } from "vitest";

import {
  JudgeVerdictSchema,
  isJudgeOutcome,
  judgeVerdictPassed,
  normalizeJudgeOutcome,
} from "./judge-verdict.js";

describe("judge outcome normalization", () => {
  test("recognizes the known outcomes", () => {
    expect(isJudgeOutcome("pass")).toBe(true);
    expect(isJudgeOutcome("fail")).toBe(true);
    expect(isJudgeOutcome("maybe")).toBe(false);
  });

  test("an unknown or missing verdict normalizes to fail, never pass", () => {
    // A gate must not advance on a value it can't parse.
    expect(normalizeJudgeOutcome("revise")).toBe("fail");
    expect(normalizeJudgeOutcome(undefined)).toBe("fail");
    expect(normalizeJudgeOutcome("PASS")).toBe("fail"); // case-sensitive by design
    expect(normalizeJudgeOutcome("pass")).toBe("pass");
  });

  test("judgeVerdictPassed reads through normalization", () => {
    expect(judgeVerdictPassed({ verdict: "pass" })).toBe(true);
    expect(judgeVerdictPassed({ verdict: "fail" })).toBe(false);
    expect(judgeVerdictPassed({ verdict: "garbage" })).toBe(false);
  });
});

describe("JudgeVerdictSchema", () => {
  test("parses a full verdict", () => {
    const parsed = JudgeVerdictSchema.parse({
      verdict: "pass",
      score: 0.9,
      criteria: [
        { name: "compiles", met: true, evidence: "npm run typecheck green" },
        { name: "handles empty input", met: true },
      ],
      summary: "Meets every criterion.",
    });
    expect(parsed.criteria).toHaveLength(2);
    expect(judgeVerdictPassed(parsed)).toBe(true);
  });

  test("accepts a minimal verdict with only the outcome", () => {
    const parsed = JudgeVerdictSchema.parse({ verdict: "fail" });
    expect(parsed.criteria).toBeUndefined();
    expect(parsed.score).toBeUndefined();
  });

  test("rejects a score outside 0..1", () => {
    expect(() => JudgeVerdictSchema.parse({ verdict: "pass", score: 1.5 })).toThrow();
  });

  test("rejects an empty verdict string", () => {
    expect(() => JudgeVerdictSchema.parse({ verdict: "" })).toThrow();
  });
});
