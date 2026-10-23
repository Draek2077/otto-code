import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { fixtureRoot } from "../../test-fixtures.js";
import { resolveBrainPaths } from "./paths.js";
import { readBrainConfigRevision, updateBrainConfig } from "./revision-store.js";

const roots: string[] = [];
function unchanged<T>(value: T): T {
  return value;
}
function fixture() {
  const root = fs.mkdtempSync(path.join(fixtureRoot(), "brain-revision-"));
  roots.push(root);
  return resolveBrainPaths({ OTTO_HOME: root });
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    const relative = path.relative(fixtureRoot(), root);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Unexpected fixture cleanup path");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it("reads a default revision without creating files or a home", () => {
  const paths = fixture();
  const first = readBrainConfigRevision(paths);
  expect(first.config.enabled).toBe(false);
  expect(readBrainConfigRevision(paths).revision).toBe(first.revision);
  expect(fs.existsSync(paths.root)).toBe(false);
});

it("commits an explicit update once and returns the persisted revision", () => {
  const paths = fixture();
  const first = readBrainConfigRevision(paths);
  const saved = updateBrainConfig(
    first.revision,
    (config) => ({ ...config, enabled: true }),
    paths,
  );
  expect(saved.config.enabled).toBe(true);
  expect(saved.revision).not.toBe(first.revision);
  expect(readBrainConfigRevision(paths)).toEqual(saved);
  expect(fs.existsSync(`${paths.configFile}.lock`)).toBe(false);
});

it("rejects a peer revision before invoking the stale updater", () => {
  const paths = fixture();
  const origin = readBrainConfigRevision(paths);
  updateBrainConfig(origin.revision, (config) => ({ ...config, enabled: true }), paths);
  const bytes = fs.readFileSync(paths.configFile, "utf8");
  let invoked = false;
  expect(() =>
    updateBrainConfig(
      origin.revision,
      (config) => {
        invoked = true;
        return config;
      },
      paths,
    ),
  ).toThrow(expect.objectContaining({ kind: "conflict" }));
  expect(invoked).toBe(false);
  expect(fs.readFileSync(paths.configFile, "utf8")).toBe(bytes);
});

it("keeps credentials and unrelated settings when applying a focused edit", () => {
  const paths = fixture();
  const origin = readBrainConfigRevision(paths);
  const seeded = updateBrainConfig(
    origin.revision,
    (config) => ({
      ...config,
      maxLoadedModels: 4,
      hfToken: "private-fixture-hf",
      auth: { mode: "token", token: "private-fixture-access" },
    }),
    paths,
  );
  const saved = updateBrainConfig(
    seeded.revision,
    (config) => ({
      ...config,
      runtime: { ...config.runtime, logVerbosity: 5 },
    }),
    paths,
  );
  expect(saved.config).toMatchObject({
    maxLoadedModels: 4,
    hfToken: "private-fixture-hf",
    auth: { token: "private-fixture-access" },
    runtime: { logVerbosity: 5 },
  });
});

it("treats an external byte edit as a conflict even when parsed values are unchanged", () => {
  const paths = fixture();
  const saved = updateBrainConfig(
    readBrainConfigRevision(paths).revision,
    (config) => config,
    paths,
  );
  fs.appendFileSync(paths.configFile, "\n");
  expect(() => updateBrainConfig(saved.revision, (config) => config, paths)).toThrow(
    expect.objectContaining({ kind: "conflict" }),
  );
});

it.each(["{broken", '{"version":999}', '{"version":1,"futureSetting":"keep"}'])(
  "preserves malformed or unsupported configuration: %s",
  (bytes) => {
    const paths = fixture();
    fs.mkdirSync(paths.root, { recursive: true });
    fs.writeFileSync(paths.configFile, bytes);
    expect(() => readBrainConfigRevision(paths)).toThrow();
    expect(fs.readFileSync(paths.configFile, "utf8")).toBe(bytes);
    expect(fs.existsSync(`${paths.configFile}.lock`)).toBe(false);
  },
);

it("serializes cooperating writers and releases the claim after a rejected nested writer", () => {
  const paths = fixture();
  const origin = readBrainConfigRevision(paths);
  const saved = updateBrainConfig(
    origin.revision,
    (config) => {
      expect(() => updateBrainConfig(origin.revision, unchanged, paths)).toThrow(
        expect.objectContaining({ kind: "busy" }),
      );
      return { ...config, autoStart: true };
    },
    paths,
  );
  expect(saved.config.autoStart).toBe(true);
  expect(fs.existsSync(`${paths.configFile}.lock`)).toBe(false);
});

it("never removes or retries another writer's claim", () => {
  const paths = fixture();
  const origin = readBrainConfigRevision(paths);
  fs.mkdirSync(paths.root, { recursive: true });
  const claim = "unknown-or-interrupted-writer";
  fs.writeFileSync(`${paths.configFile}.lock`, claim);
  expect(() => updateBrainConfig(origin.revision, (config) => config, paths)).toThrow(
    expect.objectContaining({ kind: "busy" }),
  );
  expect(fs.readFileSync(`${paths.configFile}.lock`, "utf8")).toBe(claim);
  expect(fs.existsSync(paths.configFile)).toBe(false);
});

it("releases an owned claim and preserves the operation error and original config", () => {
  const paths = fixture();
  const saved = updateBrainConfig(
    readBrainConfigRevision(paths).revision,
    (config) => config,
    paths,
  );
  const bytes = fs.readFileSync(paths.configFile, "utf8");
  const error = new Error("fixture rejection");
  expect(() =>
    updateBrainConfig(
      saved.revision,
      () => {
        throw error;
      },
      paths,
    ),
  ).toThrow(error);
  expect(fs.existsSync(`${paths.configFile}.lock`)).toBe(false);
  expect(fs.readFileSync(paths.configFile, "utf8")).toBe(bytes);
});

it("validates the complete next configuration before replacing the original", () => {
  const paths = fixture();
  const saved = updateBrainConfig(
    readBrainConfigRevision(paths).revision,
    (config) => config,
    paths,
  );
  const bytes = fs.readFileSync(paths.configFile, "utf8");
  expect(() =>
    updateBrainConfig(saved.revision, (config) => ({ ...config, maxLoadedModels: 99 }), paths),
  ).toThrow();
  expect(fs.readFileSync(paths.configFile, "utf8")).toBe(bytes);
  expect(fs.existsSync(`${paths.configFile}.lock`)).toBe(false);
});

it("checks the originating revision again after preparing a write", () => {
  const paths = fixture();
  const origin = readBrainConfigRevision(paths);
  const external = '{"version":1,"maxLoadedModels":3}';
  expect(() =>
    updateBrainConfig(
      origin.revision,
      (config) => {
        fs.writeFileSync(paths.configFile, external);
        return { ...config, enabled: true };
      },
      paths,
    ),
  ).toThrow(expect.objectContaining({ kind: "conflict" }));
  expect(fs.readFileSync(paths.configFile, "utf8")).toBe(external);
});
