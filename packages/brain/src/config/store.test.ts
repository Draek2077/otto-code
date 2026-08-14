import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadCatalog } from "./store.js";
import type { BrainPaths } from "./paths.js";

const roots: string[] = [];

function testPaths(): BrainPaths {
  const root = mkdtempSync(path.join(tmpdir(), "otto-brain-catalog-"));
  roots.push(root);
  return {
    home: root,
    root,
    configFile: path.join(root, "config.json"),
    profilesFile: path.join(root, "profiles.json"),
    catalogFile: path.join(root, "catalog.json"),
    renameMapFile: path.join(root, "rename-map.json"),
    modelsDir: path.join(root, "models"),
    runtimesDir: path.join(root, "runtimes"),
    pidFile: path.join(root, "otto-brain.pid"),
    activityFile: path.join(root, "otto-brain.activity"),
    logFile: path.join(root, "otto-brain.log"),
    logsDir: path.join(root, "logs"),
    resultsDir: path.join(root, "results"),
    templatesDir: path.join(root, "templates"),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("loadCatalog", () => {
  it("refreshes shipped catalog entries while preserving user-added models", () => {
    const paths = testPaths();
    const seeded = loadCatalog(paths);
    const curated = seeded.models[0];
    const replacement = seeded.models.find((model) => model.replaces?.length);
    expect(curated).toBeDefined();
    expect(replacement).toBeDefined();

    const oldCurated = { ...curated, name: "Old name", why: "Old description" };
    const userModel = {
      id: "example/private-model.gguf",
      name: "My private model",
      hfRepo: "example/private-model",
      quant: "Q4_K_M",
    };
    const retiredModel = {
      id: replacement?.replaces?.[0] ?? "",
      name: "Retired Otto model",
      hfRepo: "Qwen/retired-model",
      quant: "Q5_K_M",
    };
    const removedCuratedModel = {
      id: seeded.retiredModelIds[0] ?? "",
      name: "Removed Otto model",
      hfRepo: "Qwen/removed-model",
      quant: "Q4_K_M",
    };
    writeFileSync(
      paths.catalogFile,
      `${JSON.stringify(
        { version: 1, models: [oldCurated, userModel, retiredModel, removedCuratedModel] },
        null,
        2,
      )}\n`,
    );

    const catalog = loadCatalog(paths);

    expect(catalog.models.find((model) => model.id === curated.id)).toEqual(curated);
    expect(catalog.models.find((model) => model.id === userModel.id)).toEqual({
      ...userModel,
      favorite: false,
    });
    expect(catalog.models.find((model) => model.id === retiredModel.id)).toBeUndefined();
    expect(catalog.models.find((model) => model.id === removedCuratedModel.id)).toBeUndefined();
    expect(JSON.parse(readFileSync(paths.catalogFile, "utf8")).models).toEqual(catalog.models);
  });

  it("uses the normalized Muse Glimmer quant label that repository discovery returns", () => {
    const catalog = loadCatalog(testPaths());
    const muse = catalog.models.find((model) => model.name === "Muse Glimmer 30B");

    expect(muse?.quant).toBe("Q4_K_XL");
  });

  it("marks only the curated favorite models for a premium Library badge", () => {
    const catalog = loadCatalog(testPaths());

    expect(catalog.models.filter((model) => model.favorite).map((model) => model.name)).toEqual([
      "Qwen3.8 27B",
      "Muse Glimmer 30B",
    ]);
    expect(
      catalog.models.filter((model) => model.name.startsWith("Qwen")).map((model) => model.name),
    ).toEqual(["Qwen3 Coder 30B A3B", "Qwen3.8 27B"]);
  });

  it("includes Gemma 4 E4B with its exact optional vision projector", () => {
    const catalog = loadCatalog(testPaths());
    const gemma = catalog.models.find((model) => model.name === "Gemma 4 E4B");

    expect(gemma).toMatchObject({
      hfRepo: "unsloth/gemma-4-E4B-it-GGUF",
      quant: "Q4_K_M",
      approxWeightsBytes: 4977171584,
      contextMax: 131072,
      vision: true,
      thinking: true,
    });
    expect(gemma?.components).toEqual([
      expect.objectContaining({
        id: "vision-projector",
        file: "mmproj-F16.gguf",
        bytes: 990372672,
      }),
    ]);
    expect(catalog.models.find((model) => model.name === "Gemma 3 27B")).toBeUndefined();
    expect(catalog.retiredModelIds).toContain(
      "lmstudio-community/gemma-3-27b-it-GGUF/gemma-3-27b-it-Q4_K_M.gguf",
    );
  });

  it("gives every curated bundle component a byte budget for download progress", () => {
    const catalog = loadCatalog(testPaths());
    const components = catalog.models.flatMap((model) => model.components ?? []);

    expect(components).not.toHaveLength(0);
    expect(components.every((component) => (component.bytes ?? 0) > 0)).toBe(true);
  });

  it("defaults to Q4_K_M unless the source format requires another quant", () => {
    const catalog = loadCatalog(testPaths());
    const nonQ4Defaults = catalog.models
      .filter((model) => model.quant !== "Q4_K_M")
      .map((model) => [model.name, model.quant]);

    expect(nonQ4Defaults).toEqual([
      ["Muse Glimmer 30B", "Q4_K_XL"],
      ["gpt-oss 20B", "MXFP4"],
    ]);
  });
});
