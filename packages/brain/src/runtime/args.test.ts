import assert from "node:assert/strict";
import { test } from "vitest";

import { buildArgs } from "./args.js";
import type { Profile } from "../config/schema.js";
import type { Model } from "../types.js";

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

test("passes a supported model's preserve reasoning setting through its native template argument", () => {
  const profile = {
    modelPath: "/models/qwen.gguf",
    contextSize: 8192,
    cacheTypeK: "q8_0",
    cacheTypeV: "q8_0",
    flashAttention: true,
    gpuLayers: 999,
    vision: false,
    reasoningBudget: 1536,
    preserveReasoning: false,
    parallelSlots: 1,
    extraArgs: [],
  } as Profile;
  const model = {
    id: "qwen3.8",
    displayName: "Qwen3.8",
    modelPath: "/models/qwen.gguf",
    mmprojPath: null,
    mmprojBytes: 0,
    quant: "Q4_K_M",
    sizeBytes: 0,
    features: { mtp: false, imatrix: false, distilled: false },
    metadata: null,
    reasoningPreservation: { templateArgument: "preserve_thinking", default: true },
  } satisfies Model;

  const args = buildArgs(profile, { port: 20800 }, model);
  const raw = args[args.indexOf("--chat-template-kwargs") + 1];
  assert.deepEqual(JSON.parse(raw!), { preserve_thinking: false });
});
