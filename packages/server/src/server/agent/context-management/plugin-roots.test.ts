import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveEnabledPluginRoots } from "./plugin-roots.js";

/** Real temp trees: the module's whole job is deciding what exists on disk. */
let configDir: string;

beforeEach(async () => {
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), "otto-plugin-roots-"));
});

afterEach(async () => {
  await fs.rm(configDir, { recursive: true, force: true });
});

async function writeSettings(fileName: string, contents: unknown): Promise<void> {
  const text = typeof contents === "string" ? contents : JSON.stringify(contents);
  await fs.writeFile(path.join(configDir, fileName), text, "utf8");
}

async function installPlugin(params: {
  marketplace: string;
  plugin: string;
  version: string;
}): Promise<string> {
  const dir = path.join(
    configDir,
    "plugins",
    "cache",
    params.marketplace,
    params.plugin,
    params.version,
  );
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

describe("resolveEnabledPluginRoots", () => {
  it("resolves an enabled plugin to its installed version directory", async () => {
    const installed = await installPlugin({
      marketplace: "claude-plugins-official",
      plugin: "feature-dev",
      version: "1.2.0",
    });
    await writeSettings("settings.json", {
      enabledPlugins: { "feature-dev@claude-plugins-official": true },
    });

    expect(await resolveEnabledPluginRoots(configDir)).toEqual([installed]);
  });

  it("skips plugins that are disabled", async () => {
    await installPlugin({
      marketplace: "claude-plugins-official",
      plugin: "feature-dev",
      version: "1.2.0",
    });
    await writeSettings("settings.json", {
      enabledPlugins: { "feature-dev@claude-plugins-official": false },
    });

    expect(await resolveEnabledPluginRoots(configDir)).toEqual([]);
  });

  it("lets settings.local.json override the global enablement", async () => {
    await installPlugin({
      marketplace: "claude-plugins-official",
      plugin: "feature-dev",
      version: "1.2.0",
    });
    await writeSettings("settings.json", {
      enabledPlugins: { "feature-dev@claude-plugins-official": true },
    });
    await writeSettings("settings.local.json", {
      enabledPlugins: { "feature-dev@claude-plugins-official": false },
    });

    expect(await resolveEnabledPluginRoots(configDir)).toEqual([]);
  });

  it("skips plugins listed in settings but absent from disk", async () => {
    await writeSettings("settings.json", {
      enabledPlugins: { "never-installed@claude-plugins-official": true },
    });

    expect(await resolveEnabledPluginRoots(configDir)).toEqual([]);
  });

  it("discovers the version directory rather than assuming one", async () => {
    // The plugin cache uses the literal string "unknown" when a plugin ships no
    // version, so a hardcoded semver segment would find nothing.
    const installed = await installPlugin({
      marketplace: "claude-plugins-official",
      plugin: "frontend-design",
      version: "unknown",
    });
    await writeSettings("settings.json", {
      enabledPlugins: { "frontend-design@claude-plugins-official": true },
    });

    expect(await resolveEnabledPluginRoots(configDir)).toEqual([installed]);
  });

  it("keeps the marketplace segment when the plugin name contains a dash", async () => {
    const installed = await installPlugin({
      marketplace: "meigen-marketplace",
      plugin: "understand-anything",
      version: "2.9.2",
    });
    await writeSettings("settings.json", {
      enabledPlugins: { "understand-anything@meigen-marketplace": true },
    });

    expect(await resolveEnabledPluginRoots(configDir)).toEqual([installed]);
  });

  it("reports no plugins when settings are malformed rather than failing", async () => {
    await writeSettings("settings.json", "{ this is not json");

    await expect(resolveEnabledPluginRoots(configDir)).resolves.toEqual([]);
  });

  it("reports no plugins when no settings file exists", async () => {
    await expect(resolveEnabledPluginRoots(configDir)).resolves.toEqual([]);
  });
});
