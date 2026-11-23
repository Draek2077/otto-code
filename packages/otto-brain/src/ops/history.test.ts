import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { fixtureRoot } from "../../test-fixtures.js";
import { save, loadAll, resolveResultsDir } from "./results.js";
import { write } from "./report.js";
import { ProfileSchema } from "../config/schema.js";
import type { Model } from "../types.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = fs.mkdtempSync(path.join(fixtureRoot(), "brain-score-history-"));
  roots.push(root);
  const env = { OTTO_HOME: root };
  const model: Model = {
    id: "fixture/model",
    displayName: '<script>alert("fixture")</script>',
    modelPath: "fixture.gguf",
    sizeBytes: 10,
    quant: "Q4_K_M",
    features: { mtp: false, imatrix: false, distilled: false },
    mmprojPath: null,
    mmprojBytes: 0,
    metadata: {},
  };
  const options = {
    model,
    profile: ProfileSchema.parse({ contextSize: 4096 }),
    timestamp: new Date("2026-10-23T12:00:00Z"),
    report: {
      overall: 0.75,
      grade: "strong",
      seconds: 10,
      executedCode: false,
      results: [
        {
          id: "fixture",
          category: "Fixture",
          weight: 1,
          score: 0.75,
          summary: "observed fixture",
          seconds: 10,
        },
      ],
    },
  };
  return { root, env, options };
}

it("same-instant results retain distinct private files and isolated report ownership", () => {
  const { root, env, options } = fixture();
  const first = save(options, env);
  const second = save(options, env);
  expect(first.file).not.toBe(second.file);
  expect(loadAll(env)).toHaveLength(2);
  const report = write(undefined, env);
  expect(report.file).toBe(path.join(resolveResultsDir(env), "report.html"));
  expect(report.count).toBe(1);
  const html = fs.readFileSync(report.file, "utf8");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain(options.model.displayName);
  expect(loadAll({ OTTO_HOME: path.join(root, "another-host") })).toEqual([]);
  if (process.platform !== "win32") expect(fs.statSync(first.file).mode & 0o777).toBe(0o600);
});

it("reads old score identity and unknown metadata without rewriting or discarding the original", () => {
  const { env, options } = fixture();
  const { file, record } = save(options, env);
  const legacy = {
    ...record,
    schema: 1,
    configKey: "original historical key",
    futureMetadata: { preserve: true },
  };
  const original = JSON.stringify(legacy);
  fs.writeFileSync(file, original);
  fs.writeFileSync(path.join(resolveResultsDir(env), "malformed.json"), "{");
  fs.writeFileSync(path.join(resolveResultsDir(env), "wrong-shape.json"), "{}");
  const loaded = loadAll(env);
  expect(loaded).toHaveLength(1);
  expect(loaded[0]).toMatchObject({
    schema: 1,
    configKey: "original historical key",
    futureMetadata: { preserve: true },
  });
  expect(fs.readFileSync(file, "utf8")).toBe(original);
});

it("exports a private report without changing an existing user folder's permissions", () => {
  const { root, env, options } = fixture();
  save(options, env);
  const folder = path.join(root, "shared-export-folder");
  fs.mkdirSync(folder, { mode: 0o755 });
  const before = fs.statSync(folder).mode;
  const report = write(path.join(folder, "scores.html"), env);
  expect(fs.statSync(folder).mode).toBe(before);
  expect(fs.existsSync(report.file)).toBe(true);
  if (process.platform !== "win32") expect(fs.statSync(report.file).mode & 0o777).toBe(0o600);
});
