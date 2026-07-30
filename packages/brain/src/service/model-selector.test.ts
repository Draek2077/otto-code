import { describe, expect, it } from "vitest";

import { MAX_TRUSTED_STD, MIN_TRUSTED_RUNS, selectCodingModel } from "./model-selector.js";
import type { RankedModel } from "../ops/results.js";
import type { Model } from "../types.js";

/** A minimal Model; only the fields the selector reads carry meaning. */
function model(id: string, over: Partial<Model> = {}): Model {
  return {
    id,
    displayName: id,
    modelPath: `/models/${id}.gguf`,
    mmprojPath: null,
    mmprojBytes: 0,
    quant: null,
    sizeBytes: 4_000_000_000,
    features: { mtp: false, imatrix: false, distilled: false },
    metadata: null,
    ...over,
  };
}

function ranked(displayName: string, overall: number, runs: number, std: number): RankedModel {
  return { id: displayName, displayName, overall, runs, std, grade: "usable" };
}

describe("selectCodingModel", () => {
  it("keeps only coding-tagged models as candidates", () => {
    const coder = model("coder", { useCases: ["coding"] });
    const chatter = model("chatter", { useCases: ["chat"] });
    // chatter would win on raw score, but it is not coding-capable.
    const ranking = [ranked("chatter", 0.95, 5, 0.02), ranked("coder", 0.6, 5, 0.02)];
    const pick = selectCodingModel({
      models: [chatter, coder],
      ranking,
      fallback: chatter,
    });
    expect(pick?.id).toBe("coder");
  });

  it("recognises a coding specialist by tier when useCases is absent", () => {
    const coder = model("spec", { tier: "coding-specialist" });
    const other = model("other", { tier: "general" });
    const pick = selectCodingModel({ models: [other, coder], ranking: [], fallback: other });
    expect(pick?.id).toBe("spec");
  });

  it("ranks trusted scores above untrusted ones (confidence gate)", () => {
    const strong = model("strong", { useCases: ["coding"] });
    const noisy = model("noisy", { useCases: ["coding"] });
    // noisy has a higher mean but its std exceeds the gate -> not trusted.
    const ranking = [
      ranked("strong", 0.7, MIN_TRUSTED_RUNS, MAX_TRUSTED_STD - 0.01),
      ranked("noisy", 0.9, MIN_TRUSTED_RUNS, MAX_TRUSTED_STD + 0.1),
    ];
    const pick = selectCodingModel({ models: [noisy, strong], ranking, fallback: strong });
    expect(pick?.id).toBe("strong");
  });

  it("treats a single-run score as untrusted (runs below the gate)", () => {
    const single = model("single", { useCases: ["coding"] });
    const backed = model("backed", { useCases: ["coding"] });
    const ranking = [
      // Higher mean but only one run -> falsely confident, not trusted.
      ranked("single", 0.95, MIN_TRUSTED_RUNS - 1, 0),
      ranked("backed", 0.6, MIN_TRUSTED_RUNS + 3, 0.03),
    ];
    const pick = selectCodingModel({ models: [single, backed], ranking, fallback: single });
    expect(pick?.id).toBe("backed");
  });

  it("excludes models that do not fit the VRAM budget", () => {
    const big = model("big", { useCases: ["coding"], sizeBytes: 40_000_000_000 });
    const small = model("small", { useCases: ["coding"], sizeBytes: 4_000_000_000 });
    // big scores higher but the fit predicate rejects it.
    const ranking = [ranked("big", 0.95, 5, 0.02), ranked("small", 0.6, 5, 0.02)];
    const fits = (m: Model): boolean => m.sizeBytes < 10_000_000_000;
    const pick = selectCodingModel({
      models: [big, small],
      ranking,
      fits,
      fallback: big,
    });
    expect(pick?.id).toBe("small");
  });

  it("returns the fallback when no candidate fits the budget", () => {
    const big = model("big", { useCases: ["coding"], sizeBytes: 40_000_000_000 });
    const fallback = model("loaded");
    const pick = selectCodingModel({
      models: [big],
      ranking: [],
      fits: () => false,
      fallback,
    });
    expect(pick?.id).toBe("loaded");
  });

  it("falls back to all models when none are coding-tagged (no fail-closed)", () => {
    const a = model("a");
    const b = model("b");
    const ranking = [ranked("b", 0.8, 5, 0.02), ranked("a", 0.5, 5, 0.02)];
    const pick = selectCodingModel({ models: [a, b], ranking, fallback: a });
    expect(pick?.id).toBe("b");
  });

  it("returns the fallback when the model set is empty", () => {
    const fallback = model("loaded");
    const pick = selectCodingModel({ models: [], ranking: [], fallback });
    expect(pick?.id).toBe("loaded");
  });

  it("prefers the loaded model as a deterministic tiebreak on equal scores", () => {
    const x = model("x", { useCases: ["coding"] });
    const y = model("y", { useCases: ["coding"] });
    const ranking = [ranked("x", 0.7, 5, 0.02), ranked("y", 0.7, 5, 0.02)];
    const pick = selectCodingModel({
      models: [x, y],
      ranking,
      preferLoadedId: "y",
      fallback: x,
    });
    expect(pick?.id).toBe("y");
  });

  it("breaks a remaining tie by larger advertised context, then name", () => {
    const wide = model("wide", { useCases: ["coding"], contextMax: 128_000 });
    const narrow = model("narrow", { useCases: ["coding"], contextMax: 8_000 });
    const ranking = [ranked("wide", 0.7, 5, 0.02), ranked("narrow", 0.7, 5, 0.02)];
    const pick = selectCodingModel({ models: [narrow, wide], ranking, fallback: narrow });
    expect(pick?.id).toBe("wide");
  });
});
