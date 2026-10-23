import { test } from "vitest";
import assert from "node:assert/strict";

import { collectOracleRun, scoreTestDeltas } from "./repo-task.js";

import type { TestResult } from "./repo.js";
import type { OracleTestRun } from "./repo-task.js";

function run(passed: string[], failed: string[], importFailed: string[] = []): OracleTestRun {
  return {
    passed: new Set(passed),
    failed: new Set(failed),
    importFailed: new Set(importFailed),
  };
}

test("a fix that turns every failing oracle test green scores 1", () => {
  const before = run(["a.test.ts::keeps"], ["a.test.ts::bug1", "a.test.ts::bug2"]);
  const after = run(["a.test.ts::keeps", "a.test.ts::bug1", "a.test.ts::bug2"], []);
  const delta = scoreTestDeltas(before, after);
  assert.equal(delta.score, 1);
  assert.equal(delta.fixed, 2);
  assert.equal(delta.targets, 2);
  assert.equal(delta.regressions, 0);
});

test("a partial fix scores the fraction of previously-failing tests now passing", () => {
  const before = run(
    [],
    ["a.test.ts::bug1", "a.test.ts::bug2", "a.test.ts::bug3", "a.test.ts::bug4"],
  );
  const after = run(["a.test.ts::bug1", "a.test.ts::bug2"], ["a.test.ts::bug3", "a.test.ts::bug4"]);
  const delta = scoreTestDeltas(before, after);
  assert.equal(delta.score, 0.5);
  assert.equal(delta.fixed, 2);
  assert.equal(delta.targets, 4);
});

test("regressing a previously-passing test discounts the score", () => {
  // Both targets fixed (fraction 1) but 1 of 2 previously-passing tests broke, so
  // the regression guard halves the score.
  const before = run(
    ["a.test.ts::keep1", "a.test.ts::keep2"],
    ["a.test.ts::bug1", "a.test.ts::bug2"],
  );
  const after = run(
    ["a.test.ts::keep1", "a.test.ts::bug1", "a.test.ts::bug2"],
    ["a.test.ts::keep2"],
  );
  const delta = scoreTestDeltas(before, after);
  assert.equal(delta.fixed, 2);
  assert.equal(delta.regressions, 1);
  assert.equal(delta.score, 0.5);
});

test("a baseline with no failures is degenerate and scores 0", () => {
  const before = run(["a.test.ts::x"], []);
  const after = run(["a.test.ts::x"], []);
  const delta = scoreTestDeltas(before, after);
  assert.equal(delta.degenerate, true);
  assert.equal(delta.score, 0);
});

test("an oracle file that could not import at baseline treats its post-fix tests as targets", () => {
  // The buggy source is missing a symbol, so the test file never loads and has no
  // failing assertions - only an import failure. After the fix it loads and its
  // tests pass; all of them count as fixed.
  const before = run([], [], ["a.test.ts"]);
  const after = run(["a.test.ts::new1", "a.test.ts::new2"], []);
  const delta = scoreTestDeltas(before, after);
  assert.equal(delta.degenerate, false);
  assert.equal(delta.targets, 2);
  assert.equal(delta.fixed, 2);
  assert.equal(delta.score, 1);
});

test("a fix that breaks importing a previously-passing oracle file counts as a regression", () => {
  const before = run(["a.test.ts::keep"], ["a.test.ts::bug"]);
  // The fix made bug pass but broke the whole file's import, so keep regressed.
  const after = run([], [], ["a.test.ts"]);
  const delta = scoreTestDeltas(before, after);
  assert.equal(delta.regressions, 1);
  // No target test surfaced as passing after the import broke, so nothing fixed.
  assert.equal(delta.fixed, 0);
  assert.equal(delta.score, 0);
});

test("collectOracleRun keeps only oracle files and folds import failures", () => {
  const result: TestResult = {
    ok: false,
    parsed: true,
    passed: new Set(["oracle.test.ts::a", "other.test.ts::z"]),
    failed: new Set(["oracle.test.ts::b", "other.test.ts::y"]),
    fileFailures: [
      { file: "oracle2.test.ts", message: "cannot find module" },
      { file: "unrelated.test.ts", message: "boom" },
    ],
  };
  const oracle = collectOracleRun(result, new Set(["oracle.test.ts", "oracle2.test.ts"]));
  assert.deepEqual([...oracle.passed], ["oracle.test.ts::a"]);
  assert.deepEqual([...oracle.failed], ["oracle.test.ts::b"]);
  assert.deepEqual([...oracle.importFailed], ["oracle2.test.ts"]);
});
