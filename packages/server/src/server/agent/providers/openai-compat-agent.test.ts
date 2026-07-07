import * as fs from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { OTTO_TOOL_GROUPS } from "@otto-code/protocol/provider-config";
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

/**
 * Endpoint that serves a two-round tool turn — a write_file call, then a
 * final text round — reporting usage on each round's last chunk so per-round
 * usage_updated emission can be asserted.
 */
async function startToolRoundUsageEndpoint(args: string): Promise<TestEndpoint> {
  const writeSseRound = (res: ServerResponse, body: string): void => {
    const parsed = JSON.parse(body) as { messages: Array<{ role: string }> };
    const isFirstRound = !parsed.messages.some((message) => message.role === "tool");
    if (isFirstRound) {
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
            { delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(0, 18) } }] } },
          ],
        }),
      );
      res.write(
        sseChunk({
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, function: { arguments: args.slice(18) } }],
                finish_reason: "tool_calls",
              },
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 10 },
        }),
      );
    } else {
      res.write(sseChunk({ choices: [{ delta: { content: "Done." } }] }));
      res.write(
        sseChunk({
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 80, completion_tokens: 4 },
        }),
      );
    }
    res.write("data: [DONE]\n\n");
    res.end();
  };

  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "test-model-a", max_model_len: 16384 }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        });
        writeSseRound(res, body);
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
  return { server, baseUrl: `http://127.0.0.1:${port}` };
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

  test("streaming usage emits usage_updated events with contextWindowUsedTokens", async () => {
    const endpoint = await startEndpoint({ v1ContextLength: 16384 });
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });

    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    await session.run("Say hello");

    const usageEvents = events.filter((event) => event.type === "usage_updated");
    expect(usageEvents.length).toBeGreaterThan(0);

    // The usage_updated event carries contextWindowUsedTokens computed from
    // inputTokens + outputTokens reported by the server in the final chunk.
    const firstUsage = usageEvents[0]?.usage;
    expect(firstUsage?.contextWindowUsedTokens).toBe(10); // 7 prompt + 3 completion
    expect(firstUsage?.inputTokens).toBe(7);
    expect(firstUsage?.outputTokens).toBe(3);
  });

  test("multiple model rounds emit incremental usage_updated events", async () => {
    const args = JSON.stringify({ path: "note.txt", content: "hello tools" });
    const endpoint = await startToolRoundUsageEndpoint(args);

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

    await session.run("Create note.txt");

    const usageEvents = events.filter((event) => event.type === "usage_updated");
    // Two model rounds → two usage_updated events
    expect(usageEvents.length).toBe(2);

    // Round 1: 50 prompt + 10 completion = 60 used tokens
    expect(usageEvents[0]?.usage.contextWindowUsedTokens).toBe(60);
    // Round 2: 80 prompt + 4 completion = 84 used tokens (incremental for that round)
    expect(usageEvents[1]?.usage.contextWindowUsedTokens).toBe(84);

    await session.close();
  });

  test("usage_updated includes contextWindowMaxTokens when resolved", async () => {
    const endpoint = await startEndpoint({ v1ContextLength: 32768 });
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });

    // First turn: context window is resolved during buildTurnUsage (after
    // streaming completes), so the streaming usage_updated event fires
    // before resolution and may not include contextWindowMaxTokens.
    await session.run("Say hello");

    // Second turn: context window is now cached, so the streaming
    // usage_updated event includes it.
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    await session.run("Say hello again");

    const usageEvents = events.filter((event) => event.type === "usage_updated");
    expect(usageEvents.length).toBeGreaterThan(0);
    for (const usageEvent of usageEvents) {
      expect(usageEvent.type).toBe("usage_updated");
      expect(usageEvent.usage.contextWindowMaxTokens).toBe(32768);
    }
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
    expect(toolNames).toEqual(["read_file", "list_dir", "grep_search", "web_search", "web_fetch"]);
  });

  test("disabling the web tool group hides web_search and web_fetch", async () => {
    const endpoint = await startToolEndpoint();
    // Enable every group except "web".
    const groups = OTTO_TOOL_GROUPS.filter((group) => group !== "web");
    const client = new OpenAICompatAgentClient({
      providerId: "lmstudio",
      label: "LM Studio",
      env: { OPENAI_BASE_URL: endpoint.baseUrl },
      ottoToolGroups: groups,
    });
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
    // Plan mode already limits to read tools; disabling the web group drops
    // web_search/web_fetch, leaving the three core read builtins.
    expect(toolNames).toEqual(["read_file", "list_dir", "grep_search"]);

    await session.close();
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
    expect(names).toEqual(["read_file", "list_dir", "grep_search", "web_search", "web_fetch"]);

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
        name: "compact",
        description: "Compress the conversation history to free up context space",
        argumentHint: "[instruction]",
        kind: "command",
      },
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

describe("OpenAICompatAgentSession Otto tool permission gating", () => {
  function fakeOttoCatalog(executedNames: string[]) {
    const handler = async () => ({
      content: [{ type: "text" as const, text: "otto-tool-done" }],
    });
    const tools = new Map(
      ["browser_snapshot", "browser_click", "create_terminal"].map((name) => [
        name,
        { name, description: `${name} test tool`, handler },
      ]),
    );
    return {
      tools,
      getTool: (name: string) => tools.get(name),
      executeTool: async (name: string) => {
        executedNames.push(name);
        return handler();
      },
    };
  }

  async function runOttoGatingScenario(options: {
    toolName: string;
    modeId: string;
    respond?: "allow" | "deny";
  }): Promise<{ permissionRequests: string[]; executed: string[]; toolResult: unknown }> {
    const endpoint = await startMcpDrivingEndpoint(options.toolName, "{}");
    const client = createClient(endpoint.baseUrl);
    const executed: string[] = [];
    const session = await client.createSession(
      {
        provider: "lmstudio",
        cwd: process.cwd(),
        model: "test-model-a",
        modeId: options.modeId,
      },
      { ottoTools: fakeOttoCatalog(executed) },
    );
    const permissionRequests: string[] = [];
    session.subscribe((event) => {
      if (event.type === "permission_requested") {
        permissionRequests.push(event.request.name);
        void session.respondToPermission(event.request.id, {
          behavior: options.respond ?? "allow",
        });
      }
    });

    await session.run("Go");
    const toolMessage = endpoint.requests[1]!.messages.find((message) => message.role === "tool");
    await session.close();
    return { permissionRequests, executed, toolResult: toolMessage?.content };
  }

  test("read-only Otto tools run without a prompt in default mode", async () => {
    const outcome = await runOttoGatingScenario({
      toolName: "browser_snapshot",
      modeId: "default",
    });
    expect(outcome.permissionRequests).toEqual([]);
    expect(outcome.executed).toEqual(["browser_snapshot"]);
  });

  test("interact-class Otto tools prompt in default mode", async () => {
    const outcome = await runOttoGatingScenario({
      toolName: "browser_click",
      modeId: "default",
    });
    expect(outcome.permissionRequests).toEqual(["browser_click"]);
    expect(outcome.executed).toEqual(["browser_click"]);
  });

  test("interact-class Otto tools auto-approve in acceptEdits", async () => {
    const outcome = await runOttoGatingScenario({
      toolName: "browser_click",
      modeId: "acceptEdits",
    });
    expect(outcome.permissionRequests).toEqual([]);
    expect(outcome.executed).toEqual(["browser_click"]);
  });

  test("execute-class Otto tools prompt even in acceptEdits", async () => {
    const outcome = await runOttoGatingScenario({
      toolName: "create_terminal",
      modeId: "acceptEdits",
    });
    expect(outcome.permissionRequests).toEqual(["create_terminal"]);
    expect(outcome.executed).toEqual(["create_terminal"]);
  });

  test("denied Otto tool is not executed and the model is told", async () => {
    const outcome = await runOttoGatingScenario({
      toolName: "create_terminal",
      modeId: "default",
      respond: "deny",
    });
    expect(outcome.permissionRequests).toEqual(["create_terminal"]);
    expect(outcome.executed).toEqual([]);
    expect(outcome.toolResult).toContain("declined");
  });

  test("bypassPermissions auto-approves execute-class Otto tools", async () => {
    const outcome = await runOttoGatingScenario({
      toolName: "create_terminal",
      modeId: "bypassPermissions",
    });
    expect(outcome.permissionRequests).toEqual([]);
    expect(outcome.executed).toEqual(["create_terminal"]);
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

  test("web_fetch rejects a non-http protocol without touching the network", async () => {
    const cwd = await makeTempCwd();
    const outcome = await executeCompatTool({
      name: "web_fetch",
      arguments: { url: "file:///etc/passwd" },
      cwd,
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.output).toContain("http://");
  });

  test("web_fetch blocks SSRF targets (localhost, metadata, private ranges)", async () => {
    const cwd = await makeTempCwd();
    const blocked = [
      "http://localhost:6868/",
      "http://127.0.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.5/",
      "http://192.168.1.1/",
      "http://metadata.google.internal/",
    ];
    for (const url of blocked) {
      const outcome = await executeCompatTool({
        name: "web_fetch",
        arguments: { url },
        cwd,
      });
      expect(outcome.isError, `expected ${url} to be blocked`).toBe(true);
      expect(outcome.output).toContain("web_fetch failed");
    }
  });

  test("web_fetch reports a friendly error for a malformed URL", async () => {
    const cwd = await makeTempCwd();
    const outcome = await executeCompatTool({
      name: "web_fetch",
      arguments: { url: "not a url" },
      cwd,
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.output).toContain("Invalid URL");
  });
});

/**
 * OpenAI endpoint that supports non-streaming responses — needed for
 * compaction tests since handleCompact sends a non-streaming request.
 */
async function startCompactEndpoint(options?: {
  summary?: string;
  fail?: boolean;
}): Promise<TestEndpoint & { compactRequests: Array<Record<string, unknown>> }> {
  const compactRequests: Array<Record<string, unknown>> = [];
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
        const request = JSON.parse(body) as Record<string, unknown>;
        compactRequests.push(request);

        // Detect whether this is a streaming or non-streaming request
        const isStreaming = request.stream === true;

        if (isStreaming) {
          // Normal streaming response for regular turns
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
          });
          res.write(sseChunk({ choices: [{ delta: { content: "OK" } }] }));
          res.write(
            sseChunk({
              choices: [{ delta: {}, finish_reason: "stop" }],
              usage: { prompt_tokens: 5, completion_tokens: 2 },
            }),
          );
          res.write("data: [DONE]\n\n");
          res.end();
        } else {
          // Non-streaming response for compaction
          if (options?.fail) {
            res.writeHead(500);
            res.end("Internal server error");
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          const summary = options?.summary ?? "This is a summary of the conversation.";
          res.end(
            JSON.stringify({
              choices: [{ message: { role: "assistant", content: summary } }],
              usage: { prompt_tokens: 100, completion_tokens: 50 },
            }),
          );
        }
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
  return { server, baseUrl: `http://127.0.0.1:${port}`, compactRequests };
}

describe("OpenAICompatAgentSession /compact", () => {
  test("lists /compact in listCommands even without MCP servers", async () => {
    const endpoint = await startEndpoint();
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });

    const commands = await session.listCommands?.();
    expect(commands).toBeDefined();
    expect(commands).toContainEqual(
      expect.objectContaining({
        name: "compact",
        description: "Compress the conversation history to free up context space",
        kind: "command",
      }),
    );

    await session.close();
  });

  test("compacts the conversation and emits compaction timeline events", async () => {
    const endpoint = await startCompactEndpoint({ summary: "Summary of conversation so far." });
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });

    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    // Build up some conversation history
    await session.run("First message");
    await session.run("Second message");

    // Now compact
    const result = await session.run("/compact");

    expect(result.canceled).toBe(false);

    // turn_completed is the manager's terminal signal — without it the
    // foreground turn stream never settles and the agent stays "running".
    const turnCompletedEvents = events.filter((event) => event.type === "turn_completed");
    expect(turnCompletedEvents.length).toBe(3); // two normal turns + the compact turn

    // Check compaction timeline events
    const compactionEvents = events.filter(
      (event) => event.type === "timeline" && event.item.type === "compaction",
    );
    expect(compactionEvents.length).toBeGreaterThanOrEqual(2);

    const loadingEvent = compactionEvents.find(
      (event) =>
        event.type === "timeline" &&
        event.item.type === "compaction" &&
        event.item.status === "loading",
    );
    expect(loadingEvent).toBeDefined();
    expect(loadingEvent?.item.trigger).toBe("manual");

    const completedEvent = compactionEvents.find(
      (event) =>
        event.type === "timeline" &&
        event.item.type === "compaction" &&
        event.item.status === "completed",
    );
    expect(completedEvent).toBeDefined();
    expect(completedEvent?.item.preTokens).toBeDefined();
    expect(completedEvent?.item.postTokens).toBeDefined();
    expect(typeof completedEvent?.item.preTokens).toBe("number");
    expect(typeof completedEvent?.item.postTokens).toBe("number");

    // Verify message history was replaced
    const persistence = session.describePersistence();
    const messages = persistence?.metadata?.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.role).toBe("system");
    // After compaction: system + summary user message + acknowledgment assistant message
    expect(messages.length).toBeLessThanOrEqual(3);
    const lastMessage = messages[messages.length - 1];
    expect(lastMessage?.content).toBe("Conversation history has been compacted.");

    // Verify the compaction request was sent
    expect(endpoint.compactRequests.length).toBeGreaterThan(0);
    const compactRequest = endpoint.compactRequests[endpoint.compactRequests.length - 1];
    expect(compactRequest.stream).toBeUndefined(); // non-streaming
    const reqMessages = compactRequest.messages as Array<{ role: string; content: string }>;
    expect(reqMessages[0]?.role).toBe("system");
    expect(reqMessages[0]?.content).toContain("summarize");

    await session.close();
  });

  test("/compact with instruction includes it in the compaction prompt", async () => {
    const endpoint = await startCompactEndpoint({
      summary: "Focused summary.",
    });
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });

    await session.run("Do something");
    await session.run("/compact focus on the bugs");

    // Check the compaction system prompt includes the instruction
    expect(endpoint.compactRequests.length).toBeGreaterThan(0);
    const compactRequest = endpoint.compactRequests[endpoint.compactRequests.length - 1];
    const reqMessages = compactRequest.messages as Array<{ role: string; content: string }>;
    const systemContent = reqMessages[0]?.content as string;
    expect(systemContent).toContain("focus on the bugs");

    await session.close();
  });

  test("/compact fails gracefully when the endpoint errors", async () => {
    const endpoint = await startCompactEndpoint({ fail: true });
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });

    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    // Build some history first
    await session.run("First message");
    const messageCountBefore = session.describePersistence()?.metadata?.messages?.length;

    // Compact should fail
    await expect(session.run("/compact")).rejects.toThrow(/responded 500/);

    // Verify turn_failed was emitted
    expect(events.some((event) => event.type === "turn_failed")).toBe(true);

    // Verify message history was NOT modified (still has the original messages)
    const messageCountAfter = session.describePersistence()?.metadata?.messages?.length;
    expect(messageCountAfter).toBe(messageCountBefore);

    await session.close();
  });

  test("/compact works on a short conversation", async () => {
    const endpoint = await startCompactEndpoint({
      summary: "Very short conversation summarized.",
    });
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });

    // Compact immediately with minimal history
    const result = await session.run("/compact");

    expect(result.canceled).toBe(false);

    const persistence = session.describePersistence();
    const messages = persistence?.metadata?.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.role).toBe("system");
    expect(messages.length).toBeLessThanOrEqual(3);

    await session.close();
  });

  test("/compact emits usage_updated event", async () => {
    const endpoint = await startCompactEndpoint({
      summary: "Summary.",
    });
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });

    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    await session.run("/compact");

    const usageEvents = events.filter((event) => event.type === "usage_updated");
    expect(usageEvents.length).toBeGreaterThan(0);
    const usage = usageEvents[0]?.usage;
    expect(usage).toBeDefined();
    expect(usage?.inputTokens).toBe(100);
    expect(usage?.outputTokens).toBe(50);
    // The compaction usage must report the post-compaction context size, not
    // the compaction request's own prompt size — the client's context ring
    // renders whatever usage_updated last delivered.
    expect(typeof usage?.contextWindowUsedTokens).toBe("number");
    expect(usage?.contextWindowUsedTokens).toBeGreaterThan(0);

    await session.close();
  });
});
