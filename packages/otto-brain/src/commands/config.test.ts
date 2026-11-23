import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { fixtureRoot } from "../../test-fixtures.js";
import path from "node:path";
import type { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveBrainPaths } from "../config/paths.js";
import { loadPersistedConfig } from "../config/index.js";
import { runConfigSetCommand, runConfigShowCommand } from "./config.js";
import { withBrainSettingsTarget } from "./settings-target.js";
import { BrainConfigSchema } from "../config/schema.js";

const tmpDirs: string[] = [];
function makeTmpHome(): string {
  const dir = mkdtempSync(path.join(fixtureRoot(), "brain-config-"));
  tmpDirs.push(dir);
  vi.stubEnv("OTTO_HOME", dir);
  return dir;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const cmd = undefined as unknown as Command;

describe("config set auth.mode", () => {
  it("refuses mode=token while no token is stored", async () => {
    makeTmpHome();
    await expect(runConfigSetCommand("auth.mode", "token", {}, cmd)).rejects.toMatchObject({
      code: "TOKEN_REQUIRED",
    });
  });

  it("accepts mode=token once a token is stored", async () => {
    const dir = makeTmpHome();
    await runConfigSetCommand("auth.token", "s3cret", {}, cmd);
    await runConfigSetCommand("auth.mode", "token", {}, cmd);
    const config = loadPersistedConfig(resolveBrainPaths({ OTTO_HOME: dir }));
    expect(config.auth.mode).toBe("token");
    expect(config.auth.token).toBe("s3cret");
  });
});

it("redacts credentials from command results while retaining the saved configuration", async () => {
  const dir = makeTmpHome();
  const changed = await runConfigSetCommand("hfToken", "fixture-private-hf-key", {}, cmd);
  expect(JSON.stringify(changed.data)).not.toContain("fixture-private-hf-key");
  await runConfigSetCommand("auth.token", "fixture-private-host-key", {}, cmd);
  const shown = await runConfigShowCommand({}, cmd);
  expect(JSON.stringify(shown.data)).not.toContain("fixture-private");
  const saved = loadPersistedConfig(resolveBrainPaths({ OTTO_HOME: dir }));
  expect(saved.hfToken).toBe("fixture-private-hf-key");
  expect(saved.auth.token).toBe("fixture-private-host-key");
});

it.each(["yes", "0", "", "false-ish"])(
  "rejects ambiguous booleans without creating configuration: %s",
  async (value) => {
    const home = makeTmpHome();
    const paths = resolveBrainPaths({ OTTO_HOME: home });
    await expect(runConfigSetCommand("enabled", value, {}, cmd)).rejects.toMatchObject({
      code: "INVALID_VALUE",
    });
    expect(existsSync(paths.configFile)).toBe(false);
  },
);

it("sets supported defaults, runtime, residency and nullable owner paths without changing peers", async () => {
  const home = makeTmpHome();
  await runConfigSetCommand("autoStart", "true", {}, cmd);
  await runConfigSetCommand("defaults.parallelSlots", "3", {}, cmd);
  await runConfigSetCommand("runtime.path", "/owner/llama-server", {}, cmd);
  await runConfigSetCommand("runtime.path", "null", {}, cmd);
  await runConfigSetCommand("modelsDir", "/owner/models", {}, cmd);
  await runConfigSetCommand("modelsDir", "null", {}, cmd);
  await runConfigSetCommand("lockedModels", '["model-a","model-b"]', {}, cmd);
  const config = loadPersistedConfig(resolveBrainPaths({ OTTO_HOME: home }));
  expect(config).toMatchObject({
    enabled: false,
    autoStart: true,
    defaults: { parallelSlots: 3 },
    runtime: { path: null },
    modelsDir: null,
    lockedModels: ["model-a", "model-b"],
  });
});

it.each([
  ["version", "2"],
  ["auth.__proto__", "no"],
  ["runtime.source.extra", "auto"],
  ["runtime.source", "invalid"],
  ["maxLoadedModels", "30"],
  ["lockedModels", "[4]"],
  ["auth.token", "********"],
  ["hfToken", ""],
])("preserves the original config after an invalid edit to %s", async (key, value) => {
  const home = makeTmpHome();
  await runConfigSetCommand("enabled", "false", {}, cmd);
  const paths = resolveBrainPaths({ OTTO_HOME: home });
  const bytes = readFileSync(paths.configFile, "utf8");
  await expect(runConfigSetCommand(key, value, {}, cmd)).rejects.toThrow();
  expect(readFileSync(paths.configFile, "utf8")).toBe(bytes);
});

it("borrows a selected passive settings target without creating an invoker configuration", async () => {
  const dir = makeTmpHome();
  const readConfig = vi.fn(async () => BrainConfigSchema.parse({ modelsDir: "/owner/models" }));
  const setConfig = vi.fn(async (_key: string, _raw: string) => ({
    connection: {
      revision: "accepted",
      config: { enabled: false, autoStart: true, mode: "remote" as const },
    },
  }));
  await withBrainSettingsTarget(
    {
      readConfig,
      setConfig,
      share: async () => {
        throw new Error("Unexpected share");
      },
    },
    async () => {
      expect((await runConfigShowCommand({}, cmd)).data).toMatchObject({
        modelsDir: "/owner/models",
      });
      expect((await runConfigSetCommand("enabled", "false", {}, cmd)).data).toMatchObject({
        connection: { revision: "accepted" },
      });
    },
  );
  expect(setConfig).toHaveBeenCalledExactlyOnceWith("enabled", "false");
  expect(existsSync(resolveBrainPaths({ OTTO_HOME: dir }).configFile)).toBe(false);
});

it("clears an explicit runtime pin when choosing a source policy", async () => {
  const home = makeTmpHome();
  await runConfigSetCommand("runtime.path", "/owner/pinned-server", {}, cmd);
  await runConfigSetCommand("runtime.source", "lmstudio", {}, cmd);
  expect(loadPersistedConfig(resolveBrainPaths({ OTTO_HOME: home })).runtime).toMatchObject({
    source: "lmstudio",
    path: null,
  });
});
