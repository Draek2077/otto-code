import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const serviceDir = path.dirname(fileURLToPath(import.meta.url));

test("Supervisor is the mandatory hosting-profile launch boundary", () => {
  const supervisor = readFileSync(path.join(serviceDir, "supervisor.ts"), "utf8");
  assert.match(supervisor, /resolveHostingProfileForLaunch\(/);
  assert.match(supervisor, /this\.profile = launchProfile/);
  assert.match(supervisor, /\{ \.\.\.launchProfile, modelPath:/);

  // These are every module that owns a model-starting workflow. They may pass a
  // plain profile to `start`, because Supervisor resolves it immediately before
  // spawning llama-server; keeping a second resolver here would recreate the
  // old per-call-site omission hazard.
  const launchers = [
    "serve.ts",
    "../tui/app.ts",
    "../commands/bench.ts",
    "../ops/calibrate.ts",
    "../ops/sweep.ts",
  ];
  for (const launcher of launchers) {
    const source = readFileSync(path.resolve(serviceDir, launcher), "utf8");
    assert.doesNotMatch(source, /resolveHostingProfileForLaunch/);
  }

  const bench = readFileSync(path.resolve(serviceDir, "../commands/bench.ts"), "utf8");
  assert.match(bench, /loadModel: async \(target\)/);
});
