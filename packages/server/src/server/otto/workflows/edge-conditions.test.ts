import { describe, expect, test } from "vitest";
import { evaluateWorkflowExpression } from "./expression-worker.js";
import {
  evaluateGraphCheck,
  resolveEdgeCondition,
  validateEdgeConditions,
  validateGraphChecks,
} from "./edge-conditions.js";

describe("bounded Workflow expressions", () => {
  test("routes declared output fields through the actual evaluator", async () => {
    const edge = { from: "a", to: "b", when: { expression: "score >= 8 and ready = true" } };
    expect(
      await resolveEdgeCondition(edge, { fields: { score: 9, ready: true }, output: "report" }),
    ).toMatchObject({ status: "delivers" });
    expect(
      await resolveEdgeCondition(edge, { fields: { score: 2, ready: true }, output: "report" }),
    ).toMatchObject({ status: "inactive" });
  });
  test("checks inspect only supplied upstream values", async () => {
    expect(
      await evaluateGraphCheck("upstream.a.fields.ok = true", {
        upstream: { a: { output: "", fields: { ok: true } } },
      }),
    ).toEqual({ passed: true });
    expect(await evaluateWorkflowExpression("$exists(process)", {})).toBe(false);
  });
  test("malformed expressions are actionable errors rather than skipped success", async () => {
    expect(
      validateEdgeConditions([{ from: "a", to: "b", when: { expression: "(" } }]),
    ).toHaveLength(1);
    expect(
      validateGraphChecks([{ id: "c", kind: "check", title: "Check", check: { expression: "(" } }]),
    ).toHaveLength(1);
    expect(await evaluateGraphCheck("(", { upstream: {} })).toHaveProperty("error");
  });
  test("oversized expressions and input fail before dispatch", async () => {
    expect(() => evaluateWorkflowExpression("x".repeat(4097), {})).toThrow(/4,096/);
    await expect(
      evaluateWorkflowExpression("value", { value: "x".repeat(1024 * 1024) }),
    ).rejects.toThrow(/budget/);
  });
  test("a nonterminating expression cannot block the daemon event loop", async () => {
    let responsive = false;
    const turn = new Promise<void>((resolve) =>
      setTimeout(() => {
        responsive = true;
        resolve();
      }, 10),
    );
    const execution = evaluateWorkflowExpression("($f := function($x){$f($x+1)}; $f(0))", {});
    await turn;
    expect(responsive).toBe(true);
    await expect(execution).rejects.toThrow(/budget|worker/);
    expect(await evaluateWorkflowExpression("2+3", {})).toBe(5);
  });
});
