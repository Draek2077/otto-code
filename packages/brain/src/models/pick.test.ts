import { test } from "vitest";
import assert from "node:assert/strict";

import { CommandError } from "../output/types.js";
import type { Model } from "../types.js";
import { pickAutoModel, pickModel } from "./pick.js";

function model(id: string, displayName = id): Model {
  return {
    id,
    displayName,
    modelPath: `/models/${id}.gguf`,
    mmprojPath: null,
    mmprojBytes: 0,
    quant: null,
    sizeBytes: 0,
    features: { mtp: false, imatrix: false, distilled: false },
    metadata: null,
  };
}

test("pickAutoModel throws NO_MODEL for an empty catalog", () => {
  assert.throws(
    () => pickAutoModel([]),
    (err: unknown) => {
      assert.ok(err instanceof CommandError);
      assert.equal(err.code, "NO_MODEL");
      return true;
    },
  );
});

test("pickAutoModel falls back to the first catalog entry with no bench history", () => {
  const catalog = [model("a"), model("b")];
  assert.equal(pickAutoModel(catalog, []), catalog[0]);
});

test("pickAutoModel prefers the best-ranked model that is still installed", () => {
  const catalog = [model("a"), model("b"), model("c")];
  const ranked = [
    { id: "z", displayName: "Z", overall: 0.9, runs: 3, std: 0, grade: "excellent", rank: 1 },
    { id: "b", displayName: "B", overall: 0.8, runs: 3, std: 0, grade: "strong", rank: 2 },
    { id: "a", displayName: "A", overall: 0.7, runs: 3, std: 0, grade: "usable", rank: 3 },
  ];
  assert.equal(pickAutoModel(catalog, ranked), catalog[1]);
});

test("pickModel still requires a needle (unchanged behavior)", () => {
  assert.throws(
    () => pickModel([model("a")], undefined),
    (err: unknown) => {
      assert.ok(err instanceof CommandError);
      assert.equal(err.code, "NO_MODEL");
      return true;
    },
  );
});
