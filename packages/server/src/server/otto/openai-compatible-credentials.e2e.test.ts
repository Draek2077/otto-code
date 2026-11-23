import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { settingsRpc } from "@getpaseo/plugin";
import {
  credentialSave,
  credentialStatus,
} from "../../../../../plugins/otto-openai-compatible-provider/shared/credentials.js";
import { BuiltinPluginLoader } from "../plugins/builtin/index.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";

test("host credential RPCs preserve conflicts, keep secrets out of settings and resume after daemon restart", async () => {
  const scratch = fileURLToPath(new URL("../../../../../.tmp/", import.meta.url));
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, "otto-credentials-e2e-"));
  const requests: Array<{ authorization?: string; messages: Array<{ content: string }> }> = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ ...JSON.parse(body), authorization: request.headers.authorization });
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Done." }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing endpoint");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const start = () =>
    createTestPaseoDaemon({
      paseoHomeRoot: path.join(root, "home"),
      staticDir: path.join(root, "static"),
      cleanup: false,
      pluginApiVersion: "0.12.0",
      pluginsEnabled: false,
      builtinPlugins: new BuiltinPluginLoader(undefined, ["otto-openai-compatible-provider"]),
    });
  let daemon = await start();
  const connect = (port: number) =>
    new DaemonClient({ url: `ws://127.0.0.1:${port}/ws`, appVersion: "0.10.0" });
  let client = connect(daemon.port);
  const pluginId = "otto-openai-compatible-provider";
  const rpc = settingsRpc("connection");
  try {
    await client.connect();
    await client.fetchAgents({ subscribe: {} });
    const initial = rpc.read.output.parse(
      await client.invokePluginRpc(pluginId, rpc.read.name, {}),
    );
    if (initial.status !== "ready") throw Error(initial.error);
    const configured = rpc.write.output.parse(
      await client.invokePluginRpc(pluginId, rpc.write.name, {
        revision: initial.revision,
        values: { baseUrl, model: "fixture" },
      }),
    );
    if (configured.status !== "saved") throw Error(configured.error);
    const target = { profileId: "primary", baseUrl, settingsRevision: configured.revision };
    const before = credentialStatus.output.parse(
      await client.invokePluginRpc(pluginId, credentialStatus.name, target),
    );
    const key = "synthetic-credential-fixture-key";
    const saved = credentialSave.output.parse(
      await client.invokePluginRpc(pluginId, credentialSave.name, {
        ...target,
        revision: before.revision,
        key,
      }),
    );
    expect(saved).toMatchObject({ configured: true, source: "managed" });
    expect(JSON.stringify(saved).includes(key)).toBe(false);
    await expect(
      client.invokePluginRpc(pluginId, credentialSave.name, {
        ...target,
        revision: before.revision,
        key: "stale-key",
      }),
    ).rejects.toThrow("changed");
    await expect(
      client.invokePluginRpc(pluginId, credentialStatus.name, {
        ...target,
        baseUrl: `${baseUrl}/different`,
      }),
    ).rejects.toThrow("changed");
    const settings = await client.invokePluginRpc(pluginId, rpc.read.name, {});
    expect(JSON.stringify(settings).includes(key)).toBe(false);
    const agent = await client.createAgent({
      provider: "openai-compatible",
      model: "fixture",
      modeId: "default",
      cwd: root,
      title: "Host key fixture",
    });
    await client.sendMessage(agent.id, "Before restart");
    expect((await client.waitForFinish(agent.id, 15000)).status).toBe("idle");
    expect(requests[0]?.authorization).toBe(`Bearer ${key}`);
    await client.close();
    await daemon.close();
    daemon = await start();
    client = connect(daemon.port);
    await client.connect();
    await client.fetchAgents({ subscribe: {} });
    await client.sendMessage(agent.id, "After restart");
    expect((await client.waitForFinish(agent.id, 15000)).status).toBe("idle");
    expect(requests[1]?.authorization).toBe(`Bearer ${key}`);
    expect(requests[1]?.messages).toContainEqual({ role: "user", content: "Before restart" });
    const files = await readdir(daemon.paseoHome, { recursive: true });
    for (const file of files.filter(
      (item) => /\.(json|log)$/.test(item) && path.basename(item) !== "credentials.json",
    ))
      expect((await readFile(path.join(daemon.paseoHome, file), "utf8")).includes(key)).toBe(false);
  } finally {
    await client.close();
    await daemon.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
