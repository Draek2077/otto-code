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
  assert.ok(args.includes("--no-ui"));
  assert.ok(!args.includes("--no-webui"));
  assert.deepEqual(args.slice(args.indexOf("-lv"), args.indexOf("-lv") + 2), ["-lv", "3"]);
  assert.ok(args.includes("--mmproj"));
  assert.ok(args.includes("--model-draft"));
  assert.equal(args[args.indexOf("--model-draft") + 1], "/models/draft.gguf");
});

test("passes the configured llama.cpp log verbosity", () => {
  const profile = {
    modelPath: "/models/main.gguf",
    contextSize: 8192,
    cacheTypeK: "q8_0",
    cacheTypeV: "q8_0",
    flashAttention: true,
    gpuLayers: 999,
    vision: false,
    reasoningBudget: 1536,
    parallelSlots: 1,
    extraArgs: [],
  } as Profile;

  const args = buildArgs(profile, { port: 20800, logVerbosity: 5 });

  assert.deepEqual(args.slice(args.indexOf("-lv"), args.indexOf("-lv") + 2), ["-lv", "5"]);
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

// --- Prompt cache (--cache-ram) ----------------------------------------------

const CACHE_MODEL = {
  id: "qwen3.8",
  displayName: "Qwen3.8",
  modelPath: "/models/qwen.gguf",
  mmprojPath: null,
  mmprojBytes: 0,
  quant: "Q4_K_M",
  sizeBytes: 0,
  features: { mtp: false, imatrix: false, distilled: false },
  metadata: null,
} satisfies Model;

const cacheProfile = (over: Partial<Profile>): Profile =>
  ({
    modelPath: "/models/qwen.gguf",
    contextSize: 262144,
    cacheTypeK: "q8_0",
    cacheTypeV: "q8_0",
    flashAttention: true,
    gpuLayers: 999,
    vision: false,
    reasoningBudget: 1536,
    parallelSlots: 2,
    cachedChats: 0,
    extraArgs: [],
    ...over,
  }) as Profile;

test("sizes --cache-ram from the chat count and the measured KV cost", () => {
  // The measured figure for this model on this repo's own calibration store.
  // One slot is 262144 / 2 = 131072 tokens, so a chat is ~5.0 GiB and four of
  // them are ~20 GiB - the number the user is really choosing when they pick 4.
  const args = buildArgs(cacheProfile({ cachedChats: 4 }), { port: 20800 }, CACHE_MODEL, {
    kvBytesPerToken: 40142.45,
    baseOverheadBytes: 0,
  });

  const mib = Number(args[args.indexOf("--cache-ram") + 1]);
  const expected = Math.round((40142.45 * 131072 * 4) / (1024 * 1024));
  assert.equal(mib, expected, "count x bytes/token x per-slot context");
  assert.ok(mib > 20000 && mib < 21000, `~20 GiB for four chats, got ${mib} MiB`);
});

test("halving the slots doubles the per-chat cache, because the slot is bigger", () => {
  const two = buildArgs(
    cacheProfile({ cachedChats: 2, parallelSlots: 2 }),
    { port: 1 },
    CACHE_MODEL,
    {
      kvBytesPerToken: 40142.45,
      baseOverheadBytes: 0,
    },
  );
  const one = buildArgs(
    cacheProfile({ cachedChats: 2, parallelSlots: 1 }),
    { port: 1 },
    CACHE_MODEL,
    {
      kvBytesPerToken: 40142.45,
      baseOverheadBytes: 0,
    },
  );

  const oneSlot = Number(one[one.indexOf("--cache-ram") + 1]);
  const twoSlot = Number(two[two.indexOf("--cache-ram") + 1]);
  // Within a MiB: each budget is rounded to whole MiB independently.
  assert.ok(
    Math.abs(oneSlot - twoSlot * 2) <= 1,
    `a chat's parked state is one slot's worth of KV (${oneSlot} vs ${twoSlot} x 2)`,
  );
});

test("leaves llama.cpp's own cache limit alone when the count is zero", () => {
  const args = buildArgs(cacheProfile({ cachedChats: 0 }), { port: 20800 }, CACHE_MODEL, {
    kvBytesPerToken: 40142.45,
    baseOverheadBytes: 0,
  });
  assert.ok(!args.includes("--cache-ram"), "0 means the engine default, not disabled");
});

test("does not size the cache from an unmeasured model", () => {
  // No calibration and no metadata to derive a theoretical figure from: naming
  // a byte budget here would reserve a number nobody measured.
  const args = buildArgs(cacheProfile({ cachedChats: 4 }), { port: 20800 }, CACHE_MODEL, null);
  assert.ok(!args.includes("--cache-ram"));
});
