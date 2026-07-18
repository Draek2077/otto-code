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
import {
  OpenAICompatAgentClient,
  isUneventfulToolResult,
  normalizeOpenAICompatBaseUrl,
} from "./openai-compat-agent.js";
import { executeCompatTool, parseDdgHtmlResults } from "./openai-compat-tools.js";

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
    // Effort is advertised per model like every other provider, so the
    // standard Effort control drives reasoning_effort.
    expect(catalog.models[0]?.thinkingOptions?.map((option) => option.id)).toEqual([
      "off",
      "low",
      "medium",
      "high",
    ]);
    expect(catalog.models[0]?.defaultThinkingOptionId).toBe("off");
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
      // reasoning persists so a resumed session can replay the thinking block.
      { role: "assistant", content: "Hello from test-model-a", reasoning: "thinking " },
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
      expect.objectContaining({ type: "reasoning", text: "thinking " }),
      expect.objectContaining({ type: "assistant_message", text: "Hello from test-model-a" }),
    ]);

    // The retained reasoning is display-only — it must never be echoed back
    // to the model as request input.
    await resumed.run("Say hello again");
    const lastRequest = endpoint.completionBodies[endpoint.completionBodies.length - 1] as {
      messages: Array<Record<string, unknown>>;
    };
    for (const message of lastRequest.messages) {
      expect(message).not.toHaveProperty("reasoning");
    }
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

/**
 * Fake server whose first completion round streams TWO write_file tool calls
 * in one assistant message and whose later rounds stream plain text — used to
 * verify the conversation stays wire-valid when a multi-call round is
 * interrupted partway.
 */
async function startTwoToolCallEndpoint(): Promise<TestEndpoint & { requests: RecordedRequest[] }> {
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
                        id: "call_a",
                        function: {
                          name: "write_file",
                          arguments: JSON.stringify({ path: "a.txt", content: "A" }),
                        },
                      },
                      {
                        index: 1,
                        id: "call_b",
                        function: {
                          name: "write_file",
                          arguments: JSON.stringify({ path: "b.txt", content: "B" }),
                        },
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

describe("OpenAICompatAgentSession reasoning effort", () => {
  test("omits reasoning_effort by default and sends it after setThinkingOption", async () => {
    const endpoint = await startEndpoint();
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });

    await session.run("Say hello");
    expect(endpoint.completionBodies[0]).not.toHaveProperty("reasoning_effort");
    // Effort lives on the model-level thinking option now, not in features.
    expect(session.features).toEqual([
      expect.objectContaining({ id: "auto_compact", value: "80" }),
    ]);

    await session.setThinkingOption?.("high");
    await session.run("Say hello again");
    expect(endpoint.completionBodies[1]?.reasoning_effort).toBe("high");
  });

  test("clears back to off when the thinking option is set to null", async () => {
    const endpoint = await startEndpoint();
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
      thinkingOptionId: "medium",
    });

    await session.run("Say hello");
    expect(endpoint.completionBodies[0]?.reasoning_effort).toBe("medium");

    await session.setThinkingOption?.(null);
    await session.run("Say hello again");
    expect(endpoint.completionBodies[1]).not.toHaveProperty("reasoning_effort");
  });

  test("seeds the effort from config.thinkingOptionId over legacy featureValues", async () => {
    const endpoint = await startEndpoint();
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
      thinkingOptionId: "high",
      featureValues: { reasoning_effort: "low" },
    });

    await session.run("Say hello");
    expect(endpoint.completionBodies[0]?.reasoning_effort).toBe("high");
  });

  // COMPAT(openaiCompatReasoningFeature): agents created before the effort
  // unification persisted the value as featureValues.reasoning_effort.
  test("restores reasoning effort from legacy featureValues", async () => {
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

  // COMPAT(openaiCompatReasoningFeature): old clients may still send the
  // reasoning_effort feature select even though it is no longer advertised.
  test("still accepts the legacy reasoning_effort feature update", async () => {
    const endpoint = await startEndpoint();
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });

    await session.setFeature?.("reasoning_effort", "high");
    await session.run("Say hello");
    expect(endpoint.completionBodies[0]?.reasoning_effort).toBe("high");
  });

  test("rejects unknown features and invalid values", async () => {
    const endpoint = await startEndpoint();
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });

    await expect(session.setThinkingOption?.("extreme")).rejects.toThrow(/Invalid effort/);
    await expect(session.setFeature?.("reasoning_effort", "extreme")).rejects.toThrow(
      /Invalid reasoning effort/,
    );
    await expect(session.setFeature?.("unknown_feature", true)).rejects.toThrow(/Unknown feature/);
  });

  test("listFeatures no longer advertises a reasoning select", async () => {
    const endpoint = await startEndpoint();
    const client = createClient(endpoint.baseUrl);

    await expect(
      client.listFeatures({ provider: "lmstudio", cwd: process.cwd() }),
    ).resolves.toEqual([expect.objectContaining({ id: "auto_compact", value: "80" })]);
  });
});

describe("OpenAICompatAgentSession image attachments", () => {
  function userContent(body: Record<string, unknown> | undefined): unknown {
    const messages = (body as { messages?: Array<{ role: string; content: unknown }> })?.messages;
    return messages?.find((message) => message.role === "user")?.content;
  }

  test("forwards an attached image as an OpenAI vision content part", async () => {
    const endpoint = await startEndpoint();
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });

    await session.run([
      { type: "text", text: "What is in this image?" },
      { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
    ]);

    expect(userContent(endpoint.completionBodies[0])).toEqual([
      { type: "text", text: "What is in this image?" },
      { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
    ]);
  });

  test("sends an image-only prompt without a blank text part", async () => {
    const endpoint = await startEndpoint();
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });

    await session.run([{ type: "image", data: "aW1n", mimeType: "image/jpeg" }]);

    expect(userContent(endpoint.completionBodies[0])).toEqual([
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,aW1n" } },
    ]);
  });

  test("keeps a text-only prompt as a plain string", async () => {
    const endpoint = await startEndpoint();
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });

    await session.run("Just text");

    expect(userContent(endpoint.completionBodies[0])).toBe("Just text");
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

  test("streamHistory coalesces streamed deltas instead of retaining every event", async () => {
    const endpoint = await startEndpoint();
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });
    await session.run("First question");

    const replayed: string[] = [];
    for await (const event of session.streamHistory()) {
      expect(event.type).toBe("timeline");
      if (event.type === "timeline") {
        const item = event.item;
        if (
          item.type === "user_message" ||
          item.type === "assistant_message" ||
          item.type === "reasoning"
        ) {
          replayed.push(`${item.type}:${item.text}`);
        } else {
          replayed.push(item.type);
        }
      }
    }
    // One whole message each — not one event per streamed chunk, and no
    // usage/turn bookkeeping events retained.
    expect(replayed).toEqual([
      "user_message:First question",
      "reasoning:thinking ",
      "assistant_message:Hello from test-model-a",
    ]);
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

  test("resumed sessions replay tool calls, not just user/assistant text", async () => {
    const endpoint = await startToolEndpoint();
    const client = createClient(endpoint.baseUrl);
    const cwd = await makeTempCwd();
    const session = await client.createSession({
      provider: "lmstudio",
      cwd,
      model: "test-model-a",
      modeId: "bypassPermissions",
    });

    await session.run("Create note.txt");
    const handle = session.describePersistence();
    expect(handle).not.toBeNull();

    const resumed = await client.resumeSession(handle!);
    const replayed: AgentStreamEvent[] = [];
    for await (const event of resumed.streamHistory()) {
      replayed.push(event);
    }
    const items = replayed.flatMap((event) => (event.type === "timeline" ? [event.item] : []));

    const toolItem = items.find((item) => item.type === "tool_call");
    expect(toolItem).toEqual(
      expect.objectContaining({ type: "tool_call", name: "write_file", status: "completed" }),
    );
    expect(
      toolItem?.type === "tool_call" && toolItem.detail.type === "write" && toolItem.detail.content,
    ).toBe("hello tools");
    // Round 1 streamed only the tool call (no assistant text); round 2 streamed
    // the final "File created." text after the tool result went back.
    expect(items.map((item) => item.type)).toEqual([
      "user_message",
      "tool_call",
      "assistant_message",
    ]);
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

  // The read tools never prompt, so an unprompted web_fetch would let a
  // prompt-injected model exfiltrate anything on disk via a GET query string.
  test.each(["default", "acceptEdits", "plan"] as const)(
    "web_fetch asks permission in %s mode",
    async (modeId) => {
      const endpoint = await startMcpDrivingEndpoint(
        "web_fetch",
        JSON.stringify({ url: "https://example.com/" }),
      );
      const client = createClient(endpoint.baseUrl);
      const session = await client.createSession({
        provider: "lmstudio",
        cwd: await makeTempCwd(),
        model: "test-model-a",
        modeId,
      });
      const permissionRequests: string[] = [];
      session.subscribe((event) => {
        if (event.type === "permission_requested") {
          permissionRequests.push(event.request.name);
          void session.respondToPermission(event.request.id, { behavior: "deny" });
        }
      });

      await session.run("Fetch the page");

      expect(permissionRequests).toEqual(["web_fetch"]);
      const toolMessage = endpoint.requests[1]!.messages.find((message) => message.role === "tool");
      expect(String(toolMessage?.content)).toContain("declined");
      await session.close();
    },
  );

  test("acceptEdits auto-approves edits inside the workspace", async () => {
    const endpoint = await startToolEndpoint();
    const client = createClient(endpoint.baseUrl);
    const cwd = await makeTempCwd();
    const session = await client.createSession({
      provider: "lmstudio",
      cwd,
      model: "test-model-a",
      modeId: "acceptEdits",
    });
    const permissionRequests: string[] = [];
    session.subscribe((event) => {
      if (event.type === "permission_requested") {
        permissionRequests.push(event.request.name);
        void session.respondToPermission(event.request.id, { behavior: "allow" });
      }
    });

    await session.run("Create note.txt");

    expect(permissionRequests).toEqual([]);
    await expect(fs.readFile(path.join(cwd, "note.txt"), "utf8")).resolves.toBe("hello tools");
    await session.close();
  });

  test("acceptEdits still prompts for edits outside the workspace", async () => {
    const outsideDir = await makeTempCwd();
    const outsidePath = path.join(outsideDir, "escape.txt");
    const endpoint = await startMcpDrivingEndpoint(
      "write_file",
      JSON.stringify({ path: outsidePath, content: "outside" }),
    );
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: await makeTempCwd(),
      model: "test-model-a",
      modeId: "acceptEdits",
    });
    const permissionRequests: string[] = [];
    session.subscribe((event) => {
      if (event.type === "permission_requested") {
        permissionRequests.push(event.request.name);
        void session.respondToPermission(event.request.id, { behavior: "deny" });
      }
    });

    await session.run("Write the file");

    expect(permissionRequests).toEqual(["write_file"]);
    await expect(fs.access(outsidePath)).rejects.toThrow();
    await session.close();
  });

  test("interrupting a multi-call round leaves no dangling tool_calls", async () => {
    const endpoint = await startTwoToolCallEndpoint();
    const client = createClient(endpoint.baseUrl);
    const cwd = await makeTempCwd();
    const session = await client.createSession({
      provider: "lmstudio",
      cwd,
      model: "test-model-a",
      modeId: "default",
    });
    session.subscribe((event) => {
      if (event.type === "permission_requested") {
        // Deny-and-interrupt on the first call so the second never runs.
        void session.respondToPermission(event.request.id, {
          behavior: "deny",
          interrupt: true,
        });
      }
    });

    const result = await session.run("Create both files");
    expect(result.canceled).toBe(true);

    // The next turn must send a wire-valid conversation: every id in the
    // assistant tool_calls has a tool result (strict servers 400 otherwise).
    await session.run("Continue");
    const followUp = endpoint.requests.at(-1)!;
    const callsMessage = followUp.messages.find(
      (message) => message.role === "assistant" && Array.isArray(message.tool_calls),
    );
    const rawCalls = (callsMessage?.tool_calls ?? []) as Array<{ id: string }>;
    const assistantCalls = rawCalls.map((call) => call.id);
    const answered = new Set(
      followUp.messages.flatMap((message) =>
        message.role === "tool" ? [message.tool_call_id] : [],
      ),
    );
    expect(assistantCalls).toEqual(["call_a", "call_b"]);
    for (const id of assistantCalls) {
      expect(answered.has(id), `expected a tool result for ${id}`).toBe(true);
    }
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

  test("edit_file writes $-patterns in the replacement literally", async () => {
    const cwd = await makeTempCwd();
    const filePath = path.join(cwd, "script.txt");
    await fs.writeFile(filePath, "hello world\n", "utf8");

    // String.replace would expand these into surrounding file content.
    const newString = "$& $' $` $$";
    const outcome = await executeCompatTool({
      name: "edit_file",
      arguments: { path: "script.txt", old_string: "world", new_string: newString },
      cwd,
    });
    expect(outcome.isError).toBeUndefined();
    await expect(fs.readFile(filePath, "utf8")).resolves.toBe(`hello ${newString}\n`);
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
      // IPv6 literals, including IPv4-mapped loopback (the URL parser
      // normalizes the dotted form to hex: [::ffff:7f00:1]).
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[fd00::1]/",
      // Additional IPv4 ranges: "this host", benchmarking, multicast, reserved.
      "http://0.0.0.0/",
      "http://198.18.0.5/",
      "http://224.0.0.1/",
      "http://255.255.255.255/",
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

  test("DDG result parsing unwraps uddg redirects and keeps query params", () => {
    // Current DDG markup: div containers, class before href on the anchor.
    const html = [
      '<div class="result results_links results_links_deep web-result ">',
      '<div class="links_main links_deep result__body">',
      '<h2 class="result__title">',
      '<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs%3Fpage%3D2%26lang%3Den&amp;rut=abc">Example &amp; Friends</a>',
      "</h2>",
      '<a class="result__snippet" href="#">A <b>bold</b> snippet</a>',
      "</div></div>",
    ].join("");

    const results = parseDdgHtmlResults(html);
    expect(results).toHaveLength(1);
    expect(results[0]!.url).toBe("https://example.com/docs?page=2&lang=en");
    expect(results[0]!.title).toBe("Example & Friends");
    expect(results[0]!.snippet).toBe("A bold snippet");
  });

  test("DDG result parsing tolerates the legacy li-based markup", () => {
    const html = [
      '<li class="result">',
      '<h2 class="result__title"><a href="https://example.org/page?x=1" class="result__a">Legacy Result</a></h2>',
      '<a class="result__snippet" href="#">Old snippet</a>',
      "</li>",
    ].join("");

    const results = parseDdgHtmlResults(html);
    expect(results).toHaveLength(1);
    expect(results[0]!.url).toBe("https://example.org/page?x=1");
    expect(results[0]!.title).toBe("Legacy Result");
    expect(results[0]!.snippet).toBe("Old snippet");
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

/**
 * Find the compaction's structured-summary request by a marker unique to its
 * system prompt (there may be other non-streaming requests in the log).
 */
function findFullSummaryRequest(
  requests: Array<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  return requests.find((request) => {
    const messages = request.messages as Array<{ role: string; content: string }> | undefined;
    const system = messages?.[0]?.content ?? "";
    return system.includes("structured handoff summary");
  });
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

    // Verify the compaction request was sent. Compaction fires two concurrent
    // non-streaming requests (full structured summary + short PR-style summary);
    // find the full one by its system prompt.
    expect(endpoint.compactRequests.length).toBeGreaterThan(0);
    const compactRequest = findFullSummaryRequest(endpoint.compactRequests);
    expect(compactRequest).toBeDefined();
    expect(compactRequest?.stream).toBeUndefined(); // non-streaming
    const reqMessages = compactRequest?.messages as Array<{ role: string; content: string }>;
    expect(reqMessages[0]?.role).toBe("system");
    expect(reqMessages[0]?.content).toContain("structured handoff summary");

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
    const compactRequest = findFullSummaryRequest(endpoint.compactRequests);
    expect(compactRequest).toBeDefined();
    const reqMessages = compactRequest?.messages as Array<{ role: string; content: string }>;
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

    // The loading compaction row settles as failed instead of spinning forever.
    const compactionStatuses = events.flatMap((event) =>
      event.type === "timeline" && event.item.type === "compaction" ? [event.item.status] : [],
    );
    expect(compactionStatuses).toEqual(["loading", "failed"]);

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

    // Needs history to summarize; an empty conversation compacts to a no-op.
    await session.run("First message");

    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    await session.run("/compact");

    const usageEvents = events.filter((event) => event.type === "usage_updated");
    expect(usageEvents.length).toBeGreaterThan(0);
    const usage = usageEvents[usageEvents.length - 1]?.usage;
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

  test("keeps recent history verbatim and summarizes only the older region", async () => {
    const endpoint = await startCompactEndpoint({ summary: "SUMMARY_OF_OLD_HISTORY" });
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });

    // Build a conversation large enough to exceed the keep-recent budget so
    // there is genuinely an "old" region to summarize and a "recent" region to
    // preserve. Each message carries a unique marker + heavy filler.
    const filler = "x".repeat(25_000);
    for (let index = 1; index <= 5; index += 1) {
      await session.run(`MARKER_${index} ${filler}`);
    }

    await session.run("/compact");

    const persistence = session.describePersistence();
    const messages = persistence?.metadata?.messages as Array<{ role: string; content: string }>;
    const joined = messages.map((message) => message.content).join("\n");

    // The newest message stays verbatim; the oldest is folded into the summary.
    expect(joined).toContain("MARKER_5");
    expect(joined).not.toContain("MARKER_1");
    // The summary of the old region is present as a compaction summary message.
    expect(joined).toContain("SUMMARY_OF_OLD_HISTORY");

    await session.close();
  });

  test("re-compaction merges into the prior summary instead of re-summarizing it", async () => {
    const endpoint = await startCompactEndpoint({ summary: "MERGED_SUMMARY" });
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });

    await session.run("First message");
    await session.run("/compact");
    await session.run("Second message");
    await session.run("/compact");

    // The second compaction must use the incremental-update prompt and feed the
    // prior summary back in <previous-summary> tags.
    const updateRequest = endpoint.compactRequests.find((request) => {
      const messages = request.messages as Array<{ role: string; content: string }> | undefined;
      const system = messages?.[0]?.content ?? "";
      return system.includes("update an existing structured handoff summary");
    });
    expect(updateRequest).toBeDefined();
    const updateMessages = updateRequest?.messages as Array<{ role: string; content: string }>;
    expect(updateMessages[1]?.content).toContain("<previous-summary>");
    expect(updateMessages[1]?.content).toContain("MERGED_SUMMARY");

    await session.close();
  });
});

/**
 * Endpoint for auto-compaction tests: reports a context window on the models
 * listing, streams a fixed usage figure on every chat round, and serves
 * non-streaming compaction requests like startCompactEndpoint.
 */
async function startAutoCompactEndpoint(options: {
  contextLength: number;
  promptTokens: number;
  summary?: string;
  failCompaction?: boolean;
}): Promise<TestEndpoint & { compactRequests: Array<Record<string, unknown>> }> {
  const compactRequests: Array<Record<string, unknown>> = [];
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          data: [{ id: "test-model-a", max_model_len: options.contextLength }],
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
        const request = JSON.parse(body) as Record<string, unknown>;
        if (request.stream === true) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
          });
          res.write(sseChunk({ choices: [{ delta: { content: "OK" } }] }));
          res.write(
            sseChunk({
              choices: [{ delta: {}, finish_reason: "stop" }],
              usage: { prompt_tokens: options.promptTokens, completion_tokens: 2 },
            }),
          );
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }
        compactRequests.push(request);
        if (options.failCompaction) {
          res.writeHead(500);
          res.end("Internal server error");
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: options.summary ?? "Summary of the old history.",
                },
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 50 },
          }),
        );
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

function compactionTimelineEvents(
  events: AgentStreamEvent[],
): Array<{ status: string; trigger?: string }> {
  return events.flatMap((event) =>
    event.type === "timeline" && event.item.type === "compaction"
      ? [{ status: event.item.status, trigger: event.item.trigger }]
      : [],
  );
}

function errorTimelineMessages(events: AgentStreamEvent[]): string[] {
  return events.flatMap((event) =>
    event.type === "timeline" && event.item.type === "error" ? [event.item.message] : [],
  );
}

describe("OpenAICompatAgentSession auto-compaction", () => {
  test("compacts automatically when context usage crosses the threshold", async () => {
    const endpoint = await startAutoCompactEndpoint({
      contextLength: 100_000,
      promptTokens: 90_000, // 90% — above the default 80% threshold
    });
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    // First turn establishes the server-measured context size (90k of 100k).
    await session.run("First message");
    expect(endpoint.compactRequests.length).toBe(0);

    // The next turn's first round sees usage above the threshold and compacts
    // before calling the model; the turn itself still completes normally.
    const result = await session.run("Second message");
    expect(result.canceled).toBe(false);
    expect(result.finalText).toContain("OK");
    expect(endpoint.compactRequests.length).toBeGreaterThan(0);

    const compactions = compactionTimelineEvents(events);
    expect(compactions).toContainEqual({ status: "loading", trigger: "auto" });
    expect(compactions).toContainEqual(
      expect.objectContaining({ status: "completed", trigger: "auto" }),
    );

    // The conversation was rebuilt around the summary; the new user message
    // survived verbatim in the retained tail.
    const persistence = session.describePersistence();
    const messages = persistence?.metadata?.messages as Array<{ role: string; content: string }>;
    const joined = messages.map((message) => message.content).join("\n");
    expect(joined).toContain("Summary of the old history.");
    expect(joined).toContain("Second message");

    await session.close();
  });

  test("auto_compact 'off' disables the trigger", async () => {
    const endpoint = await startAutoCompactEndpoint({
      contextLength: 100_000,
      promptTokens: 90_000,
    });
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
      featureValues: { auto_compact: "off" },
    });

    await session.run("First message");
    await session.run("Second message");
    expect(endpoint.compactRequests.length).toBe(0);

    await session.close();
  });

  test("stays idle while usage is below the threshold", async () => {
    const endpoint = await startAutoCompactEndpoint({
      contextLength: 100_000,
      promptTokens: 50_000, // 50% — below the default 80% threshold
    });
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });

    await session.run("First message");
    await session.run("Second message");
    expect(endpoint.compactRequests.length).toBe(0);

    await session.close();
  });

  test("provider-level compaction config sets the default threshold", async () => {
    const endpoint = await startAutoCompactEndpoint({
      contextLength: 100_000,
      promptTokens: 60_000, // 60% — above a 50% threshold, below the stock 80%
    });
    const client = new OpenAICompatAgentClient({
      providerId: "lmstudio",
      label: "LM Studio",
      env: { OPENAI_BASE_URL: endpoint.baseUrl },
      compaction: { thresholdPercent: 50 },
    });
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });

    await session.run("First message");
    await session.run("Second message");
    expect(endpoint.compactRequests.length).toBeGreaterThan(0);

    await session.close();
  });

  test("provider-level autoCompact:false defaults the feature to off", async () => {
    const endpoint = await startAutoCompactEndpoint({
      contextLength: 100_000,
      promptTokens: 90_000,
    });
    const client = new OpenAICompatAgentClient({
      providerId: "lmstudio",
      label: "LM Studio",
      env: { OPENAI_BASE_URL: endpoint.baseUrl },
      compaction: { autoCompact: false },
    });
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });

    expect(session.features).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "auto_compact", value: "off" })]),
    );
    await session.run("First message");
    await session.run("Second message");
    expect(endpoint.compactRequests.length).toBe(0);

    await session.close();
  });

  test("compaction.hideSelector hides the feature and ignores per-agent values", async () => {
    const endpoint = await startAutoCompactEndpoint({
      contextLength: 100_000,
      promptTokens: 60_000, // 60% — above the provider default 50% threshold
    });
    const client = new OpenAICompatAgentClient({
      providerId: "lmstudio",
      label: "LM Studio",
      env: { OPENAI_BASE_URL: endpoint.baseUrl },
      compaction: { thresholdPercent: 50, hideSelector: true },
    });
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
      // Persisted per-agent value from before the selector was hidden: it must
      // not override the provider default while the selector stays hidden.
      featureValues: { auto_compact: "off" },
    });

    expect(session.features).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "auto_compact" })]),
    );
    await expect(
      client.listFeatures({
        provider: "lmstudio",
        cwd: process.cwd(),
        featureValues: { auto_compact: "off" },
      }),
    ).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "auto_compact" })]),
    );

    await session.run("First message");
    await session.run("Second message");
    expect(endpoint.compactRequests.length).toBeGreaterThan(0);

    await session.close();
  });

  test("applyCompactionConfig re-applies provider settings to a live session", async () => {
    const endpoint = await startAutoCompactEndpoint({
      contextLength: 100_000,
      promptTokens: 60_000, // 60% — below the stock 80%, above the new 50%
    });
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });

    expect(session.features).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "auto_compact", value: "80" })]),
    );

    // Hide the selector and lower the threshold: the select disappears and
    // the new default becomes live — compaction now triggers at 60% usage.
    expect(session.applyCompactionConfig?.({ thresholdPercent: 50, hideSelector: true })).toBe(
      true,
    );
    expect(session.features).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "auto_compact" })]),
    );
    await session.run("First message");
    await session.run("Second message");
    expect(endpoint.compactRequests.length).toBeGreaterThan(0);

    // Unhide: the select returns, seeded with the provider default.
    expect(session.applyCompactionConfig?.({ thresholdPercent: 50 })).toBe(true);
    expect(session.features).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "auto_compact", value: "50" })]),
    );

    // No-op re-apply reports no change.
    expect(session.applyCompactionConfig?.({ thresholdPercent: 50 })).toBe(false);

    await session.close();
  });

  test("pauses after a compaction that cannot get back under the threshold", async () => {
    // Tiny window: the rebuilt conversation (system prompt + tool schemas +
    // a deliberately huge summary) still estimates above the threshold, so
    // the session must disarm instead of compacting again on every round.
    const endpoint = await startAutoCompactEndpoint({
      contextLength: 2_000,
      promptTokens: 1_800, // 90% of the window, above every selectable threshold
      summary: `HUGE_SUMMARY ${"y".repeat(20_000)}`,
    });
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    await session.run("First message");
    await session.run("Second message");
    expect(endpoint.compactRequests.length).toBe(1);
    expect(errorTimelineMessages(events).some((m) => m.includes("Auto-compaction is paused"))).toBe(
      true,
    );

    // Disarmed: usage still reads above the threshold, but no new attempt.
    await session.run("Third message");
    expect(endpoint.compactRequests.length).toBe(1);

    // An explicit setting change re-arms the trigger.
    await session.setFeature?.("auto_compact", "50");
    await session.run("Fourth message");
    expect(endpoint.compactRequests.length).toBe(2);

    await session.close();
  });

  test("a failed auto-compaction pauses the trigger without failing the turn", async () => {
    const endpoint = await startAutoCompactEndpoint({
      contextLength: 100_000,
      promptTokens: 90_000,
      failCompaction: true,
    });
    const client = createClient(endpoint.baseUrl);
    const session = await client.createSession({
      provider: "lmstudio",
      cwd: process.cwd(),
      model: "test-model-a",
    });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    await session.run("First message");
    const result = await session.run("Second message");

    // The compaction attempt failed, but the user's turn still completed.
    expect(result.canceled).toBe(false);
    expect(result.finalText).toContain("OK");
    expect(endpoint.compactRequests.length).toBe(1);
    const compactions = compactionTimelineEvents(events);
    expect(compactions).toContainEqual({ status: "failed", trigger: "auto" });
    expect(errorTimelineMessages(events).some((m) => m.includes("Auto-compaction failed"))).toBe(
      true,
    );

    // Disarmed: no retry on the next turn.
    await session.run("Third message");
    expect(endpoint.compactRequests.length).toBe(1);

    await session.close();
  });
});

describe("isUneventfulToolResult", () => {
  test("flags empty and zero-signal results", () => {
    expect(isUneventfulToolResult("")).toBe(true);
    expect(isUneventfulToolResult("   \n  ")).toBe(true);
    expect(isUneventfulToolResult("No matches found")).toBe(true);
    expect(isUneventfulToolResult("no results found")).toBe(true);
    expect(isUneventfulToolResult("Found 0 matches")).toBe(true);
    expect(isUneventfulToolResult("(no output)")).toBe(true);
  });

  test("keeps results that carry signal", () => {
    expect(isUneventfulToolResult("export const x = 1;")).toBe(false);
    expect(isUneventfulToolResult("Found 3 matches")).toBe(false);
    expect(isUneventfulToolResult("[Uneventful result elided]")).toBe(false);
  });
});
