import assert from "node:assert/strict";
import { test } from "vitest";

import { rankSweepResults, type SweepResult } from "./sweep.js";

/**
 * A trial that delivered the whole task. `contentPerSecond` is set to fall as
 * the budget rises - the shape a real sweep produces, since reasoning costs
 * wall clock and earns nothing on a pure-output task. The old ranking read that
 * column and so always crowned the smallest budget.
 */
function delivered(budget: number, contentPerSecond: number): SweepResult {
  return {
    budget,
    error: null,
    contentChars: 8000,
    filesDelivered: 4,
    contentPerSecond,
  };
}

test("recommends the largest budget that delivered the whole task", () => {
  const ranked = rankSweepResults([
    delivered(0, 900),
    delivered(512, 700),
    delivered(1536, 500),
    delivered(3072, 300),
  ]);

  assert.equal(ranked[0].budget, 3072);
  assert.deepEqual(
    ranked.map((result) => result.budget),
    [3072, 1536, 512, 0],
  );
});

test("delivery outranks budget size", () => {
  const ranked = rankSweepResults([
    delivered(512, 700),
    { ...delivered(3072, 300), filesDelivered: 2 },
  ]);

  // A bigger budget that dropped two files did not do the job.
  assert.equal(ranked[0].budget, 512);
});

test("never prefers an unrestricted budget over a finite cap", () => {
  const ranked = rankSweepResults([delivered(-1, 200), delivered(3072, 300), delivered(512, 700)]);

  assert.equal(ranked[0].budget, 3072);
  // The sentinel sorts last despite being the "biggest" budget of all.
  assert.equal(ranked.at(-1)?.budget, -1);
});

test("recommends an unrestricted budget only when every cap failed", () => {
  const ranked = rankSweepResults([
    delivered(-1, 200),
    { ...delivered(512, 700), error: "crashed", contentChars: 0 },
    { ...delivered(3072, 300), contentChars: 0 },
  ]);

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].budget, -1);
});

test("drops trials that errored or returned no content", () => {
  const ranked = rankSweepResults([
    { ...delivered(3072, 300), error: "timed out" },
    { ...delivered(1536, 500), contentChars: 0 },
    delivered(512, 700),
  ]);

  assert.deepEqual(
    ranked.map((result) => result.budget),
    [512],
  );
});

test("returns no recommendation when nothing was viable", () => {
  assert.deepEqual(rankSweepResults([{ ...delivered(512, 700), error: "crashed" }]), []);
});
