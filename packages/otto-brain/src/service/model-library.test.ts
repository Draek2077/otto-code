import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { fixtureRoot } from "../../test-fixtures.js";
import { resolveBrainPaths } from "../config/paths.js";
import { scan } from "../models/scan.js";
import { loadRenameMap } from "../models/rename-map.js";
import { BrainJobs } from "./jobs.js";
import { ModelLibrary } from "./model-library.js";
import http from "node:http";
import { promisify } from "node:util";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).toReversed()) await dispose();
});
function fixture(quants = 1) {
  const root = fs.mkdtempSync(path.join(fixtureRoot(), "brain-model-library-"));
  const paths = resolveBrainPaths({ OTTO_HOME: root });
  const directory = path.join(paths.modelsDir, "author/repo");
  fs.mkdirSync(directory, { recursive: true });
  for (let index = 0; index < quants; index++)
    fs.writeFileSync(path.join(directory, `weights-Q${index + 4}.gguf`), Buffer.alloc(20));
  const projector = path.join(directory, "mmproj-F16.gguf");
  fs.writeFileSync(projector, Buffer.alloc(10));
  let busy = false;
  let writeChecks = 0;
  const rescan = () => {
    const overrides = loadRenameMap(paths);
    const discovered = scan({ modelsDir: paths.modelsDir, withMetadata: false });
    for (const model of discovered) model.displayName = overrides[model.id] ?? model.displayName;
    return discovered;
  };
  let models = rescan();
  const jobs = new BrainJobs(() => {});
  cleanup.push(async () => {
    await jobs.close();
    const relative = path.relative(fixtureRoot(), root);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Unexpected fixture cleanup path");
    fs.rmSync(root, { recursive: true, force: true });
  });
  const library = new ModelLibrary({
    paths,
    jobs,
    models: (refresh) => {
      if (refresh) models = rescan();
      return models;
    },
    isModelInUse: () => busy,
    changed: () => {},
    requireWrite: () => {
      writeChecks++;
    },
  });
  return {
    paths,
    models,
    library,
    jobs,
    projector,
    writeChecks: () => writeChecks,
    setBusy: (value: boolean) => {
      busy = value;
    },
  };
}

it("the daemon's POST component removal uses the existing write and shared-artifact guards", async () => {
  const value = fixture();
  value.models[0]!.components = [
    {
      id: "projector",
      label: "Projector",
      description: "Fixture",
      role: "vision_projector",
      path: value.projector,
      bytes: 10,
      required: false,
      defaultDownload: true,
      defaultLoad: false,
      available: true,
    },
  ];
  const server = http.createServer((request, response) => {
    void value.library.handle(request, response, new AbortController().signal).then(
      (handled) => {
        if (!handled) {
          response.writeHead(404);
          response.end();
        }
        return undefined;
      },
      () => {
        response.writeHead(400);
        response.end();
      },
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => {
    server.closeAllConnections();
    await promisify(server.close.bind(server))();
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture listener unavailable");
  const url = `http://127.0.0.1:${address.port}/__host/model/component/delete?id=${encodeURIComponent(value.models[0]!.id)}`;
  expect((await fetch(url, { method: "POST", body: "{}" })).status).toBe(400);
  expect(fs.existsSync(value.projector)).toBe(true);
  expect(
    (await fetch(url, { method: "POST", body: JSON.stringify({ componentId: "projector" }) }))
      .status,
  ).toBe(200);
  expect(value.writeChecks()).toBe(2);
  expect(fs.existsSync(value.projector)).toBe(false);
  expect(fs.existsSync(value.models[0]!.modelPath)).toBe(true);
});

it("renames and resets only the host name store, preserving profiles and calibration bytes", () => {
  const value = fixture();
  const originalName = value.models[0]!.displayName;
  const profileBytes = '{"calibrations":{"preserved":true},"future":1}';
  fs.writeFileSync(value.paths.profilesFile, profileBytes);
  expect(value.library.rename(value.models[0]!.id, "Personal name")).toEqual({
    displayName: "Personal name",
  });
  expect(value.library.resetName(value.models[0]!.id)).toEqual({ displayName: originalName });
  expect(fs.readFileSync(value.paths.profilesFile, "utf8")).toBe(profileBytes);
});
it("refuses loaded or pending model deletion and leaves every file intact", () => {
  const value = fixture();
  value.setBusy(true);
  expect(() => value.library.delete(value.models[0]!.id)).toThrow("queued work");
  expect(fs.statSync(value.models[0]!.modelPath).size).toBe(20);
  expect(fs.statSync(value.projector).size).toBe(10);
});
it("refuses a job admitted before it reaches the resident pool", () => {
  const value = fixture();
  value.jobs.start(
    "sweep",
    { modelId: value.models[0]!.id, catalogModelId: null, repo: null, quant: null },
    async () => null,
  );
  expect(() => value.library.delete(value.models[0]!.id)).toThrow("queued operations");
  expect(fs.existsSync(value.models[0]!.modelPath)).toBe(true);
});
it("retains a shared projector until deleting the final quant", () => {
  const value = fixture(2);
  expect(value.library.describeDelete(value.models[0]!.id)).toMatchObject({
    bytes: 20,
    includesProjector: false,
  });
  value.library.delete(value.models[0]!.id);
  expect(fs.existsSync(value.projector)).toBe(true);
  value.library.delete(value.models[1]!.id);
  expect(fs.existsSync(value.projector)).toBe(false);
});
it("refuses a shared optional component even when both models are unloaded", () => {
  const value = fixture(2);
  for (const model of value.models)
    model.components = [
      {
        id: "projector",
        label: "Projector",
        description: "Fixture",
        role: "vision_projector",
        path: value.projector,
        bytes: 10,
        required: false,
        defaultDownload: true,
        defaultLoad: false,
        available: true,
      },
    ];
  expect(() => value.library.deleteComponent(value.models[0]!.id, "projector")).toThrow(
    "references",
  );
  expect(fs.existsSync(value.projector)).toBe(true);
});
it("does not overwrite a damaged name store or accept unrecognized model identities", () => {
  const value = fixture();
  fs.writeFileSync(value.paths.renameMapFile, "damaged original");
  expect(() => value.library.rename(value.models[0]!.id, "Personal name")).toThrow();
  expect(fs.readFileSync(value.paths.renameMapFile, "utf8")).toBe("damaged original");
  expect(() => value.library.delete("../../outside.gguf")).toThrow("not found");
  expect(() => value.library.rename(value.models[0]!.id, " ")).toThrow("characters");
});
