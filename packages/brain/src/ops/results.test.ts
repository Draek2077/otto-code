import { test } from "vitest";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

import {
  configKey,
  grouped,
  rankModels,
  resolveResultsDir,
  stats,
  variance,
  type RunRecord,
} from "./results.js";
import type { Profile } from "../config/schema.js";

function run(
  name: string,
  cfg: string,
  overall: number,
  taskScores: Record<string, number>,
  ranAt: string,
): RunRecord {
  return {
    model: { displayName: name },
    configKey: cfg,
    overall,
    ranAt,
    tasks: Object.entries(taskScores).map(([id, score]) => ({ id, category: id, score })),
  } as unknown as RunRecord;
}

test("benchmark scores use the writable Brain host home", () => {
  const home = path.join(os.homedir(), ".otto");
  assert.equal(resolveResultsDir({ OTTO_HOME: home }), path.join(home, "otto-brain", "results"));
});

test("stats computes count, mean, sample std, min and max", () => {
  const s = stats([0.7, 0.8, 0.9])!;
  assert.equal(s.count, 3);
  assert.ok(Math.abs(s.mean - 0.8) < 1e-9);
  assert.ok(Math.abs(s.std - 0.1) < 1e-9, `std ~0.1, got ${s.std}`);
  assert.equal(s.min, 0.7);
  assert.equal(s.max, 0.9);
  assert.equal(stats([]), null);
  assert.equal(stats([0.5])!.std, 0, "single run has zero spread");
});

test("grouped keeps all runs per config and numbers them oldest-first", () => {
  // loadAll order is newest-first; pass in that order.
  const records = [
    run("A", "ctx1", 0.9, { t: 0.9 }, "2026-07-30T03:00:00Z"),
    run("A", "ctx1", 0.8, { t: 0.8 }, "2026-07-30T02:00:00Z"),
    run("A", "ctx1", 0.7, { t: 0.7 }, "2026-07-30T01:00:00Z"),
    run("B", "ctx1", 0.6, { t: 0.6 }, "2026-07-30T00:00:00Z"),
  ];
  const groups = grouped(records);
  assert.equal(groups.length, 2);
  const a = groups.find((g) => g.model.displayName === "A")!;
  assert.equal(a.count, 3);
  // Oldest run (0.7) is run #1, newest (0.9) is run #3.
  assert.equal(a.runs.find((r) => r.overall === 0.7)!.runIndex, 1);
  assert.equal(a.runs.find((r) => r.overall === 0.9)!.runIndex, 3);
});

test("rankModels ranks by the mean of all a model runs, best first", () => {
  const records = [
    {
      model: { id: "a", displayName: "A" },
      configKey: "c1",
      overall: 0.7,
      ranAt: "2026-07-30T03:00:00Z",
      tasks: [],
    },
    {
      model: { id: "a", displayName: "A" },
      configKey: "c1",
      overall: 0.9,
      ranAt: "2026-07-30T02:00:00Z",
      tasks: [],
    },
    {
      model: { id: "b", displayName: "B" },
      configKey: "c1",
      overall: 0.6,
      ranAt: "2026-07-30T01:00:00Z",
      tasks: [],
    },
  ] as unknown as RunRecord[];
  const ranked = rankModels(records);
  assert.deepEqual(
    ranked.map((m) => m.id),
    ["a", "b"],
  );
  assert.ok(Math.abs(ranked[0].overall - 0.8) < 1e-9, "A = mean(0.7, 0.9) = 0.8, not its best run");
  assert.equal(ranked[0].runs, 2);
  assert.equal(ranked[0].grade, "strong");
  assert.equal(ranked[1].runs, 1);
  assert.equal(ranked[0].rank, 1);
});

test("variance reports spread across repeated runs, ranked by mean", () => {
  const records = [
    run("A", "ctx1", 0.9, { t: 0.9 }, "2026-07-30T03:00:00Z"),
    run("A", "ctx1", 0.7, { t: 0.7 }, "2026-07-30T02:00:00Z"),
    run("B", "ctx1", 0.6, { t: 0.6 }, "2026-07-30T01:00:00Z"),
  ];
  const v = variance(records);
  assert.deepEqual(
    v.map((x) => x.model.displayName),
    ["A", "B"],
    "ranked by mean overall",
  );
  const a = v[0];
  assert.equal(a.count, 2);
  assert.ok(Math.abs(a.overall!.mean - 0.8) < 1e-9);
  assert.ok(a.overall!.std > 0, "two differing runs have non-zero std");
  assert.ok(Math.abs(a.tasks.t.mean! - 0.8) < 1e-9);
  assert.equal(v[1].count, 1);
  assert.equal(v[1].overall!.std, 0);
});

// ---------------------------------------------------------------- configKey

/**
 * A profile shaped exactly as `ProfileSchema` would emit one for an untouched
 * model: engine defaults everywhere, nothing the user has touched. `configKey`
 * must return its historical (pre-schema-3) key for this, because that is the
 * whole point of the widening - unchanged setups keep their groups.
 */
function baseProfile(): Profile {
  return {
    modelId: null,
    modelPath: null,
    mmprojPath: null,
    enabledComponents: [],
    componentPaths: {},
    contextSize: 8192,
    cacheTypeK: "q8_0",
    cacheTypeV: "q8_0",
    flashAttention: true,
    gpuLayers: 999,
    vision: false,
    reasoningBudget: 1536,
    reasoningBudgetMessage: "",
    preserveReasoning: undefined,
    temperature: 0.8,
    topP: 0.95,
    topK: 40,
    minP: 0.05,
    presencePenalty: 0,
    repeatPenalty: 1,
    parallelSlots: 1,
    cachedChats: 0,
    contextMultiplier: 1,
    calibrationRequired: true,
    batchSize: null,
    ubatchSize: null,
    extraArgs: [],
    hostingProfileId: null,
    hostingProfileMode: "inherit",
    chatTemplateFile: null,
    chatTemplateKwargs: {},
    chatSystemAddendum: null,
  } as Profile;
}

test("configKey of an untouched profile is its historical key", () => {
  assert.equal(configKey(baseProfile()), "ctx8192_kvq8_0-q8_0_rb1536_novision");
});

test("configKey of a null profile is 'unknown'", () => {
  assert.equal(configKey(null), "unknown");
});

test("configKey adds a token only when a sampler deviates from the engine default", () => {
  const p = baseProfile();
  p.temperature = 0.3;
  assert.equal(configKey(p), "ctx8192_kvq8_0-q8_0_rb1536_novision_temp0.3");

  const q = baseProfile();
  q.topP = 0.9;
  q.minP = 0.01;
  assert.equal(configKey(q), "ctx8192_kvq8_0-q8_0_rb1536_novision_p0.9_minp0.01");
});

test("configKey tokens for contextMultiplier, cachedChats, preserveReasoning and hostingProfileId", () => {
  const p = baseProfile();
  p.contextMultiplier = 2;
  p.cachedChats = 4;
  p.preserveReasoning = true;
  p.hostingProfileId = "qwen-sharp";
  assert.equal(configKey(p), "ctx8192_kvq8_0-q8_0_rb1536_novision_x2_cc4_pr_hpqwen-sharp");

  const q = baseProfile();
  q.contextMultiplier = 2;
  q.cachedChats = 4;
  q.preserveReasoning = false;
  q.hostingProfileId = "qwen-sharp";
  assert.equal(configKey(q), "ctx8192_kvq8_0-q8_0_rb1536_novision_x2_cc4_nopr_hpqwen-sharp");
});

test("configKey leaves defaults and the null tri-state out of the key", () => {
  // contextMultiplier 1, cachedChats 0 and preserveReasoning null/undefined are
  // all "the engine does what it has always done", so none of them carry a token.
  assert.equal(configKey(baseProfile()), "ctx8192_kvq8_0-q8_0_rb1536_novision");

  const p = baseProfile();
  p.preserveReasoning = null;
  assert.equal(configKey(p), "ctx8192_kvq8_0-q8_0_rb1536_novision");
});

test("configKey deviates one setting at a time, so each split is attributable", () => {
  const a = baseProfile();
  a.temperature = 0.3;
  const b = baseProfile();
  b.topK = 20;
  assert.notEqual(configKey(a), configKey(b));
  assert.ok(configKey(a).endsWith("temp0.3"));
  assert.ok(configKey(b).endsWith("k20"));
});
