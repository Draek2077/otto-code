import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestOttoDaemon } from "../test-utils/otto-daemon.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("plugin handlers create workspaces and agents through their Otto API", async () => {
  const pluginDirectory = await mkdtemp(path.join(tmpdir(), "otto-api-plugin-"));
  const workspaceDirectory = await mkdtemp(path.join(tmpdir(), "otto-api-workspace-"));
  roots.push(pluginDirectory, workspaceDirectory);
  await writeFile(
    path.join(pluginDirectory, "otto-plugin.json"),
    JSON.stringify({ id: "otto-api" }),
  );
  await writeFile(
    path.join(pluginDirectory, "index.tsx"),
    `import { defineRpc, type PluginContext } from "@otto-code/plugin";
import { z } from "zod";

const create = defineRpc({
  name: "create",
  input: z.object({ path: z.string() }),
  output: z.object({ workspaceId: z.string(), agentId: z.string() }),
});

export default function contribute(plugin: PluginContext) {
  plugin.handle(create, async ({ path }, { otto }) => {
    const workspace = await otto.workspaces.create({
      source: { kind: "directory", path },
      title: "Plugin workspace",
    });
    const agent = await workspace.agents.create({
      config: { provider: "codex/test" },
      prompt: "Created by a plugin handler",
    });
    return { workspaceId: workspace.id, agentId: agent.id };
  });
  return () => undefined;
}`,
  );

  const daemon = await createTestOttoDaemon();
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.4.0",
  });

  try {
    await client.connect();
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await expect(client.installDirectoryPlugin(pluginDirectory)).resolves.toMatchObject({
      id: "otto-api",
      status: "running",
    });

    const created = await client.invokePluginRpc("otto-api", "create", {
      path: workspaceDirectory,
    });

    expect(created).toEqual({
      workspaceId: expect.stringMatching(/^wks_/),
      agentId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    if (typeof created !== "object" || created === null) {
      throw new Error("Plugin returned an invalid creation result");
    }
    await client.removePlugin("otto-api");
    const workspaces = await client.fetchWorkspaces();
    const agents = await client.fetchAgents();
    expect(workspaces.entries.map((workspace) => workspace.id)).toContain(
      Reflect.get(created, "workspaceId"),
    );
    expect(agents.entries.map((entry) => entry.agent.id)).toContain(
      Reflect.get(created, "agentId"),
    );
  } finally {
    await client.close().catch(() => undefined);
    await daemon.close();
  }
}, 60_000);

test("daemon config reload enables and disables configured plugins without restarting", async () => {
  const pluginDirectory = await mkdtemp(path.join(tmpdir(), "otto-reload-plugin-"));
  const ottoHomeRoot = await mkdtemp(path.join(tmpdir(), "otto-reload-home-"));
  const ottoHome = path.join(ottoHomeRoot, ".otto");
  roots.push(pluginDirectory, ottoHomeRoot);
  await writeFile(
    path.join(pluginDirectory, "otto-plugin.json"),
    JSON.stringify({ id: "reloadable-plugin" }),
  );
  await writeFile(
    path.join(pluginDirectory, "index.tsx"),
    `export default function contribute(plugin: unknown) {
  void plugin;
  return () => undefined;
    }`,
  );

  const plugins = {
    "reloadable-plugin": { source: "directory" as const, path: pluginDirectory, enabled: true },
  };
  await mkdir(ottoHome, { recursive: true });
  await writeFile(
    path.join(ottoHome, "config.json"),
    `${JSON.stringify({ version: 1, pluginsEnabled: false, plugins }, null, 2)}\n`,
  );
  const daemon = await createTestOttoDaemon({
    ottoHomeRoot,
    cleanup: false,
    pluginsEnabled: false,
    plugins,
  });
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.4.0",
  });
  const configPath = path.join(daemon.ottoHome, "config.json");

  async function setPluginsEnabled(enabled: boolean): Promise<void> {
    const config = JSON.parse(await readFile(configPath, "utf8"));
    await writeFile(
      configPath,
      `${JSON.stringify({ ...config, pluginsEnabled: enabled }, null, 2)}\n`,
    );
  }

  try {
    await client.connect();
    await expect(client.listPlugins()).resolves.toEqual([
      expect.objectContaining({ id: "reloadable-plugin", status: "disabled" }),
    ]);

    await setPluginsEnabled(true);
    await expect(client.reloadDaemonConfig()).resolves.toMatchObject({
      requestId: expect.any(String),
      appliedPaths: expect.arrayContaining(["pluginsEnabled"]),
      restartRequiredPaths: [],
      overrideControlledPaths: [],
    });
    await expect
      .poll(async () => (await client.listPlugins()).find(({ id }) => id === "reloadable-plugin"))
      .toMatchObject({ enabled: true, status: "running" });

    await setPluginsEnabled(false);
    await expect(client.reloadDaemonConfig()).resolves.toEqual({
      requestId: expect.any(String),
      appliedPaths: ["pluginsEnabled"],
      restartRequiredPaths: [],
      overrideControlledPaths: [],
    });
    await expect
      .poll(async () => (await client.listPlugins()).find(({ id }) => id === "reloadable-plugin"))
      .toMatchObject({ enabled: true, status: "disabled" });
  } finally {
    await client.close().catch(() => undefined);
    await daemon.close();
  }
}, 60_000);
