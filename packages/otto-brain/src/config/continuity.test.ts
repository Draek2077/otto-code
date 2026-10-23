import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { resolveBrainPaths } from "./paths.js";
import {
  loadBrainConfig,
  loadPersistedConfig,
  saveBrainConfig,
  loadProfilesStore,
  saveProfilesStore,
} from "./store.js";
import { BrainConfigSchema } from "./schema.js";

const roots: string[] = [];
function fixture() {
  mkdirSync(fileURLToPath(new URL("../../../../.tmp/", import.meta.url)), { recursive: true });
  const root = mkdtempSync(
    fileURLToPath(new URL("../../../../.tmp/brain-config-", import.meta.url)),
  );
  roots.push(root);
  return resolveBrainPaths({ OTTO_HOME: root });
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("preserves existing configuration and isolates effective environment overrides", () => {
  const paths = fixture();
  const saved = BrainConfigSchema.parse({
    enabled: true,
    autoStart: true,
    defaultModel: "my-existing-model",
    auth: { mode: "token", token: "saved-private-key" },
    modelsDir: path.join(paths.home, "existing-models"),
  });
  saveBrainConfig(saved, paths);
  const before = readFileSync(paths.configFile, "utf8");
  expect(loadPersistedConfig(paths)).toEqual(saved);
  expect(loadBrainConfig({ OTTO_HOME: paths.home }, paths)).toEqual(saved);
  expect(readFileSync(paths.configFile, "utf8")).toBe(before);
  expect(existsSync(paths.modelsDir)).toBe(false);
  expect(existsSync(paths.pidFile)).toBe(false);
});

it("does not overwrite malformed or newer unsupported user configuration", () => {
  const paths = fixture();
  mkdirSync(paths.root, { recursive: true });
  const original = '{"version":999,"futureUserSetting":"keep-me"}';
  writeFileSync(paths.configFile, original);
  expect(() => loadPersistedConfig(paths)).toThrow("invalid config.json");
  expect(readFileSync(paths.configFile, "utf8")).toBe(original);
});

it("preserves unknown profile-store fields while retaining existing measurements", () => {
  const paths = fixture();
  const store = loadProfilesStore(paths);
  store.futureMetadata = { measurementOwner: "existing-user" };
  saveProfilesStore(store, paths);
  expect(loadProfilesStore(paths).futureMetadata).toEqual({ measurementOwner: "existing-user" });
});
