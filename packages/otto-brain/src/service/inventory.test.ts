import { expect, it } from "vitest";
import { BrainConfigSchema, ProfilesStoreSchema } from "../config/schema.js";
import type { Model } from "../types.js";
import type { RankedModel } from "../ops/results.js";
import { buildInventoryRow, type InventoryInput } from "./inventory.js";

function input(): InventoryInput {
  return {
    model: {
      id: "fixture/repo/model.gguf",
      displayName: "Same name",
      modelPath: "/fixture/model.gguf",
      mmprojPath: null,
      mmprojBytes: 0,
      sizeBytes: 1,
      quant: "Q4_K_M",
      metadata: null,
      features: { mtp: false, distilled: false, imatrix: false },
      catalogId: "fixture",
      catalogHfRepo: "fixture/repo",
    },
    store: ProfilesStoreSchema.parse({}),
    defaults: BrainConfigSchema.parse({}).defaults,
    gpu: null,
    ranking: [],
    state: "not-loaded",
    runtimeBuild: null,
  };
}

it("joins scores by exact model id before considering identity-less historical names", () => {
  const row = input();
  row.ranking = [
    { id: "other", displayName: "Same name", overall: 0.1 },
    { id: row.model.id, displayName: "Renamed", overall: 0.9 },
  ] as RankedModel[];
  const result = buildInventoryRow(row);
  expect(result.score!.overall).toBe(0.9);
  expect(result).toMatchObject({
    repo: "fixture/repo",
    catalogOwned: true,
    catalogId: "fixture",
    budget: null,
    maxContextThatFits: null,
  });
  expect(result).not.toHaveProperty("modelPath");
});

it("retains vision capability while explaining unavailable optional runtime components", () => {
  const row = input();
  row.model.components = [
    {
      id: "vision",
      label: "Vision",
      description: "Fixture",
      role: "vision_projector",
      path: null,
      bytes: 1,
      required: false,
      available: false,
      defaultDownload: true,
      defaultLoad: true,
      minRuntimeBuild: 100,
    },
  ];
  expect(buildInventoryRow(row)).toMatchObject({
    hasProjector: true,
    components: [{ available: false, unavailableReason: expect.stringContaining("b100") }],
  });
  row.runtimeBuild = 100;
  expect(buildInventoryRow(row).components![0]).toMatchObject({ id: "vision", available: false });
  expect(buildInventoryRow(row).components![0]).not.toHaveProperty("path");
});

it("does not borrow a different identified model's score just because names match", () => {
  const row = input();
  row.ranking = [
    { id: "other", displayName: row.model.displayName, overall: 0.8 },
  ] as RankedModel[];
  expect(buildInventoryRow(row).score).toBeNull();
  row.model = { ...row.model, metadata: { reasoning: true }, thinking: false } as Model;
  expect(buildInventoryRow(row).reasoning).toBe(true);
});
