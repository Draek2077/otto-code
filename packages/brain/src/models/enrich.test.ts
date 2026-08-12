import { test } from "vitest";
import assert from "node:assert/strict";

import { enrichWithCatalog, matchCatalogEntry } from "./enrich.js";
import { CatalogSchema, type Catalog } from "../config/schema.js";
import type { Model } from "../types.js";

/** A minimal scanned model; id is the modelsDir-relative path scan.ts builds. */
function model(id: string, extra: Partial<Model> = {}): Model {
  return {
    id,
    displayName: id.split("/").pop() ?? id,
    modelPath: `/models/${id}`,
    mmprojPath: null,
    mmprojBytes: 0,
    quant: null,
    sizeBytes: 0,
    features: { mtp: false, imatrix: false, distilled: false },
    metadata: null,
    ...extra,
  };
}

function catalog(models: Catalog["models"]): Catalog {
  return CatalogSchema.parse({ models });
}

const CODER = {
  id: "qwen3-coder-30b",
  name: "Qwen3 Coder 30B",
  family: "qwen",
  hfRepo: "unsloth/Qwen3-Coder-30B-GGUF",
  quant: "Q4_K_M",
  quantFile: "Qwen3-Coder-30B-Q4_K_M.gguf",
  useCases: ["coding", "agentic"],
  tier: "A",
  thinking: false,
  contextMax: 262144,
};

test("attaches catalog coding metadata when a scanned path matches hfRepo", () => {
  const scanned = model("unsloth/Qwen3-Coder-30B-GGUF/Qwen3-Coder-30B-Q4_K_M.gguf");
  const [enriched] = enrichWithCatalog([scanned], catalog([CODER]));
  assert.deepEqual(enriched.useCases, ["coding", "agentic"]);
  assert.equal(enriched.tier, "A");
  assert.equal(enriched.thinking, false);
  assert.equal(enriched.contextMax, 262144);
  assert.equal(enriched.catalogId, "qwen3-coder-30b");
  assert.equal(enriched.catalogHfRepo, "unsloth/Qwen3-Coder-30B-GGUF");
  assert.equal(enriched.family, "qwen");
});

test("carries catalog reasoning efforts onto a scanned model", () => {
  const scanned = model("openai/gpt-oss-20b-GGUF/gpt-oss-20b-MXFP4.gguf");
  const [enriched] = enrichWithCatalog(
    [scanned],
    catalog([
      {
        ...CODER,
        id: "gpt-oss-20b",
        hfRepo: "openai/gpt-oss-20b-GGUF",
        reasoningEfforts: ["low", "medium", "high"],
      },
    ]),
  );
  assert.deepEqual(enriched.reasoningEfforts, ["low", "medium", "high"]);
});

test("matching is case-insensitive on the repo path", () => {
  const scanned = model("UNSLOTH/qwen3-coder-30b-gguf/Qwen3-Coder-30B-Q4_K_M.gguf");
  assert.equal(matchCatalogEntry(scanned, catalog([CODER]))?.id, "qwen3-coder-30b");
});

test("no match leaves coding fields undefined", () => {
  const scanned = model("someone/random-model-GGUF/random-Q4_K_M.gguf");
  const [enriched] = enrichWithCatalog([scanned], catalog([CODER]));
  assert.equal(matchCatalogEntry(scanned, catalog([CODER])), null);
  assert.equal(enriched.useCases, undefined);
  assert.equal(enriched.tier, undefined);
  assert.equal(enriched.catalogId, undefined);
});

test("empty catalog is safe and passes models through untouched", () => {
  const scanned = model("unsloth/Qwen3-Coder-30B-GGUF/Qwen3-Coder-30B-Q4_K_M.gguf");
  const [enriched] = enrichWithCatalog([scanned], catalog([]));
  assert.equal(enriched, scanned);
  assert.equal(enriched.useCases, undefined);
});

test("promotes a discovered projector to a removable managed component", () => {
  const scanned = model("someone/vision-GGUF/vision-Q4_K_M.gguf", {
    mmprojPath: "/models/someone/vision-GGUF/mmproj-F16.gguf",
    mmprojBytes: 512_000_000,
  });
  const [enriched] = enrichWithCatalog([scanned], catalog([]));
  assert.deepEqual(enriched.components, [
    {
      id: "vision-projector",
      label: "Vision projector",
      description: "Adds image understanding",
      role: "vision_projector",
      path: "/models/someone/vision-GGUF/mmproj-F16.gguf",
      bytes: 512_000_000,
      required: false,
      defaultDownload: false,
      defaultLoad: true,
      available: true,
    },
  ]);
});

test("a partial repo-segment prefix does not match", () => {
  // "unsloth/Qwen3-Coder-30B-GGUF" must not match a sibling repo whose name
  // merely starts with the same characters.
  const scanned = model("unsloth/Qwen3-Coder-30B-GGUF-Extra/file-Q4_K_M.gguf");
  assert.equal(matchCatalogEntry(scanned, catalog([CODER])), null);
});

test("a repo with several quants is disambiguated by file name", () => {
  const q4 = { ...CODER, id: "coder-q4", quant: "Q4_K_M", quantFile: "coder-Q4_K_M.gguf" };
  const q8 = { ...CODER, id: "coder-q8", quant: "Q8_0", quantFile: "coder-Q8_0.gguf" };
  const scanned = model("unsloth/Qwen3-Coder-30B-GGUF/coder-Q8_0.gguf", { quant: "Q8_0" });
  assert.equal(matchCatalogEntry(scanned, catalog([q4, q8]))?.id, "coder-q8");
});

test("falls back to quant match when no exact file name is given", () => {
  const q4 = { ...CODER, id: "coder-q4", quant: "Q4_K_M", quantFile: undefined };
  const q8 = { ...CODER, id: "coder-q8", quant: "Q8_0", quantFile: undefined };
  const scanned = model("unsloth/Qwen3-Coder-30B-GGUF/coder-Q8_0.gguf", { quant: "Q8_0" });
  assert.equal(matchCatalogEntry(scanned, catalog([q4, q8]))?.id, "coder-q8");
});
