import { test } from "node:test";
import assert from "node:assert/strict";

import { renderAll, renderCard } from "../src/app.ts";
import type { Metric } from "../src/format.ts";

const rising: Metric = { id: "p95", label: "p95 latency", unit: "ms", samples: [100, 100, 200] };
const falling: Metric = { id: "err", label: "error rate", unit: "%", samples: [1, 1, 0.2] };

test("a card carries the metric label", () => {
  assert.match(renderCard(rising), /<p class="card__label">p95 latency<\/p>/);
});

test("a rising metric is tagged up so CSS can colour it", () => {
  assert.match(renderCard(rising), /data-trend="up"/);
});

test("a falling metric is tagged down", () => {
  assert.match(renderCard(falling), /data-trend="down"/);
});

test("a card embeds its sparkline", () => {
  assert.match(renderCard(rising), /<svg viewBox="0 0 240 48"/);
});

test("renderAll emits one article per metric", () => {
  const html = renderAll([rising, falling]);
  assert.equal(html.match(/<article class="card">/g)?.length, 2);
});

test("importing the module outside a browser does not touch the DOM", () => {
  assert.equal(typeof globalThis.document, "undefined");
});
