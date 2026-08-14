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
    writeFileSync(
      paths.catalogFile,
      `${JSON.stringify({ version: 1, models: [oldCurated, userModel, retiredModel] }, null, 2)}\n`,
    );

    const catalog = loadCatalog(paths);

    expect(catalog.models.find((model) => model.id === curated.id)).toEqual(curated);
    expect(catalog.models.find((model) => model.id === userModel.id)).toEqual(userModel);
    expect(catalog.models.find((model) => model.id === retiredModel.id)).toBeUndefined();
    expect(JSON.parse(readFileSync(paths.catalogFile, "utf8")).models).toEqual(catalog.models);
  });

  it("uses the normalized Muse Glimmer quant label that repository discovery returns", () => {
    const catalog = loadCatalog(testPaths());
    const muse = catalog.models.find((model) => model.name === "Muse Glimmer 30B");

    expect(muse?.quant).toBe("Q4_K_XL");
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
