import { test } from "vitest";
import assert from "node:assert/strict";

import { generateContextCorpus } from "./context-corpus.js";
import { findPython, runUnittestFiles } from "./verify.js";

test("generation is deterministic for a given target", () => {
  const a = generateContextCorpus({ targetTokens: 20_000 });
  const b = generateContextCorpus({ targetTokens: 20_000 });
  assert.deepEqual(a.files, b.files);
  assert.deepEqual(a.hiddenTest, b.hiddenTest);
  assert.deepEqual(
    a.stages.map((s) => [s.op, s.operand, s.expected]),
    b.stages.map((s) => [s.op, s.operand, s.expected]),
  );
});

test("the spec scales with the token target and stays bounded", () => {
  const small = generateContextCorpus({ targetTokens: 8_000 });
  const large = generateContextCorpus({ targetTokens: 120_000 });

  const specChars = (c: ReturnType<typeof generateContextCorpus>): number =>
    c.specFiles.reduce((sum, p) => sum + c.files[p].length, 0);

  // The spec carries the volume, so a bigger target means a bigger spec.
  assert.ok(specChars(large) > specChars(small) * 5, "large spec should dwarf the small one");
  // Stage count is clamped to a sane range regardless of target.
  assert.ok(small.stages.length >= 12 && small.stages.length <= 48);
  assert.ok(large.stages.length >= 12 && large.stages.length <= 48);
});

test("the code carries no operand; the spec does", () => {
  const { files, reference, stages, pyFiles } = generateContextCorpus({ targetTokens: 8_000 });
  const stage = stages[0];
  const file = `stage_${String(stage.index).padStart(2, "0")}.py`;

  // The buggy module is a passthrough with no operand in it.
  assert.match(files[file], /return x/);
  assert.doesNotMatch(files[file], new RegExp(String(stage.operand)));
  // The reference module encodes the operand; the spec names it.
  assert.match(reference[file], new RegExp(String(stage.operand)));
  const specText = Object.entries(files)
    .filter(([p]) => p.startsWith("docs/spec/"))
    .map(([, c]) => c)
    .join("\n");
  assert.match(specText, new RegExp(String(stage.operand)));
  // All runnable modules are flat basenames (the test harness flattens paths).
  for (const p of pyFiles) assert.doesNotMatch(p, /\//);
});

// The oracle must actually pass on the reference fix and fail on the placeholders.
// This runs the real interpreter, so it is gated on Python being present.
const oracleTest = findPython() ? test : test.skip;

oracleTest("reference fix passes the hidden oracle; the buggy corpus does not", async () => {
  const corpus = generateContextCorpus({ targetTokens: 8_000 });

  const fixed: Record<string, string> = { "test_pipeline.py": corpus.hiddenTest };
  for (const file of corpus.pyFiles) fixed[file] = corpus.reference[file];
  const passRun = await runUnittestFiles(fixed, "test_pipeline");
  assert.ok(passRun.ran, "python should have executed the suite");
  assert.equal(passRun.passed, passRun.total, "every stage test should pass on the reference fix");
  assert.ok((passRun.total ?? 0) > corpus.stages.length, "one test per stage plus end-to-end");

  const buggy: Record<string, string> = { "test_pipeline.py": corpus.hiddenTest };
  for (const file of corpus.pyFiles) buggy[file] = corpus.files[file];
  const failRun = await runUnittestFiles(buggy, "test_pipeline");
  assert.ok(failRun.ran);
  assert.ok((failRun.passed ?? 0) < (failRun.total ?? 0), "placeholders should fail most stages");
});
