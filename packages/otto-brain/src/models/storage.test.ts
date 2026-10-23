import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { fixtureRoot } from "../../test-fixtures.js";
import { scan } from "./scan.js";
import { scanModels } from "./index.js";
import { enrichWithCatalog, excludeCatalogComponentArtifacts } from "./enrich.js";
import { CatalogSchema } from "../config/schema.js";
import { BrainConfigSchema } from "../config/schema.js";
import { resolveBrainPaths } from "../config/paths.js";
import { updateDisplayName } from "./rename-map.js";
import { deleteComponentFile, deleteModelFiles, planDelete, totalModelBytes } from "./manage.js";
import type { Model } from "../types.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = fs.mkdtempSync(path.join(fixtureRoot(), "brain-storage-"));
  roots.push(root);
  const modelDir = path.join(root, "models/author/repo");
  fs.mkdirSync(modelDir, { recursive: true });
  function file(name: string, bytes: number) {
    const target = path.join(modelDir, name);
    fs.writeFileSync(target, Buffer.alloc(bytes));
    return target;
  }
  return { root, modelDir, file, modelRoot: path.join(root, "models") };
}

it("scans sharded weights once, pairs a projector and excludes incomplete downloads", () => {
  const { file, modelRoot } = fixture();
  file("weights-Q4_K_M-00001-of-00002.gguf", 20);
  file("weights-Q4_K_M-00002-of-00002.gguf", 30);
  file("mmproj-F16.gguf", 10);
  file("not-complete.gguf.part", 40);
  const models = scan({ modelsDir: modelRoot, withMetadata: false });
  expect(models).toHaveLength(1);
  expect(models[0]).toMatchObject({ sharded: true, sizeBytes: 50, mmprojBytes: 10 });
});

it("keeps the shared projector when deleting one quant, then removes it with the last quant", () => {
  const { file, modelRoot } = fixture();
  file("weights-Q4_K_M.gguf", 20);
  file("weights-Q8_0.gguf", 30);
  const projector = file("mmproj-F16.gguf", 10);
  const models = scan({ modelsDir: modelRoot, withMetadata: false });
  expect(totalModelBytes(models)).toBe(60);
  expect(planDelete(models[0]).includesProjector).toBe(false);
  deleteModelFiles(models[0]);
  expect(fs.existsSync(projector)).toBe(true);
  expect(planDelete(models[1]).includesProjector).toBe(true);
  deleteModelFiles(models[1]);
  expect(fs.existsSync(projector)).toBe(false);
});

it("counts bundle components once and removes a local drafter with the last primary", () => {
  const { file, modelRoot } = fixture();
  file("weights-Q4_K_M.gguf", 20);
  const drafter = file("drafter.gguf", 10);
  const primary = scan({ modelsDir: modelRoot, withMetadata: false }).find(
    (model) => model.sizeBytes === 20,
  )!;
  primary.components = [
    {
      id: "draft",
      label: "Drafter",
      description: "fixture",
      role: "speculative_drafter",
      path: drafter,
      bytes: 10,
      required: false,
      defaultDownload: false,
      defaultLoad: false,
      available: true,
    },
  ];
  expect(totalModelBytes([primary, primary])).toBe(30);
  expect(planDelete(primary).files).toContain(drafter);
  deleteModelFiles(primary);
  expect(fs.existsSync(drafter)).toBe(false);
});

it("does not remove a primary or required component through optional component deletion", () => {
  const { file, modelRoot } = fixture();
  const modelPath = file("weights.gguf", 20);
  const primary = scan({ modelsDir: modelRoot, withMetadata: false })[0];
  const component: NonNullable<Model["components"]>[number] = {
    id: "bad",
    label: "fixture",
    description: "",
    role: "speculative_drafter",
    path: modelPath,
    bytes: 20,
    required: false,
    available: true,
    defaultDownload: false,
    defaultLoad: false,
  };
  primary.components = [component];
  expect(() => deleteComponentFile(primary, "bad")).toThrow("primary model");
  component.required = true;
  expect(() => deleteComponentFile(primary, "bad")).toThrow("required");
  expect(fs.existsSync(modelPath)).toBe(true);
});

it("merges isolated sources with managed identity precedence and preserves rename metadata", () => {
  const { root, file, modelRoot } = fixture();
  const managedFile = file("weights-Q4_K_M.gguf", 20);
  const otherRoot = path.join(root, "fixture-external");
  fs.mkdirSync(path.join(otherRoot, "author/repo"), { recursive: true });
  fs.writeFileSync(path.join(otherRoot, "author/repo/weights-Q4_K_M.gguf"), Buffer.alloc(30));
  const paths = resolveBrainPaths({ OTTO_HOME: path.join(root, "home") });
  updateDisplayName("author/repo/weights-Q4_K_M.gguf", "My model", paths);
  const models = scanModels(
    BrainConfigSchema.parse({}),
    { OTTO_HOME: paths.home },
    {
      withMetadata: false,
      dirs: [
        { dir: modelRoot, origin: "managed" },
        { dir: otherRoot, origin: "lmstudio" },
      ],
    },
  );
  expect(models).toHaveLength(1);
  expect(models[0]).toMatchObject({
    displayName: "My model",
    modelPath: managedFile,
    sizeBytes: 20,
    origin: "managed",
  });
  expect(fs.readFileSync(paths.renameMapFile, "utf8")).toContain("My model");
});

it("resolves bundle companions from the store root when primary quant files are nested", () => {
  const { modelRoot, modelDir, file } = fixture();
  fs.mkdirSync(path.join(modelDir, "quants"));
  file("quants/weights-Q4_K_M.gguf", 20);
  const projector = file("mmproj-F16.gguf", 10);
  const draft = file("drafter.gguf", 5);
  const catalog = CatalogSchema.parse({
    models: [
      {
        id: "fixture-bundle",
        name: "Fixture bundle",
        hfRepo: "author/repo",
        quant: "Q4_K_M",
        components: [
          {
            id: "vision",
            label: "Vision",
            description: "",
            role: "vision_projector",
            file: "mmproj-F16.gguf",
            required: true,
          },
          {
            id: "draft",
            label: "Draft",
            description: "",
            role: "speculative_drafter",
            file: "drafter.gguf",
          },
        ],
      },
    ],
  });
  const scanned = scan({ modelsDir: modelRoot, withMetadata: false });
  const models = enrichWithCatalog(excludeCatalogComponentArtifacts(scanned, catalog), catalog);
  expect(models).toHaveLength(1);
  expect(models[0].components?.map((component) => component.path)).toEqual([projector, draft]);
  expect(models[0].components?.every((component) => component.available)).toBe(true);
});
