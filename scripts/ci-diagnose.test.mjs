import assert from "node:assert/strict";
import test from "node:test";
import { diagnosticCommand } from "./ci-diagnose.mjs";

test("requires a real, exact test inside the selected workspace", () => {
  for (const file of [
    undefined,
    "packages/app/src",
    "packages/app/src/**/*.test.ts",
    "packages/app/../server/src/test.test.ts",
    "packages/app/src/not-present.test.ts",
  ]) {
    assert.throws(() => diagnosticCommand({ suite: "app-unit", file }));
  }
});

test("keeps browser cases out of the unit tier", () => {
  assert.throws(
    () =>
      diagnosticCommand({
        suite: "app-unit",
        file: "packages/app/src/runtime/expo-platform.browser.test.ts",
      }),
    /app-browser/,
  );
});

test("runs one worker and preserves a test title as one argument", () => {
  const title = "paste; echo not-a-shell-command";
  const plan = diagnosticCommand({
    suite: "app-unit",
    file: "packages/app/src/composer/input/labels.test.ts",
    testName: title,
  });
  assert.equal(plan.runner, "vitest");
  assert.ok(plan.args.includes("--maxWorkers=1"));
  assert.deepEqual(plan.args.slice(-2), ["--testNamePattern", title]);
});

test("rejects an unknown tier instead of falling back to the full suite", () => {
  assert.throws(() => diagnosticCommand({ suite: "all" }), /Choose a suite/);
});
