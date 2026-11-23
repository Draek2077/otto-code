import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { afterEach, expect, it, vi } from "vitest";
import { fixtureRoot } from "../../test-fixtures.js";
import { resolveBrainPaths } from "../config/paths.js";
import { readBrainConfigRevision, updateBrainConfig } from "../config/revision-store.js";
import * as tailscale from "../service/tailscale.js";
import { runShareCommand } from "./share.js";

const roots: string[] = [];
const command = undefined as unknown as Command;
function fixture() {
  const root = fs.mkdtempSync(path.join(fixtureRoot(), "brain-share-"));
  roots.push(root);
  vi.stubEnv("OTTO_HOME", root);
  return resolveBrainPaths({ OTTO_HOME: root });
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) {
    const relative = path.relative(fixtureRoot(), root);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Unexpected fixture cleanup path");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it("reports saved sharing intent without creating configuration", async () => {
  const paths = fixture();
  const result = await runShareCommand({}, command);
  expect(result.data).toMatchObject({ shared: false, key: null, hasKey: false });
  expect(fs.existsSync(paths.root)).toBe(false);
});

it("generates and returns only a newly stored key without starting the host", async () => {
  const paths = fixture();
  const result = await runShareCommand({ bind: "all", generate: true }, command);
  expect(result.type).toBe("single");
  if (result.type !== "single") throw new Error("Unexpected fixture output");
  expect(result.data.key).toBeTruthy();
  const stored = readBrainConfigRevision(paths).config;
  expect(stored).toMatchObject({
    auth: { mode: "token", token: result.data.key },
    listen: { host: "0.0.0.0" },
    enabled: false,
    autoStart: false,
  });
  expect(fs.existsSync(paths.pidFile)).toBe(false);
  const shown = await runShareCommand({}, command);
  expect(shown.data).toMatchObject({ hasKey: true, key: null });
  expect(JSON.stringify(shown.data)).not.toContain(result.data.key);
});

it("disables sharing while preserving the existing key and unrelated intent", async () => {
  const paths = fixture();
  updateBrainConfig(
    readBrainConfigRevision(paths).revision,
    (config) => ({
      ...config,
      hfToken: "fixture-hf",
      autoStart: true,
      allowRemoteConfig: true,
      listen: { ...config.listen, host: "0.0.0.0" },
      auth: { mode: "token", token: "fixture-key" },
    }),
    paths,
  );
  const result = await runShareCommand({ off: true }, command);
  expect(result.data).toMatchObject({ shared: false, key: null, allowRemoteConfig: false });
  expect(readBrainConfigRevision(paths).config).toMatchObject({
    hfToken: "fixture-hf",
    autoStart: true,
    auth: { mode: "none", token: "fixture-key" },
  });
});

it("rejects a peer write during explicit network discovery without rebasing", async () => {
  const paths = fixture();
  vi.spyOn(tailscale, "isAvailable").mockImplementation(async () => {
    updateBrainConfig(
      readBrainConfigRevision(paths).revision,
      (config) => ({ ...config, maxLoadedModels: 3 }),
      paths,
    );
    return false;
  });
  await expect(runShareCommand({ on: true }, command)).rejects.toMatchObject({ kind: "conflict" });
  expect(readBrainConfigRevision(paths).config).toMatchObject({
    maxLoadedModels: 3,
    listen: { host: "127.0.0.1" },
    auth: { mode: "none", token: null },
  });
});

it("requires explicit open access before permitting an unauthenticated network bind", async () => {
  const paths = fixture();
  await runShareCommand({ bind: "all", access: "open" }, command);
  expect(readBrainConfigRevision(paths).config).toMatchObject({
    allowInsecureBind: true,
    auth: { mode: "none" },
  });
});

it("rejects blank replacement keys without modifying saved bytes", async () => {
  const paths = fixture();
  updateBrainConfig(readBrainConfigRevision(paths).revision, (config) => config, paths);
  const bytes = fs.readFileSync(paths.configFile, "utf8");
  await expect(runShareCommand({ key: " " }, command)).rejects.toMatchObject({ code: "EMPTY_KEY" });
  expect(fs.readFileSync(paths.configFile, "utf8")).toBe(bytes);
});
