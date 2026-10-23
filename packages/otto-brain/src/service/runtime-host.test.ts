import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { fixtureRoot } from "../../test-fixtures.js";
import { BrainConfigSchema } from "../config/schema.js";
import { resolveBrainPaths } from "../config/paths.js";
import { loadBrainConfig, loadPersistedConfig, saveBrainConfig } from "../config/store.js";
import { listManagedRuntimes, resolveRuntime, serverExeName } from "../runtime/index.js";
import type { BrainRuntimeContext } from "./serve.js";
import { BrainJobs } from "./jobs.js";
import { createRuntimeManagement } from "./runtime-host.js";
import { runtimeIdentity } from "./runtime-management.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).toReversed()) await dispose();
});
function fixture(forceRuntime = false) {
  const root = fs.mkdtempSync(path.join(fixtureRoot(), "brain-runtime-host-"));
  const paths = resolveBrainPaths({ OTTO_HOME: root });
  const binaries: string[] = [];
  for (const build of ["b10000", "b10001"]) {
    const directory = path.join(paths.runtimesDir, `cpu-managed-${build}`);
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, serverExeName());
    fs.writeFileSync(file, "fixture only, never execute");
    binaries.push(file);
  }
  const env = {
    OTTO_HOME: root,
    OTTO_BRAIN_TOKEN: "environment-only-fixture-token",
    ...(forceRuntime ? { OTTO_BRAIN_LLAMA_SERVER: binaries[0] } : {}),
  };
  saveBrainConfig(
    BrainConfigSchema.parse({
      maxLoadedModels: 4,
      hfToken: "persisted-fixture-hf-token",
      auth: { mode: "token", token: "persisted-fixture-token" },
      runtime: { source: "managed", logVerbosity: 2 },
    }),
    paths,
  );
  const context: BrainRuntimeContext = {
    instanceId: "fixture",
    paths,
    env,
    config: loadBrainConfig(env, paths),
  };
  const jobs = new BrainJobs(() => {});
  const list = () => listManagedRuntimes(paths.runtimesDir);
  const manager = createRuntimeManagement(context, {
    jobs,
    list,
    selected: () => resolveRuntime(context.config, env),
    isRuntimeInUse: () => false,
    changed: () => {},
    requireWrite: () => {},
  });
  cleanup.push(async () => {
    await jobs.close();
    const relative = path.relative(fixtureRoot(), root);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Unexpected fixture cleanup path");
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { manager, context, paths, env, runtimes: list() };
}
it("persists only runtime selection while preserving credentials, host settings and effective environment", () => {
  const value = fixture();
  const selected = value.runtimes.find((runtime) => runtime.version === "b10000")!;
  value.manager.select(runtimeIdentity(selected));
  const stored = loadPersistedConfig(value.paths);
  expect(stored).toMatchObject({
    maxLoadedModels: 4,
    hfToken: "persisted-fixture-hf-token",
    auth: { token: "persisted-fixture-token" },
    runtime: { source: "managed", path: selected.exe, logVerbosity: 2 },
  });
  expect(value.context.config.auth.token).toBe("environment-only-fixture-token");
  expect(resolveRuntime(value.context.config, value.env)).toMatchObject({
    source: "managed",
    version: "b10000",
    label: selected.label,
  });
  expect(fs.readFileSync(value.paths.configFile, "utf8")).not.toContain(
    "environment-only-fixture-token",
  );
});
it("refuses to override an environment-owned runtime and preserves the persisted config bytes", () => {
  const value = fixture(true);
  const original = fs.readFileSync(value.paths.configFile, "utf8");
  const selected = value.runtimes.find((runtime) => runtime.version === "b10001")!;
  expect(() => value.manager.select(runtimeIdentity(selected))).toThrow("host environment");
  expect(fs.readFileSync(value.paths.configFile, "utf8")).toBe(original);
});

it("keeps runtime repair controls reachable when the saved executable is missing", () => {
  const value = fixture();
  const original = fs.readFileSync(value.paths.configFile, "utf8");
  value.context.config.runtime.path = path.join(
    value.paths.root,
    "missing-runtime",
    serverExeName(),
  );
  expect(value.manager.list().runtimes).toHaveLength(2);
  expect(fs.readFileSync(value.paths.configFile, "utf8")).toBe(original);
});
