import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { settingsRpc } from "@getpaseo/plugin";
import { BuiltinPluginLoader } from "../plugins/builtin/index.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";

test("the bundled Otto provider publishes shared client settings and completes a normal daemon chat", async () => {
  const scratch = fileURLToPath(new URL("../../../../../.tmp/", import.meta.url));
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, "otto-provider-e2e-"));
  const prompts: Array<{
    model: string;
    reasoning_effort?: string;
    max_tokens?: number;
    messages: Array<{ role: string; content: string }>;
    tools?: Array<{ function: { name: string } }>;
  }> = [];
  const server = createServer(async (request, response) => {
    if (request.url === "/v1/models") {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          data: [{ id: "fixture" }, { id: "configured", reasoning_efforts: ["low", "high"] }],
        }),
      );
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    prompts.push(JSON.parse(body));
    response.setHeader("content-type", "text/event-stream");
    response.end(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Otto provider integration proof" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing endpoint");
  const daemon = await createTestPaseoDaemon({
    paseoHomeRoot: path.join(root, "home"),
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
    const catalog = await client.getPluginCatalog();
    expect(
      catalog.find((plugin) => plugin.id === "otto-openai-compatible-provider")?.clientBundle,
    ).toContain("Otto OpenAI-compatible");
    const rpc = settingsRpc("connection");
    const initial = rpc.read.output.parse(
      await client.invokePluginRpc("otto-openai-compatible-provider", rpc.read.name, {}),
    );
    if (initial.status !== "ready") throw Error(initial.error);
    expect(
      await client.invokePluginRpc("otto-openai-compatible-provider", rpc.write.name, {
        revision: initial.revision,
        values: { baseUrl: "ftp://fixture.invalid/v1" },
      }),
    ).toMatchObject({ status: "invalid" });
    expect(
      await client.invokePluginRpc("otto-openai-compatible-provider", rpc.read.name, {}),
    ).toEqual(initial);
    expect(
      await client.invokePluginRpc("otto-openai-compatible-provider", rpc.write.name, {
        revision: initial.revision,
        values: { baseUrl: `http://127.0.0.1:${address.port}/v1` },
      }),
    ).toMatchObject({ status: "saved" });
    expect(await client.listProviderModels("openai-compatible", { cwd: root })).toMatchObject({
      models: [{ id: "fixture" }, { id: "configured" }],
    });
    const agent = await client.createAgent({
      provider: "openai-compatible",
      model: "fixture",
      modeId: "default",
      cwd: root,
      title: "Otto provider proof",
    });
    await client.setAgentFeature(agent.id, "auto_compact", "off");
    expect(await client.listCommands(agent.id)).toMatchObject({
      commands: [expect.objectContaining({ name: "compact" })],
    });
    const firstPrompt = `Say hello. ${"Earlier project context. ".repeat(400)}`.trim();
    await client.sendMessage(agent.id, firstPrompt);
    expect((await client.waitForFinish(agent.id, 15_000)).status).toBe("idle");
    const timeline = await client.fetchAgentTimeline(agent.id, {
      direction: "tail",
      limit: 0,
      projection: "canonical",
    });
    expect(JSON.stringify(timeline.entries)).toContain("Otto provider integration proof");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.messages).toContainEqual({ role: "user", content: firstPrompt });
    expect(prompts[0]?.tools?.length).toBeGreaterThanOrEqual(3);
    await client.setAgentModel(agent.id, "configured");
    await client.setAgentThinkingOption(agent.id, "high");
    await client.setAgentMode(agent.id, "plan");
    await client.setAgentFeature(agent.id, "output_limit", "4096");
    await client.sendMessage(agent.id, "Use the saved session controls");
    expect((await client.waitForFinish(agent.id, 15_000)).status).toBe("idle");
    expect(prompts[1]).toMatchObject({
      model: "configured",
      reasoning_effort: "high",
      max_tokens: 4096,
    });
    expect(prompts[1]?.tools?.some((tool) => tool.function.name === "otto_write_file")).toBe(false);
    await client.sendMessage(agent.id, "/compact Keep the project objective");
    expect((await client.waitForFinish(agent.id, 15_000)).status).toBe("idle");
    expect(prompts[2]?.tools).toBeUndefined();
    expect(prompts[2]?.messages[0]?.content).toContain("Summarize the supplied");
    await client.sendMessage(agent.id, "Continue after compaction", { messageId: "rewind-target" });
    expect((await client.waitForFinish(agent.id, 15_000)).status).toBe("idle");
    expect(prompts[3]?.messages).not.toContainEqual({ role: "user", content: firstPrompt });
    expect(prompts[3]?.messages).toContainEqual({
      role: "user",
      content: "Use the saved session controls",
    });
    await client.rewindAgent(agent.id, "rewind-target", "conversation");
    const rewound = await client.fetchAgentTimeline(agent.id, {
      direction: "tail",
      limit: 0,
      projection: "canonical",
    });
    expect(JSON.stringify(rewound.entries)).not.toContain("Continue after compaction");
    expect(
      rewound.entries.flatMap((entry) =>
        entry.item.type === "compaction" ? [entry.item.status] : [],
      ),
    ).toEqual(["completed"]);
    await client.sendMessage(agent.id, "Replacement after rewind", { messageId: "replacement" });
    expect((await client.waitForFinish(agent.id, 15_000)).status).toBe("idle");
    expect(prompts[4]?.messages).not.toContainEqual({
      role: "user",
      content: "Continue after compaction",
    });
    await client.rewindAgent(agent.id, "replacement", "conversation");
    const again = await client.fetchAgentTimeline(agent.id, {
      direction: "tail",
      limit: 0,
      projection: "canonical",
    });
    expect(again.entries[0]?.timestamp).toBe(rewound.entries[0]?.timestamp);
  } finally {
    await client.close();
    await daemon.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
