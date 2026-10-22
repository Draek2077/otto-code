import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { BuiltinPluginLoader } from "../plugins/builtin/index.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";

test("an existing Otto 0.9 conversation imports once, retains images and instructions, and resumes without rerunning tools", async () => {
  const root = await mkdtemp(
    path.join(
      fileURLToPath(new URL("../../../../../.tmp/", import.meta.url)),
      "otto-legacy-history-e2e-",
    ),
  );
  const requests: Array<{
    messages: Array<{ role: string; content: unknown; reasoning?: string; tool_call_id?: string }>;
  }> = [];
  const endpoint = createServer(async (request, response) => {
    if (request.method === "GET") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: [{ id: "fixture" }] }));
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push(JSON.parse(body));
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Old context is retained." }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    );
  });
  endpoint.listen(0, "127.0.0.1");
  await once(endpoint, "listening");
  const address = endpoint.address();
  if (!address || typeof address === "string") throw Error("Missing endpoint");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const homeRoot = path.join(root, "home");
  const home = path.join(homeRoot, ".paseo");
  await mkdir(path.join(home, "agents"), { recursive: true });
  const config = JSON.stringify({
    agents: {
      providers: {
        "openai-compatible": { extends: "openai-compatible", env: { OPENAI_BASE_URL: baseUrl } },
      },
    },
  });
  await writeFile(path.join(home, "otto-config.json"), config);
  await writeFile(path.join(home, "config.json.otto-0.9.bak"), config);
  const image = {
    data: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    mimeType: "image/gif",
  };
  const call = (id: string) => ({
    id,
    type: "function",
    function: {
      name: "otto_write_file",
      arguments: JSON.stringify({ path: "proof.txt", content: "must never rerun" }),
    },
  });
  const userId = randomUUID();
  const handle = {
    provider: "openai-compatible",
    sessionId: randomUUID(),
    metadata: {
      model: "fixture",
      modeId: "default",
      messages: [
        { role: "system", content: "Preserve the historical project constraint." },
        { role: "user", content: "Earlier summary", isCompactionSummary: true },
        { role: "user", content: "Follow src/AGENTS.md", subtreeInstructionDir: "src" },
        { role: "user", content: "Original user request", messageId: userId, images: [image] },
        {
          role: "assistant",
          content: "Original answer",
          reasoning: "UI-only legacy thinking",
          tool_calls: [call("done"), call("other")],
        },
        { role: "tool", tool_call_id: "done", content: "Already completed.", images: [image] },
        { role: "tool", tool_call_id: "other", content: "Also completed." },
        { role: "assistant", content: "An interrupted request", tool_calls: [call("pending")] },
      ],
    },
  };
  const agentId = randomUUID();
  const original = {
    id: agentId,
    provider: "openai-compatible",
    cwd: root,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:01:00.000Z",
    title: "Existing 0.9 chat",
    labels: { retained: "yes" },
    lastStatus: "idle",
    config: {
      model: "fixture",
      modeId: "default",
      thinkingOptionId: "off",
      featureValues: { auto_compact: "off", reasoning_effort: "off" },
    },
    persistence: handle,
    ottoFuture: { opaque: "must-keep" },
  };
  await writeFile(path.join(home, "agents", `${agentId}.json`), JSON.stringify(original));
  await writeFile(path.join(root, "proof.txt"), "old side effect");
  const start = () =>
    createTestPaseoDaemon({
      paseoHomeRoot: homeRoot,
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
  try {
    await client.connect();
    await client.fetchAgents({ subscribe: {} });
    await client.sendMessage(agentId, "Continue the existing conversation.");
    expect((await client.waitForFinish(agentId, 15000)).status).toBe("idle");
    expect(requests).toHaveLength(1);
    expect(requests[0]).not.toHaveProperty("reasoning_effort");
    const messages = requests[0]!.messages;
    expect(JSON.stringify(messages)).toContain("Preserve the historical project constraint.");
    expect(JSON.stringify(messages)).toContain("Follow src/AGENTS.md");
    expect(JSON.stringify(messages)).not.toContain("UI-only legacy thinking");
    expect(JSON.stringify(messages)).toContain(`data:image/gif;base64,${image.data}`);
    const done = messages.findIndex(
      (message) => message.role === "tool" && message.tool_call_id === "done",
    );
    expect(messages[done + 1]).toMatchObject({ role: "tool", tool_call_id: "other" });
    expect(messages[done + 2]).toMatchObject({ role: "user", content: expect.any(Array) });
    expect(messages).toContainEqual(
      expect.objectContaining({
        role: "tool",
        tool_call_id: "pending",
        content: expect.stringContaining("not executed"),
      }),
    );
    const timeline = await client.fetchAgentTimeline(agentId, {
      direction: "tail",
      limit: 0,
      projection: "canonical",
    });
    const history = JSON.stringify(timeline.entries);
    expect(history).toContain("Original user request");
    expect(history).toContain("UI-only legacy thinking");
    expect(timeline.entries.filter((entry) => entry.item.type === "user_message")).toHaveLength(2);
    expect(await readFile(path.join(root, "proof.txt"), "utf8")).toBe("old side effect");
    const backups = await readdir(path.join(home, "otto-openai-compatible", "legacy-imports"));
    expect(backups).toHaveLength(1);
    expect(
      JSON.parse(
        await readFile(
          path.join(home, "otto-openai-compatible", "legacy-imports", backups[0]!),
          "utf8",
        ),
      ),
    ).toEqual(handle);
    await client.close();
    await daemon.close();
    daemon = await start();
    client = connect(daemon.port);
    await client.connect();
    await client.fetchAgents({ subscribe: {} });
    await client.sendMessage(agentId, "Continue after restart.");
    expect((await client.waitForFinish(agentId, 15000)).status).toBe("idle");
    expect(requests).toHaveLength(2);
    expect(requests[1]).not.toHaveProperty("reasoning_effort");
    expect(JSON.stringify(requests[1])).toContain("Original user request");
    expect(await readdir(path.join(home, "otto-openai-compatible", "legacy-imports"))).toEqual(
      backups,
    );
    expect(await readFile(path.join(root, "proof.txt"), "utf8")).toBe("old side effect");
    const records = await readdir(path.join(home, "agents"), { recursive: true });
    const saved = await Promise.all(
      records
        .filter((file) => file.endsWith(".json"))
        .map(async (file) => JSON.parse(await readFile(path.join(home, "agents", file), "utf8"))),
    );
    expect(saved.find((record) => record.id === agentId)).toMatchObject({
      id: agentId,
      title: original.title,
      labels: original.labels,
      ottoFuture: original.ottoFuture,
    });
  } finally {
    await client.close();
    await daemon.close();
    endpoint.closeAllConnections();
    await new Promise<void>((resolve) => endpoint.close(() => resolve()));
  }
}, 60000);
