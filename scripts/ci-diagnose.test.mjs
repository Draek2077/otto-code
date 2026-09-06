import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { diagnosticCommand, diagnosticEnvironment } from "./ci-diagnose.mjs";

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

test("retains first-attempt browser failure traces without adding retries", () => {
  const plan = diagnosticCommand({
    suite: "playwright",
    file: "packages/app/e2e/browser/agent-message-submission.spec.ts",
  });
  assert.ok(plan.args.includes("--retries=0"));
  assert.ok(plan.args.includes("--trace=retain-on-failure"));
});

test("isolated temporary folders cannot discover the enclosing checkout", () => {
  const env = diagnosticEnvironment("server");
  const home = path.resolve(env.HOME);
  assert.ok(home.startsWith(path.resolve(".tmp/ci-diagnostic-")));
  try {
    const outside = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: env.TEMP,
      env,
      encoding: "utf8",
    });
    assert.equal(outside.status, 128, outside.stderr);
    assert.match(outside.stderr, /not a git repository/i);

    const repo = path.join(env.TEMP, "fixture-repo");
    mkdirSync(repo);
    const init = spawnSync("git", ["init", "-q", repo], { env, encoding: "utf8" });
    assert.equal(init.status, 0, init.stderr);
    const inside = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: repo,
      env,
      encoding: "utf8",
    });
    assert.equal(inside.status, 0, inside.stderr);
    assert.equal(path.resolve(inside.stdout.trim()), repo);
  } finally {
    rmSync(home, { recursive: true, force: true, maxRetries: 5 });
  }
});
