import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { settingsRpc } from "@getpaseo/plugin";
import { BuiltinPluginLoader } from "../plugins/builtin/index.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";

test("Otto 0.9 provider settings and aliases work unchanged without activating Brain or exposing old keys", async () => {
  const root = await mkdtemp(
    path.join(
      fileURLToPath(new URL("../../../../../.tmp/", import.meta.url)),
      "otto-legacy-provider-e2e-",
    ),
  );
  const requests: Array<{ url?: string; authorization?: string }> = [];
  const server = createServer(async (request, response) => {
    for await (const chunk of request) void chunk;
    requests.push({ url: request.url, authorization: request.headers.authorization });
    if (request.method === "GET") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: [{ id: "fixture" }] }));
    } else {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Legacy configuration retained." }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
      );
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing endpoint");
  const homeRoot = path.join(root, "home");
  const home = path.join(homeRoot, ".paseo");
  await mkdir(home, { recursive: true });
  const original = JSON.stringify({
    agents: {
      providers: {
        "openai-compatible": {
          extends: "openai-compatible",
          label: "Cloud",
          env: {
            OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/cloud/v1`,
            OPENAI_API_KEY: "synthetic-cloud-key",
          },
        },
        "old-studio": {
          extends: "openai-compatible",
          label: "Old studio",
          env: {
            OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/studio/v1`,
            OPENAI_API_KEY: "synthetic-studio-key",
          },
        },
        codex: { extends: "openai-compatible", label: "Preserved Codex alias" },
        "otto-brain": {
          extends: "openai-compatible",
          env: { OPENAI_BASE_URL: "http://127.0.0.1:1/v1" },
        },
      },
    },
  });
  await writeFile(path.join(home, "otto-config.json"), original);
  await writeFile(path.join(home, "config.json.otto-0.9.bak"), original);
  const daemon = await createTestPaseoDaemon({
    paseoHomeRoot: homeRoot,
    staticDir: path.join(root, "static"),
    cleanup: false,
    pluginApiVersion: "0.12.0",
    pluginsEnabled: false,
    builtinPlugins: new BuiltinPluginLoader(undefined, ["otto-openai-compatible-provider"]),
  });
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.10.0",
  });
  try {
    await client.connect();
    await client.fetchAgents({ subscribe: {} });
    const rpc = settingsRpc("connection");
    const state = rpc.read.output.parse(
      await client.invokePluginRpc("otto-openai-compatible-provider", rpc.read.name, {}),
    );
    expect(state).toMatchObject({
      status: "ready",
      values: { baseUrl: `http://127.0.0.1:${address.port}/cloud/v1` },
    });
    expect(JSON.stringify(state)).not.toContain("synthetic-cloud-key");
    expect(
      await client.invokePluginRpc("otto-openai-compatible-provider", "legacy.status", {}),
    ).toMatchObject({
      providers: [
        {
          id: "codex",
          label: "Preserved Codex alias",
          diagnostic: expect.stringContaining("conflicts"),
        },
        { id: "old-studio", label: "Old studio", enabled: true },
        { id: "openai-compatible", label: "Cloud", enabled: true },
      ],
    });
    if (state.status !== "ready") throw Error(state.error);
    expect(
      await client.invokePluginRpc("otto-openai-compatible-provider", "credentials.status", {
        profileId: "primary",
        baseUrl: `http://127.0.0.1:${address.port}/cloud/v1`,
        settingsRevision: state.revision,
      }),
    ).toMatchObject({ source: "legacy", configured: false, endpointChanged: false });
    expect(await client.listProviderModels("old-studio", { cwd: root })).toMatchObject({
      models: [{ id: "fixture" }],
    });
    for (const provider of ["openai-compatible", "old-studio"]) {
      const agent = await client.createAgent({ provider, model: "fixture", cwd: root });
      await client.sendMessage(agent.id, "Use the preserved connection.");
      expect((await client.waitForFinish(agent.id, 15000)).status).toBe("idle");
    }
    expect(requests).toContainEqual({
      url: "/cloud/v1/chat/completions",
      authorization: "Bearer synthetic-cloud-key",
    });
    expect(requests).toContainEqual({
      url: "/studio/v1/chat/completions",
      authorization: "Bearer synthetic-studio-key",
    });
    expect(await client.listProviderModels("otto-brain", { cwd: root })).toMatchObject({
      error: "Unknown provider: otto-brain",
    });
    expect(
      await client.invokePluginRpc("otto-openai-compatible-provider", rpc.write.name, {
        revision: state.revision,
        values: { baseUrl: `http://127.0.0.1:${address.port}/new/v1`, model: "fixture" },
      }),
    ).toMatchObject({ status: "saved" });
    const fresh = await client.createAgent({
      provider: "openai-compatible",
      model: "fixture",
      cwd: root,
    });
    await client.sendMessage(fresh.id, "Use the explicitly changed endpoint.");
    expect((await client.waitForFinish(fresh.id, 15000)).status).toBe("idle");
    expect(requests).toContainEqual({ url: "/new/v1/chat/completions", authorization: undefined });
    expect(await readFile(path.join(home, "otto-config.json"), "utf8")).toBe(original);
    expect(await readFile(path.join(home, "config.json.otto-0.9.bak"), "utf8")).toBe(original);
  } finally {
    await client.close();
    await daemon.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 60000);
