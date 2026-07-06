import * as fs from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import type { AgentStreamEvent, McpServerConfig } from "../agent-sdk-types.js";
import { OpenAICompatAgentClient, normalizeOpenAICompatBaseUrl } from "./openai-compat-agent.js";
import { executeCompatTool } from "./openai-compat-tools.js";

interface TestEndpoint {
  server: Server;
  baseUrl: string;
}

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

function sseChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

async function startEndpoint(options?: {
  slowStream?: boolean;
  /** Include a vLLM-style max_model_len on the standard /v1/models listing. */
  v1ContextLength?: number;
  /** Serve LM Studio's native /api/v0/models listing with loaded_context_length. */
  nativeContextLength?: number;
}): Promise<TestEndpoint & { completionBodies: Array<Record<string, unknown>> }> {
  const completionBodies: Array<Record<string, unknown>> = [];
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      const extra =
        typeof options?.v1ContextLength === "number"
          ? { max_model_len: options.v1ContextLength }
          : {};
      res.end(JSON.stringify({ data: [{ id: "test-model-a", ...extra }, { id: "test-model-b" }] }));
      return;
    }
    if (req.method === "GET" && req.url === "/api/v0/models") {
      if (typeof options?.nativeContextLength !== "number") {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          data: [
            {
              id: "test-model-a",
              state: "loaded",
              loaded_context_length: options.nativeContextLength,
              max_context_length: options.nativeContextLength * 2,
            },
          ],
        }),
      );
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const request = JSON.parse(body) as { model: string; messages: unknown[] };
        completionBodies.push(request as unknown as Record<string, unknown>);
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        });
        const chunks = [
          sseChunk({ choices: [{ delta: { reasoning_content: "thinking " } }] }),
          sseChunk({ choices: [{ delta: { content: "Hello" } }] }),
          sseChunk({ choices: [{ delta: { content: ` from ${request.model}` } }] }),
          sseChunk({ choices: [{ delta: {} }], usage: { prompt_tokens: 7, completion_tokens: 3 } }),
          "data: [DONE]\n\n",
        ];
        if (options?.slowStream) {
          let index = 0;
          const timer = setInterval(() => {
            if (index >= chunks.length) {
              clearInterval(timer);
              res.end();
              return;
            }
            res.write(chunks[index]);
            index += 1;
          }, 25);
          res.on("close", () => clearInterval(timer));
          return;
        }
        for (const chunk of chunks) {
          res.write(chunk);
        }
        res.end();
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}`, completionBodies };
}

function createClient(baseUrl: string): OpenAICompatAgentClient {
  return new OpenAICompatAgentClient({
    providerId: "lmstudio",
    label: "LM Studio",
    env: { OPENAI_BASE_URL: baseUrl },
  });
}

describe("normalizeOpenAICompatBaseUrl", () => {
  test("appends /v1 when missing and strips trailing slashes", () => {
    expect(normalizeOpenAICompatBaseUrl("http://localhost:1234")).toBe("http://localhost:1234/v1");
    expect(normalizeOpenAICompatBaseUrl("http://localhost:1234/")).toBe("http://localhost:1234/v1");
    expect(normalizeOpenAICompatBaseUrl("http://localhost:1234/v1/")).toBe(
      "http://localhost:1234/v1",
    );
  });
});

describe("OpenAICompatAgentClient", () => {
  test("discovers models from GET /v1/models with the first as default", async () => {
    const endpoint = await startEndpoint();
    const client = createClient(endpoint.baseUrl);

    const catalog = await client.fetchCatalog({ scope: "global", force: true });

    expect(catalog.models.map((model) => model.id)).toEqual(["test-model-a", "test-model-b"]);
    expect(catalog.models[0]?.isDefault).toBe(true);
    expect(catalog.models[0]?.provider).toBe("lmstudio");
  });

  test("reports an actionable error when the server is unreachable", async () => {
    const client = createClient("http://127.0.0.1:1");

    await expect(client.fetchCatalog({ scope: "global", force: true })).rejects.toThrow(
      /Cannot reach LM Studio at http:\/\/127\.0\.0\.1:1\/v1/,
    );
  });

  test("streams a chat turn as timeline events and persists the conversation", async () => {
    const endpoint = await startEndpoint();
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });

    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    const result = await session.run("Say hello");

    expect(result.canceled).toBe(false);
    expect(result.finalText).toBe("Hello from test-model-a");
    expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 3, contextWindowUsedTokens: 10 });

    const assistantChunks = events.flatMap((event) =>
      event.type === "timeline" && event.item.type === "assistant_message" ? [event.item.text] : [],
    );
    expect(assistantChunks.join("")).toBe("Hello from test-model-a");
    expect(
      events.some((event) => event.type === "timeline" && event.item.type === "reasoning"),
    ).toBe(true);
    expect(events.at(-1)?.type).toBe("turn_completed");

    const persistence = session.describePersistence();
    const messages = persistence?.metadata?.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.role).toBe("system");
    expect(messages.slice(1)).toEqual([
      // The persisted messageId ties the message to its timeline item for rewind.
      { role: "user", content: "Say hello", messageId: expect.any(String) },
      { role: "assistant", content: "Hello from test-model-a" },
    ]);
  });

  test("resolves the context window from LM Studio's native model listing", async () => {
    const endpoint = await startEndpoint({ nativeContextLength: 8192 });
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });

    const result = await session.run("Say hello");
    expect(result.usage).toEqual({
      inputTokens: 7,
      outputTokens: 3,
      contextWindowUsedTokens: 10,
      contextWindowMaxTokens: 8192,
    });
  });

  test("reads vLLM-style context length extensions from /v1/models", async () => {
    const endpoint = await startEndpoint({ v1ContextLength: 32768 });
    const client = createClient(endpoint.baseUrl);

    const catalog = await client.fetchCatalog({ scope: "global", force: true });
    expect(catalog.models[0]).toMatchObject({
      id: "test-model-a",
      contextWindowMaxTokens: 32768,
    });

    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });
    const result = await session.run("Say hello");
    expect(result.usage?.contextWindowMaxTokens).toBe(32768);
  });

  test("getContextUsage reports a category makeup scaled to the measured context size", async () => {
    const endpoint = await startEndpoint({ nativeContextLength: 8192 });
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });

    await session.run("Say hello");
    const usage = await session.getContextUsage?.();

    expect(usage).not.toBeNull();
    expect(usage?.maxTokens).toBe(8192);
    // Exact total comes from the server's prompt+completion measurement.
    expect(usage?.totalTokens).toBe(10);
    // The measured total (10 tokens) is far below the char-based estimates, so
    // small categories can scale to zero and drop out; the survivors must all
    // be known categories.
    const names = usage?.categories.map((category) => category.name) ?? [];
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(["Messages", "Tools", "System prompt"]).toContain(name);
    }
    const sum = usage?.categories.reduce((acc, category) => acc + category.tokens, 0) ?? 0;
    // Rounded per-category scaling stays within one token per category of the total.
    expect(Math.abs(sum - (usage?.totalTokens ?? 0))).toBeLessThanOrEqual(3);
  });

  test("getContextUsage is null when no context window can be discovered", async () => {
    const endpoint = await startEndpoint();
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });

    await session.run("Say hello");
    await expect(session.getContextUsage?.()).resolves.toBeNull();
  });

  test("resumed sessions keep conversation context", async () => {
    const endpoint = await startEndpoint();
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });
    await session.run("Say hello");
    const handle = session.describePersistence();
    expect(handle).not.toBeNull();

    const resumed = await client.resumeSession(handle!);
    const replayed: AgentStreamEvent[] = [];
    for await (const event of resumed.streamHistory()) {
      replayed.push(event);
    }
    const texts = replayed.flatMap((event) => (event.type === "timeline" ? [event.item] : []));
    expect(texts).toEqual([
      expect.objectContaining({ type: "user_message", text: "Say hello" }),
      expect.objectContaining({ type: "assistant_message", text: "Hello from test-model-a" }),
    ]);
  });

  test("interrupt cancels an in-flight turn", async () => {
    const endpoint = await startEndpoint({ slowStream: true });
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });

    const events: AgentStreamEvent[] = [];
    const firstChunk = new Promise<void>((resolve) => {
      session.subscribe((event) => {
        events.push(event);
        if (event.type === "timeline" && event.item.type === "assistant_message") {
          resolve();
        }
      });
    });

    const resultPromise = session.run("Say hello slowly");
    await firstChunk;
    await session.interrupt();

    const result = await resultPromise;
    expect(result.canceled).toBe(true);
    expect(events.some((event) => event.type === "turn_canceled")).toBe(true);
  });

  test("failed turns emit turn_failed and reject run()", async () => {
    const endpoint = await startEndpoint();
    const client = createClient(endpoint.baseUrl);
    // Close the server before the turn so the request fails.
    await new Promise<void>((resolve) => endpoint.server.close(() => resolve()));

    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    await expect(session.run("Say hello")).rejects.toThrow(/Cannot reach LM Studio|fetch failed/);
    expect(events.some((event) => event.type === "turn_failed")).toBe(true);
  });
});

interface RecordedRequest {
  messages: Array<Record<string, unknown>>;
  tools?: unknown[];
}

/**
 * Fake server whose first completion round streams a chunked write_file tool
 * call and whose second round streams a plain text answer.
 */
async function startToolEndpoint(): Promise<TestEndpoint & { requests: RecordedRequest[] }> {
  const requests: RecordedRequest[] = [];
  const args = JSON.stringify({ path: "note.txt", content: "hello tools" });
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "test-model-a" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        requests.push(JSON.parse(body) as RecordedRequest);
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        if (requests.length === 1) {
          res.write(
            sseChunk({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      { index: 0, id: "call_1", function: { name: "write_file", arguments: "" } },
                    ],
                  },
                },
              ],
            }),
          );
          res.write(
            sseChunk({
              choices: [
                {
                  delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(0, 18) } }] },
                },
              ],
            }),
          );
          res.write(
            sseChunk({
              choices: [
                {
                  delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(18) } }] },
                  finish_reason: "tool_calls",
                },
              ],
            }),
          );
        } else {
          res.write(sseChunk({ choices: [{ delta: { content: "File created." } }] }));
          res.write(sseChunk({ choices: [{ delta: {}, finish_reason: "stop" }] }));
        }
        res.write("data: [DONE]\n\n");
        res.end();
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}`, requests };
}

async function makeTempCwd(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "otto-compat-tools-"));
}

describe("OpenAICompatAgentSession reasoning effort", () => {
  test("omits reasoning_effort by default and sends it after setFeature", async () => {
    const endpoint = await startEndpoint();
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });

    await session.run("Say hello");
    expect(endpoint.completionBodies[0]).not.toHaveProperty("reasoning_effort");
    expect(session.features).toEqual([
      expect.objectContaining({ id: "reasoning_effort", value: "off" }),
    ]);

    await session.setFeature?.("reasoning_effort", "high");
    await session.run("Say hello again");
    expect(endpoint.completionBodies[1]?.reasoning_effort).toBe("high");
    expect(session.features).toEqual([
      expect.objectContaining({ id: "reasoning_effort", value: "high" }),
    ]);
  });

  test("restores reasoning effort from featureValues", async () => {
    const endpoint = await startEndpoint();
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
      featureValues: { reasoning_effort: "low" },
    });

    await session.run("Say hello");
    expect(endpoint.completionBodies[0]?.reasoning_effort).toBe("low");
  });

  test("rejects unknown features and invalid values", async () => {
    const endpoint = await startEndpoint();
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });

    await expect(session.setFeature?.("reasoning_effort", "extreme")).rejects.toThrow(
      /Invalid reasoning effort/,
    );
    await expect(session.setFeature?.("unknown_feature", true)).rejects.toThrow(/Unknown feature/);
  });

  test("listFeatures seeds the draft select from featureValues", async () => {
    const endpoint = await startEndpoint();
    const client = createClient(endpoint.baseUrl);

    await expect(
      client.listFeatures({ provider: "lmstudio", cwd: process.cwd() }),
    ).resolves.toEqual([expect.objectContaining({ id: "reasoning_effort", value: "off" })]);
    await expect(
      client.listFeatures({
        provider: "lmstudio",
        cwd: process.cwd(),
        featureValues: { reasoning_effort: "medium" },
      }),
    ).resolves.toEqual([expect.objectContaining({ id: "reasoning_effort", value: "medium" })]);
  });
});

describe("OpenAICompatAgentSession rewind", () => {
  function userMessageIds(events: AgentStreamEvent[]): string[] {
    return events.flatMap((event) =>
      event.type === "timeline" && event.item.type === "user_message" && event.item.messageId
        ? [event.item.messageId]
        : [],
    );
  }

  test("revertConversation truncates the conversation and replayable history", async () => {
    const endpoint = await startEndpoint();
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    await session.run("First question");
    await session.run("Second question");
    const [, secondId] = userMessageIds(events);
    expect(secondId).toBeDefined();

    await session.revertConversation?.({ messageId: secondId! });

    // The next request no longer carries the reverted turn.
    await session.run("Different question");
    const lastBody = endpoint.completionBodies.at(-1) as { messages: Array<{ content: string }> };
    const contents = lastBody.messages.map((message) => message.content);
    expect(contents).toContain("First question");
    expect(contents).toContain("Different question");
    expect(contents).not.toContain("Second question");

    // messageId is provider-internal and never sent to the endpoint.
    for (const message of lastBody.messages) {
      expect(message).not.toHaveProperty("messageId");
    }
  });

  test("streamHistory replays only the retained conversation after rewind", async () => {
    const endpoint = await startEndpoint();
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    await session.run("First question");
    await session.run("Second question");
    const [, secondId] = userMessageIds(events);
    await session.revertConversation?.({ messageId: secondId! });

    const replayed: AgentStreamEvent[] = [];
    for await (const event of session.streamHistory()) {
      replayed.push(event);
    }
    const texts = replayed.flatMap((event) =>
      event.type === "timeline" &&
      (event.item.type === "user_message" || event.item.type === "assistant_message")
        ? [event.item.text]
        : [],
    );
    expect(texts).toEqual(["First question", "Hello from test-model-a"]);
  });

  test("rewind by persisted messageId works across resume", async () => {
    const endpoint = await startEndpoint();
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));
    await session.run("First question");
    await session.run("Second question");
    const [, secondId] = userMessageIds(events);

    const resumed = await client.resumeSession(session.describePersistence()!);

    // The resumed session replays the same user message ids it persisted.
    const replayedIds: string[] = [];
    for await (const event of resumed.streamHistory()) {
      if (event.type === "timeline" && event.item.type === "user_message" && event.item.messageId) {
        replayedIds.push(event.item.messageId);
      }
    }
    expect(replayedIds).toContain(secondId);

    await resumed.revertConversation?.({ messageId: secondId! });
    await resumed.run("Third question");
    const lastBody = endpoint.completionBodies.at(-1) as { messages: Array<{ content: string }> };
    const contents = lastBody.messages.map((message) => message.content);
    expect(contents).toContain("First question");
    expect(contents).not.toContain("Second question");
  });

  test("rewind to an unknown message fails with a clear error", async () => {
    const endpoint = await startEndpoint();
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });
    await session.run("First question");

    await expect(session.revertConversation?.({ messageId: "missing" })).rejects.toThrow(
      /Message not found/,
    );
  });
});

describe("OpenAICompatAgentSession tool loop", () => {
  test("executes streamed tool calls and feeds results back to the model", async () => {
    const endpoint = await startToolEndpoint();
    const client = createClient(endpoint.baseUrl);
    const cwd = await makeTempCwd();
    const session = await client.createSession({
      provider: "lmstudio",
      cwd,
      model: "test-model-a",
      modeId: "bypassPermissions",
    });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    const result = await session.run("Create note.txt");

    expect(result.finalText).toBe("File created.");
    await expect(fs.readFile(path.join(cwd, "note.txt"), "utf8")).resolves.toBe("hello tools");

    // Round 1 offered tools; round 2 carried the tool result back.
    expect(endpoint.requests).toHaveLength(2);
    expect(endpoint.requests[0]?.tools?.length).toBeGreaterThan(0);
    const round2Roles = endpoint.requests[1]!.messages.map((message) => message.role);
    expect(round2Roles).toContain("tool");
    const toolMessage = endpoint.requests[1]!.messages.find((message) => message.role === "tool");
    expect(toolMessage?.tool_call_id).toBe("call_1");
    expect(String(toolMessage?.content)).toContain("Wrote");

    const toolItems = events.flatMap((event) =>
      event.type === "timeline" && event.item.type === "tool_call" ? [event.item] : [],
    );
    expect(toolItems.map((item) => item.status)).toEqual(["running", "completed"]);
    expect(toolItems[0]?.name).toBe("write_file");

    // Tool traffic persists so resume keeps the full conversation.
    const persisted = session.describePersistence()?.metadata?.messages as Array<
      Record<string, unknown>
    >;
    expect(persisted.some((message) => message.role === "tool")).toBe(true);
  });

  test("default mode asks permission for writes and executes on allow", async () => {
    const endpoint = await startToolEndpoint();
    const client = createClient(endpoint.baseUrl);
    const cwd = await makeTempCwd();
    const session = await client.createSession({
      provider: "lmstudio",
      cwd,
      model: "test-model-a",
      modeId: "default",
    });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => {
      events.push(event);
      if (event.type === "permission_requested") {
        void session.respondToPermission(event.request.id, { behavior: "allow" });
      }
    });

    await session.run("Create note.txt");

    const request = events.find((event) => event.type === "permission_requested");
    expect(request).toBeDefined();
    expect(request?.type === "permission_requested" && request.request.name).toBe("write_file");
    expect(events.some((event) => event.type === "permission_resolved")).toBe(true);
    await expect(fs.readFile(path.join(cwd, "note.txt"), "utf8")).resolves.toBe("hello tools");
  });

  test("denied permission skips the tool and tells the model", async () => {
    const endpoint = await startToolEndpoint();
    const client = createClient(endpoint.baseUrl);
    const cwd = await makeTempCwd();
    const session = await client.createSession({
      provider: "lmstudio",
      cwd,
      model: "test-model-a",
      modeId: "default",
    });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => {
      events.push(event);
      if (event.type === "permission_requested") {
        void session.respondToPermission(event.request.id, {
          behavior: "deny",
          message: "not now",
        });
      }
    });

    await session.run("Create note.txt");

    await expect(fs.access(path.join(cwd, "note.txt"))).rejects.toThrow();
    const toolMessage = endpoint.requests[1]!.messages.find((message) => message.role === "tool");
    expect(String(toolMessage?.content)).toContain("declined");
    const failedItem = events.find(
      (event) =>
        event.type === "timeline" &&
        event.item.type === "tool_call" &&
        event.item.status === "failed",
    );
    expect(failedItem).toBeDefined();
  });

  test("plan mode only offers read tools", async () => {
    const endpoint = await startToolEndpoint();
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: await makeTempCwd(),
      model: "test-model-a",
      modeId: "plan",
    });

    await session.run("Look around");

    const toolNames = (endpoint.requests[0]?.tools ?? []).map(
      (tool) => (tool as { function: { name: string } }).function.name,
    );
    expect(toolNames).toEqual(["read_file", "list_dir", "grep_search"]);
  });
});

async function respondWithMcpFixture(
  req: IncomingMessage,
  res: ServerResponse,
  body: string,
): Promise<void> {
  const mcpServer = new McpServer({ name: "otto-mcp-fixture", version: "1.0.0" });
  mcpServer.tool("echo", { text: z.string() }, async ({ text }) => ({
    content: [{ type: "text", text: `E:${text}` }],
  }));
  mcpServer.registerTool(
    "lookup",
    { inputSchema: { key: z.string() }, annotations: { readOnlyHint: true } },
    async ({ key }) => ({ content: [{ type: "text", text: `V:${key}` }] }),
  );
  mcpServer.registerPrompt(
    "review",
    { description: "Review something", argsSchema: { target: z.string() } },
    async ({ target }) => ({
      messages: [{ role: "user", content: { type: "text", text: `Please review ${target}.` } }],
    }),
  );
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void mcpServer.close();
  });
  await mcpServer.connect(transport);
  await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
}

/** In-process stateless HTTP MCP server exposing echo (mutating) + lookup (readOnlyHint). */
async function startMcpFixtureServer(): Promise<{ url: string }> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      respondWithMcpFixture(req, res, body).catch(() => {
        if (!res.headersSent) {
          res.writeHead(500);
        }
        res.end();
      });
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/mcp` };
}

/**
 * OpenAI endpoint whose first round streams a call to the given tool and whose
 * second round streams a final answer.
 */
async function startMcpDrivingEndpoint(
  toolName: string,
  argumentsJson: string,
): Promise<TestEndpoint & { requests: RecordedRequest[] }> {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "test-model-a" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        requests.push(JSON.parse(body) as RecordedRequest);
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        if (requests.length === 1) {
          res.write(
            sseChunk({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "call_mcp",
                        function: { name: toolName, arguments: argumentsJson },
                      },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
            }),
          );
        } else {
          res.write(
            sseChunk({ choices: [{ delta: { content: "Done." }, finish_reason: "stop" }] }),
          );
        }
        res.write("data: [DONE]\n\n");
        res.end();
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}`, requests };
}

function createMcpClient(
  baseUrl: string,
  options: {
    mcpServers?: Record<string, McpServerConfig>;
    mcpToolPermissions?: "always-ask" | "trust-read-only";
  },
): OpenAICompatAgentClient {
  return new OpenAICompatAgentClient({
    providerId: "lmstudio",
    label: "LM Studio",
    env: { OPENAI_BASE_URL: baseUrl },
    mcpServers: options.mcpServers,
    mcpToolPermissions: options.mcpToolPermissions,
  });
}

function toolPayloadNames(request: RecordedRequest | undefined): string[] {
  return (request?.tools ?? []).map(
    (tool) => (tool as { function: { name: string } }).function.name,
  );
}

describe("OpenAICompatAgentSession MCP tools", () => {
  test("offers MCP tools to the model and dispatches calls through the loop", async () => {
    const mcp = await startMcpFixtureServer();
    const endpoint = await startMcpDrivingEndpoint(
      "mcp_alpha_echo",
      JSON.stringify({ text: "hi" }),
    );
    const client = createMcpClient(endpoint.baseUrl, {
      mcpServers: { alpha: { type: "http", url: mcp.url } },
    });
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
      modeId: "bypassPermissions",
    });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    const result = await session.run("Use the echo tool");
    expect(result.finalText).toBe("Done.");

    expect(toolPayloadNames(endpoint.requests[0])).toContain("mcp_alpha_echo");
    const toolMessage = endpoint.requests[1]!.messages.find((message) => message.role === "tool");
    expect(toolMessage?.content).toBe("E:hi");

    const toolItems = events.flatMap((event) =>
      event.type === "timeline" && event.item.type === "tool_call" ? [event.item] : [],
    );
    expect(toolItems.map((item) => item.status)).toEqual(["running", "completed"]);
    expect(toolItems[0]?.name).toBe("mcp_alpha_echo");

    await session.close();
  });

  test("plan mode never exposes MCP tools", async () => {
    const mcp = await startMcpFixtureServer();
    const endpoint = await startEndpoint();
    const client = createMcpClient(endpoint.baseUrl, {
      mcpServers: { alpha: { type: "http", url: mcp.url } },
    });
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
      modeId: "plan",
    });

    await session.run("Look around");
    const names = toolPayloadNames(endpoint.completionBodies[0] as unknown as RecordedRequest);
    expect(names).toEqual(["read_file", "list_dir", "grep_search"]);

    await session.close();
  });

  test("per-agent servers override provider-level servers of the same name", async () => {
    const mcp = await startMcpFixtureServer();
    const endpoint = await startEndpoint();
    const client = createMcpClient(endpoint.baseUrl, {
      // Provider-level entry is unreachable; the per-agent entry must win.
      mcpServers: { alpha: { type: "http", url: "http://127.0.0.1:9/mcp" } },
    });
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
      mcpServers: { alpha: { type: "http", url: mcp.url } },
    });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    await session.run("Say hello");
    expect(toolPayloadNames(endpoint.completionBodies[0] as unknown as RecordedRequest)).toContain(
      "mcp_alpha_echo",
    );
    expect(
      events.some(
        (event) =>
          event.type === "timeline" &&
          event.item.type === "error" &&
          event.item.message.includes("MCP server"),
      ),
    ).toBe(false);

    await session.close();
  });

  test("strips the daemon-injected internal otto MCP server", async () => {
    const endpoint = await startEndpoint();
    const client = createMcpClient(endpoint.baseUrl, {});
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
      // The manager injects this into every launch config; this provider gets
      // Otto tools natively, so connecting to it over MCP would double them.
      mcpServers: { otto: { type: "http", url: "http://127.0.0.1:9/mcp/agents" } },
    });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    await session.run("Say hello");
    // No connection attempt: no failure warning, no mcp_ tools offered.
    expect(
      events.some(
        (event) =>
          event.type === "timeline" &&
          event.item.type === "error" &&
          event.item.message.includes("otto"),
      ),
    ).toBe(false);
    const names = toolPayloadNames(endpoint.completionBodies[0] as unknown as RecordedRequest);
    expect(names.filter((name) => name.startsWith("mcp_"))).toEqual([]);

    await session.close();
  });

  test("failed MCP servers surface one timeline warning and the session survives", async () => {
    const endpoint = await startEndpoint();
    const client = createMcpClient(endpoint.baseUrl, {
      mcpServers: { broken: { type: "http", url: "http://127.0.0.1:9/mcp" } },
    });
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    const result = await session.run("Say hello");
    expect(result.finalText).toBe("Hello from test-model-a");
    const warnings = events.filter(
      (event) =>
        event.type === "timeline" &&
        event.item.type === "error" &&
        event.item.message.includes("MCP server 'broken' unavailable"),
    );
    expect(warnings).toHaveLength(1);

    // The warning is announced once, not per turn.
    await session.run("Say hello again");
    const repeated = events.filter(
      (event) =>
        event.type === "timeline" &&
        event.item.type === "error" &&
        event.item.message.includes("MCP server 'broken' unavailable"),
    );
    expect(repeated).toHaveLength(1);

    await session.close();
  });
});

describe("OpenAICompatAgentSession MCP prompts as slash commands", () => {
  test("lists MCP prompts as slash commands", async () => {
    const mcp = await startMcpFixtureServer();
    const endpoint = await startEndpoint();
    const client = createMcpClient(endpoint.baseUrl, {
      mcpServers: { alpha: { type: "http", url: mcp.url } },
    });
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });

    await expect(session.listCommands?.()).resolves.toEqual([
      {
        name: "mcp_alpha_review",
        description: "Review something",
        argumentHint: "target",
      },
    ]);

    await session.close();
  });

  test("resolves a /prompt command into the model prompt, timeline keeps the typed text", async () => {
    const mcp = await startMcpFixtureServer();
    const endpoint = await startEndpoint();
    const client = createMcpClient(endpoint.baseUrl, {
      mcpServers: { alpha: { type: "http", url: mcp.url } },
    });
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    await session.run("/mcp_alpha_review the diff");

    const body = endpoint.completionBodies[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMessage = body.messages.find((message) => message.role === "user");
    expect(userMessage?.content).toBe("Please review the diff.");

    const typed = events.find(
      (event) => event.type === "timeline" && event.item.type === "user_message",
    );
    expect(
      typed?.type === "timeline" && typed.item.type === "user_message" && typed.item.text,
    ).toBe("/mcp_alpha_review the diff");

    await session.close();
  });

  test("unknown slash commands fall back to plain prompt text", async () => {
    const mcp = await startMcpFixtureServer();
    const endpoint = await startEndpoint();
    const client = createMcpClient(endpoint.baseUrl, {
      mcpServers: { alpha: { type: "http", url: mcp.url } },
    });
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });

    await session.run("/mcp_alpha_missing do things");
    const body = endpoint.completionBodies[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMessage = body.messages.find((message) => message.role === "user");
    expect(userMessage?.content).toBe("/mcp_alpha_missing do things");

    await session.close();
  });
});

describe("OpenAICompatAgentSession MCP permission gating", () => {
  async function runGatingScenario(options: {
    toolName: string;
    argumentsJson: string;
    modeId: string;
    mcpToolPermissions?: "always-ask" | "trust-read-only";
  }): Promise<{ permissionRequests: string[]; toolResult: unknown }> {
    const mcp = await startMcpFixtureServer();
    const endpoint = await startMcpDrivingEndpoint(options.toolName, options.argumentsJson);
    const client = createMcpClient(endpoint.baseUrl, {
      mcpServers: { alpha: { type: "http", url: mcp.url } },
      mcpToolPermissions: options.mcpToolPermissions,
    });
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
      modeId: options.modeId,
    });
    const permissionRequests: string[] = [];
    session.subscribe((event) => {
      if (event.type === "permission_requested") {
        permissionRequests.push(event.request.title);
        void session.respondToPermission(event.request.id, { behavior: "allow" });
      }
    });

    await session.run("Go");
    const toolMessage = endpoint.requests[1]!.messages.find((message) => message.role === "tool");
    await session.close();
    return { permissionRequests, toolResult: toolMessage?.content };
  }

  test("default mode always asks, even for read-only tools under trust-read-only", async () => {
    const outcome = await runGatingScenario({
      toolName: "mcp_alpha_lookup",
      argumentsJson: JSON.stringify({ key: "k" }),
      modeId: "default",
      mcpToolPermissions: "trust-read-only",
    });
    expect(outcome.permissionRequests).toEqual(["alpha: lookup"]);
    expect(outcome.toolResult).toBe("V:k");
  });

  test("acceptEdits with always-ask (default) asks for every MCP tool", async () => {
    const outcome = await runGatingScenario({
      toolName: "mcp_alpha_lookup",
      argumentsJson: JSON.stringify({ key: "k" }),
      modeId: "acceptEdits",
    });
    expect(outcome.permissionRequests).toEqual(["alpha: lookup"]);
  });

  test("acceptEdits with trust-read-only auto-approves readOnlyHint tools", async () => {
    const outcome = await runGatingScenario({
      toolName: "mcp_alpha_lookup",
      argumentsJson: JSON.stringify({ key: "k" }),
      modeId: "acceptEdits",
      mcpToolPermissions: "trust-read-only",
    });
    expect(outcome.permissionRequests).toEqual([]);
    expect(outcome.toolResult).toBe("V:k");
  });

  test("acceptEdits with trust-read-only still asks for tools without the hint", async () => {
    const outcome = await runGatingScenario({
      toolName: "mcp_alpha_echo",
      argumentsJson: JSON.stringify({ text: "hi" }),
      modeId: "acceptEdits",
      mcpToolPermissions: "trust-read-only",
    });
    expect(outcome.permissionRequests).toEqual(["alpha: echo"]);
  });
});

describe("executeCompatTool", () => {
  test("edit_file replaces a unique string and rejects ambiguous matches", async () => {
    const cwd = await makeTempCwd();
    const filePath = path.join(cwd, "sample.txt");
    await fs.writeFile(filePath, "alpha beta alpha", "utf8");

    const ambiguous = await executeCompatTool({
      name: "edit_file",
      arguments: { path: "sample.txt", old_string: "alpha", new_string: "gamma" },
      cwd,
    });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.output).toContain("matches 2 times");

    const unique = await executeCompatTool({
      name: "edit_file",
      arguments: { path: "sample.txt", old_string: "beta", new_string: "delta" },
      cwd,
    });
    expect(unique.isError).toBeUndefined();
    await expect(fs.readFile(filePath, "utf8")).resolves.toBe("alpha delta alpha");
  });

  test("run_command reports output and exit code", async () => {
    const cwd = await makeTempCwd();
    const outcome = await executeCompatTool({
      name: "run_command",
      arguments: { command: `node -e "console.log('hi'); process.exit(3)"` },
      cwd,
    });
    expect(outcome.output).toContain("hi");
    expect(outcome.output).toContain("[exit code 3]");
    expect(outcome.isError).toBe(true);
    expect(outcome.detail).toMatchObject({ type: "shell", exitCode: 3 });
  });

  test("list_dir and grep_search see workspace files", async () => {
    const cwd = await makeTempCwd();
    await fs.mkdir(path.join(cwd, "src"));
    await fs.writeFile(path.join(cwd, "src", "app.ts"), "const needle = 42;\n", "utf8");

    const listing = await executeCompatTool({ name: "list_dir", arguments: {}, cwd });
    expect(listing.output).toContain("src/");

    const found = await executeCompatTool({
      name: "grep_search",
      arguments: { pattern: "needle" },
      cwd,
    });
    expect(found.output).toContain("app.ts:1:const needle = 42;");
    expect(found.detail).toMatchObject({ type: "search", numMatches: 1 });
  });
});
