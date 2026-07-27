import { test } from "node:test";
import assert from "node:assert/strict";

import { formatNumber, mean, percentChange, sum, trendOf } from "../src/format.ts";
import { sparklinePoints, sparklineSvg } from "../src/sparkline.ts";

test("sum adds every value", () => {
  assert.equal(sum([1, 2, 3]), 6);
  assert.equal(sum([]), 0);
});

test("mean of an empty series is zero rather than NaN", () => {
  assert.equal(mean([]), 0);
  assert.equal(mean([2, 4]), 3);
});

test("a single sample is flat by definition", () => {
  assert.equal(trendOf([5]), "flat");
  assert.equal(trendOf([]), "flat");
});

test("trend compares the latest against the baseline", () => {
  assert.equal(trendOf([10, 10, 20]), "up");
  assert.equal(trendOf([20, 20, 10]), "down");
});

test("trend respects the tolerance band", () => {
  assert.equal(trendOf([100, 100, 101]), "flat");
  assert.equal(trendOf([100, 100, 101], 0.001), "up");
});

test("formatNumber rounds large values and keeps one decimal for small ones", () => {
  assert.equal(formatNumber(1234.6, "ms"), "1,235ms");
  assert.equal(formatNumber(9.87, "%"), "9.9%");
});

test("percentChange has no baseline to work from with one sample", () => {
  assert.equal(percentChange([5]), "—");
  assert.equal(percentChange([0, 0]), "—");
});

test("percentChange signs an increase", () => {
  assert.equal(percentChange([10, 10, 20]), "+100.0%");
});

test("sparkline spans the full width", () => {
  const points = sparklinePoints([1, 2, 3], { width: 100, height: 20, padding: 0 });
  assert.equal(points, "0.0,20.0 50.0,10.0 100.0,0.0");
});

test("a flat series pins to the middle instead of dividing by zero", () => {
  const points = sparklinePoints([5, 5, 5], { width: 100, height: 20, padding: 0 });
  assert.ok(!points.includes("NaN"), `expected no NaN, got ${points}`);
});

test("an empty series produces no points", () => {
  assert.equal(sparklinePoints([]), "");
});

test("sparklineSvg carries an accessible label", () => {
  const svg = sparklineSvg({ id: "p95", label: "p95 latency", samples: [1, 2], unit: "ms" });
  assert.match(svg, /aria-label="p95 latency trend"/);
  assert.match(svg, /<polyline /);
});
