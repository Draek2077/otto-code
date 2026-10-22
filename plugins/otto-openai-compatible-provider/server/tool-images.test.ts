import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import type { ProviderEvent } from "@getpaseo/plugin/server/provider";
import { createOpenAiProvider } from "./provider.js";

it("delivers MCP images after every tool reply in the round and keeps image bytes out of persistence", async () => {
  const root = fileURLToPath(new URL("../../../.tmp/", import.meta.url));
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, "mcp-images-"));
  const modelRequests: Array<{
    messages: Array<{ role: string; content: unknown }>;
    tools: Array<{ function: { name: string } }>;
  }> = [];
  let mcpCalls = 0;
  const server = createServer(async (request, response) => {
    if (request.method === "DELETE") {
      response.writeHead(204);
      response.end();
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    if (request.url === "/mcp") {
      if (input.method === "notifications/initialized") {
        response.writeHead(202);
        response.end();
        return;
      }
      let result: unknown;
      if (input.method === "initialize")
        result = { protocolVersion: "2025-03-26", capabilities: { tools: {} } };
      else if (input.method === "tools/list")
        result = { tools: [{ name: "capture", inputSchema: { type: "object" } }] };
      else {
        mcpCalls++;
        result = {
          content: [
            { type: "text", text: "Captured." },
            { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
          ],
        };
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: input.id, result }));
      return;
    }
    modelRequests.push(input);
    const name = input.tools.find((tool: { function: { name: string } }) =>
      tool.function.name.startsWith("mcp_"),
    )?.function.name;
    const afterTool = input.messages.some((message: { role: string }) => message.role === "tool");
    if (!afterTool && !name) throw Error("Missing fixture MCP tool");
    const delta = afterTool
      ? { content: "Both images inspected." }
      : {
          tool_calls: [0, 1].map((index) => ({
            index,
            id: `capture-${index}`,
            type: "function",
            function: { name, arguments: "{}" },
          })),
        };
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: afterTool ? "stop" : "tool_calls" }] })}\n\ndata: [DONE]\n\n`,
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing endpoint");
  const provider = createOpenAiProvider(
    async () => ({
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      model: "vision",
      apiKeyEnv: "OPENAI_API_KEY",
      maxToolRounds: 3,
      timeoutMs: 5000,
    }),
    { imageDirectory: directory },
  );
  const connection = await provider.connect({
    versions: [1],
    capabilities: ["prompt.message", "permission", "permission.tool_policy", "session.persistence"],
  });
  try {
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    await connection.send({
      type: "session.open",
      requestId: "open",
      sessionId: "one",
      history: "skip",
      config: {
        cwd: directory,
        env: {},
        model: "vision",
        settings: {},
        persist: true,
        mcpServers: { visual: { type: "http", url: `http://127.0.0.1:${address.port}/mcp` } },
        toolPolicy: { preapproved: [{ kind: "mcp", server: "visual", tool: "capture" }] },
      },
    });
    await expect.poll(() => events.some((event) => event.type === "session.ready")).toBe(true);
    await connection.send({
      type: "session.prompt",
      sessionId: "one",
      prompt: {
        clientMessageId: "capture",
        delivery: "auto",
        input: { type: "message", content: [{ type: "text", text: "Inspect two captures." }] },
      },
    });
    await expect
      .poll(() =>
        events.some((event) => event.type === "session.turn" && event.state === "completed"),
      )
      .toBe(true);
    expect(modelRequests[1]!.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "tool",
      "user",
    ]);
    expect(modelRequests[1]!.messages.at(-1)).toEqual({
      role: "user",
      content: [
        { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
        { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
      ],
    });
    expect(
      JSON.stringify(events.filter((event) => event.type === "session.persistence")),
    ).not.toContain("aGVsbG8=");
    expect(
      events.findLast((event) => event.type === "timeline.item" && event.item.type === "tool_call"),
    ).toMatchObject({
      item: {
        status: "completed",
        detail: { type: "unknown", output: "Captured.\n[MCP image: image/png]" },
      },
    });
    const midway = events.find(
      (event) =>
        event.type === "session.persistence" &&
        JSON.stringify(event.persistence.data).includes('"pendingToolImages":[{'),
    );
    if (midway?.type !== "session.persistence")
      throw Error("Missing atomic tool/image recovery state");
    await connection.close();
    const recovered = await provider.connect({
      versions: [1],
      capabilities: [
        "prompt.message",
        "permission",
        "permission.tool_policy",
        "session.persistence",
      ],
    });
    try {
      const restored: ProviderEvent[] = [];
      recovered.onEvent((event) => restored.push(event));
      await recovered.send({
        type: "session.open",
        requestId: "restore",
        sessionId: "two",
        history: "replay",
        persistence: midway.persistence,
        config: {
          cwd: directory,
          env: {},
          model: "vision",
          settings: {},
          persist: true,
          mcpServers: {},
        },
      });
      await expect.poll(() => restored.some((event) => event.type === "session.ready")).toBe(true);
      await recovered.send({
        type: "session.prompt",
        sessionId: "two",
        prompt: {
          clientMessageId: "resume",
          delivery: "auto",
          input: {
            type: "message",
            content: [{ type: "text", text: "Continue from the completed capture." }],
          },
        },
      });
      await expect
        .poll(() =>
          restored.some((event) => event.type === "session.turn" && event.state === "completed"),
        )
        .toBe(true);
      expect(mcpCalls).toBe(2);
      expect(modelRequests[2]!.messages.map((message) => message.role)).toEqual([
        "user",
        "assistant",
        "tool",
        "tool",
        "user",
        "user",
      ]);
      expect(modelRequests[2]!.messages[4]).toEqual({
        role: "user",
        content: [{ type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } }],
      });
    } finally {
      await recovered.close();
    }
  } finally {
    await connection.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
