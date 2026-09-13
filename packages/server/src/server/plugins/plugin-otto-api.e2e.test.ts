import { PASEO_PLUGIN_API_VERSION } from "@otto-code/protocol/plugin-compatibility";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestOttoDaemon } from "../test-utils/otto-daemon.js";
import { createTestAgentClient, createTestAgentClients } from "../test-utils/fake-agent-client.js";

const roots: string[] = [];

afterEach(async () => {
  // Terminal worker shutdown is asynchronous; Windows retains the workspace
  // directory handle briefly after the daemon closes its sockets.
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      }),
    ),
  );
});

test("plugin handlers create workspaces and agents through their Otto API", async () => {
  const pluginDirectory = await mkdtemp(path.join(tmpdir(), "otto-api-plugin-"));
  const workspaceDirectory = await mkdtemp(path.join(tmpdir(), "otto-api-workspace-"));
  roots.push(pluginDirectory, workspaceDirectory);
  await writeFile(
    path.join(pluginDirectory, "otto-plugin.json"),
    JSON.stringify({
      id: "otto-api",
      requirements: { paseo: `>=${PASEO_PLUGIN_API_VERSION}` },
    }),
  );
  await writeFile(
    path.join(pluginDirectory, "index.server.ts"),
    `import { defineRpc } from "@otto-code/plugin";
import { type PluginServerContext } from "@otto-code/plugin/server";
import { z } from "zod";

const create = defineRpc({
  name: "create",
  input: z.object({ path: z.string() }),
  output: z.object({ workspaceId: z.string(), agentId: z.string() }),
});

const list = defineRpc({
  name: "list",
  input: z.object({}),
  output: z.object({ agentIds: z.array(z.string()) }),
});

const append = defineRpc({
  name: "append",
  input: z.object({ agentId: z.string(), status: z.string() }),
  output: z.object({ seq: z.number(), epoch: z.string() }),
});

export default function contribute(server: PluginServerContext) {
  server.handle(create, async ({ path }, { otto }) => {
    const workspace = await otto.workspaces.create({
      source: { kind: "directory", path },
      title: "Plugin workspace",
    });
    const agent = await workspace.agents.create({
      config: { provider: "pi/test" },
      prompt: "Created by a plugin handler",
    });
    return { workspaceId: workspace.id, agentId: agent.id };
  });
  server.handle(list, async (_input, { otto }) => {
    const result = await otto.agents.list({ page: { limit: 100 } });
    return { agentIds: result.entries.map((entry) => entry.agent.id) };
  });
  server.handle(append, ({ agentId, status }, { otto }) =>
    otto.agents.ref(agentId).timeline.append({
      type: "plugin",
      id: "review-1",
      kind: "review",
      version: 1,
      data: { status },
    }),
  );
  return () => undefined;
}`,
  );

  const daemon = await createTestOttoDaemon({
    agentClients: { ...createTestAgentClients(), pi: createTestAgentClient("pi") },
  });
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.4.0",
  });

  let reconnectedClient: DaemonClient | null = null;
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
    const listed = await client.invokePluginRpc("otto-api", "list", {});
    expect(listed).toEqual({
      agentIds: expect.arrayContaining([Reflect.get(created, "agentId")]),
    });
    const agentId = Reflect.get(created, "agentId");
    await expect(
      client.invokePluginRpc("otto-api", "append", { agentId, status: "running" }),
    ).resolves.toEqual({ seq: expect.any(Number), epoch: expect.any(String) });
    await client.invokePluginRpc("otto-api", "append", { agentId, status: "complete" });
    const timeline = await client.fetchAgentTimeline(agentId, { projection: "projected" });
    expect(timeline.entries.filter((entry) => entry.item.type === "plugin")).toEqual([
      expect.objectContaining({
        item: expect.objectContaining({
          type: "plugin",
          id: "review-1",
          pluginId: "otto-api",
          data: { status: "complete" },
        }),
      }),
    ]);
    const previousPluginRows = timeline.entries.filter((entry) => entry.item.type === "plugin");
    const previousPluginRow = previousPluginRows[0];
    if (!previousPluginRow) throw new Error("Expected the appended plugin row");
    await client.close();
    reconnectedClient = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.4.0",
    });
    await reconnectedClient.connect();
    const recovered = await reconnectedClient.fetchAgentTimeline(agentId, {
      projection: "projected",
    });
    expect(recovered.epoch).toBe(timeline.epoch);
    expect(recovered.entries.filter((entry) => entry.item.type === "plugin")).toEqual(
      previousPluginRows,
    );

    await reconnectedClient.invokePluginRpc("otto-api", "append", { agentId, status: "reviewed" });
    const replaced = await reconnectedClient.fetchAgentTimeline(agentId, {
      projection: "projected",
    });
    expect(replaced.epoch).toBe(timeline.epoch);
    const replacedPluginRows = replaced.entries.filter((entry) => entry.item.type === "plugin");
    expect(replacedPluginRows).toEqual([
      expect.objectContaining({
        item: {
          type: "plugin",
          id: "review-1",
          pluginId: "otto-api",
          kind: "review",
          version: 1,
          data: { status: "reviewed" },
        },
      }),
    ]);
    expect(replacedPluginRows[0]?.seqEnd).toBeGreaterThan(previousPluginRow.seqEnd);
    await reconnectedClient.removePlugin("otto-api");
    const workspaces = await reconnectedClient.fetchWorkspaces();
    const agents = await reconnectedClient.fetchAgents();
    expect(workspaces.entries.map((workspace) => workspace.id)).toContain(
      Reflect.get(created, "workspaceId"),
    );
    expect(agents.entries.map((entry) => entry.agent.id)).toContain(
      Reflect.get(created, "agentId"),
    );
  } finally {
    await reconnectedClient?.close().catch(() => undefined);
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
    JSON.stringify({
      id: "reloadable-plugin",
      requirements: { paseo: `>=${PASEO_PLUGIN_API_VERSION}` },
    }),
  );
  await writeFile(
    path.join(pluginDirectory, "index.server.ts"),
    `export default function contribute(server: unknown) {
  void server;
  return () => undefined;
    }`,
  );

  const plugins = {
    "reloadable-plugin": { source: "directory" as const, path: pluginDirectory, enabled: true },
  };
  await mkdir(ottoHome, { recursive: true });
  await writeFile(
    path.join(ottoHome, "config.json"),
    `${JSON.stringify({ version: 1, daemon: { relay: { enabled: false } }, pluginsEnabled: false, plugins }, null, 2)}\n`,
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
    // Config reload queues plugin startup. Allow the real subprocess handshake
    // budget from PluginRuntime, rather than Vitest's short unit-poll default.
    await expect
      .poll(
        async () => {
          const plugin = (await client.listPlugins()).find(({ id }) => id === "reloadable-plugin");
          return { ...plugin, error: plugin?.error ?? null };
        },
        { timeout: 30_000 },
      )
      .toMatchObject({ enabled: true, status: "running", error: null });

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
