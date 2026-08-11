import { describe, expect, it } from "vitest";
import type { BrainCatalogModel, BrainInventoryModel } from "@otto-code/protocol/messages";
import { nonCatalogHuggingFaceModels, uniqueBrainInventoryModels } from "./library-model-filter";

function inventory(id: string): BrainInventoryModel {
  return { id, displayName: id, quant: "Q4_K_M" } as BrainInventoryModel;
}

function catalog(overrides: Partial<BrainCatalogModel> = {}): BrainCatalogModel {
  return {
    id: "publisher/main-repo/main-model.gguf",
    repo: "publisher/main-repo",
    ...overrides,
  } as BrainCatalogModel;
}

function component(id: string, file: string, hfRepo: string) {
  return {
    id,
    label: id,
    description: id,
    role: "vision_projector",
    hfRepo,
    file,
    required: false,
    defaultDownload: false,
    defaultLoad: false,
  };
}

describe("nonCatalogHuggingFaceModels", () => {
  it("keeps only installed artifacts not represented by a catalog primary or bundle component", () => {
    const models = [
      inventory("publisher/main-repo/main-model.gguf"),
      inventory("publisher/components/mmproj.gguf"),
      inventory("publisher/components/drafter.gguf"),
      inventory("another/repo/non-catalog-model.gguf"),
    ];
    const entries = [
      catalog({
        components: [
          component("projector", "mmproj.gguf", "publisher/components"),
          component("drafter", "drafter.gguf", "publisher/components"),
        ],
      }),
    ];

    expect(nonCatalogHuggingFaceModels(models, entries).map((model) => model.id)).toEqual([
      "another/repo/non-catalog-model.gguf",
    ]);
  });

  it("normalizes path separators and casing before comparing artifacts", () => {
    expect(
      nonCatalogHuggingFaceModels(
        [inventory("PUBLISHER\\MAIN-REPO\\MAIN-MODEL.GGUF")],
        [catalog()],
      ),
    ).toEqual([]);
  });

  it("keeps alternate catalog quants on the catalog row that owns bundle options", () => {
    expect(
      nonCatalogHuggingFaceModels(
        [inventory("publisher/main-repo/main-model-Q3_K_M.gguf")],
        [catalog()],
      ),
    ).toEqual([]);
  });
});

describe("uniqueBrainInventoryModels", () => {
  it("keeps one normalized artifact row and preserves its bundle capability", () => {
    const plain = inventory("publisher\\repo\\model.gguf");
    const bundled = { ...inventory("PUBLISHER/repo/model.gguf"), hasProjector: true };

    expect(uniqueBrainInventoryModels([plain, bundled])).toEqual([bundled]);
  });
});
