import { mkdtempSync, rmSync } from "node:fs";
import { fixtureRoot } from "../../test-fixtures.js";
import path from "node:path";
import type { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveBrainPaths } from "../config/paths.js";
import { loadPersistedConfig } from "../config/index.js";
import { runConfigSetCommand, runConfigShowCommand } from "./config.js";

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
