import assert from "node:assert/strict";
import { test } from "vitest";

import { buildArgs } from "./args.js";
import type { Profile } from "../config/schema.js";

test("emits only enabled component paths for llama.cpp", () => {
  const profile = {
    modelPath: "/models/main.gguf",
    mmprojPath: "/models/mmproj.gguf",
    componentPaths: { speculative_drafter: "/models/draft.gguf" },
    contextSize: 8192,
    cacheTypeK: "q8_0",
    cacheTypeV: "q8_0",
    flashAttention: true,
    gpuLayers: 999,
    vision: true,
    reasoningBudget: 1536,
    parallelSlots: 1,
    extraArgs: [],
  } as Profile;
  const args = buildArgs(profile, { port: 20800 });
  assert.deepEqual(args.slice(-4), ["--reasoning-budget", "1536", "--parallel", "1"]);
  assert.ok(args.includes("--mmproj"));
  assert.ok(args.includes("--model-draft"));
  assert.equal(args[args.indexOf("--model-draft") + 1], "/models/draft.gguf");
});
