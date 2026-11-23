import { createServer } from "node:http";
import { once } from "node:events";
import { expect, test } from "vitest";
import type { ProviderEvent, ProviderUsage } from "@getpaseo/plugin/server/provider";
import { streamCompletion } from "./completions.js";
import { OpenAiSession } from "./session.js";
import { providerSettings } from "../shared/settings.js";

async function endpointFixture(mode: "failed" | "canceled" | "completed") {
  const controller = new AbortController();
  const usage = {
    prompt_tokens: 11,
    completion_tokens: 3,
    prompt_tokens_details: { cached_tokens: 4 },
  };
  const server = createServer(async (request, response) => {
    for await (const chunk of request) void chunk;
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({ choices: [], usage })}\n\n`);
    if (mode === "failed")
      response.end(
        `data: ${JSON.stringify({ error: { message: "fixture endpoint failed: synthetic-usage-key" } })}\n\n`,
      );
    else if (mode === "completed")
      response.end(
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Done." }, finish_reason: "stop" }], usage: { ...usage, prompt_tokens: 12, completion_tokens: 4 } })}\n\ndata: [DONE]\n\n`,
      );
    else
      response.write(
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "cancel-now" }, finish_reason: null }] })}\n\n`,
      );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing endpoint");
  return {
    controller,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test.each(["failed", "canceled", "completed"] as const)(
  "endpoint usage is reported once when a stream is %s",
  async (mode) => {
    const fixture = await endpointFixture(mode);
    const usage: ProviderUsage[] = [];
    try {
      const result = streamCompletion({
        baseUrl: fixture.baseUrl,
        apiKey: "synthetic-usage-key",
        model: "fixture",
        tools: [],
        messages: [{ role: "user", content: "Hello" }],
        signal: fixture.controller.signal,
        onUsage: (value) => usage.push(value),
        onText: () => {
          if (mode === "canceled") fixture.controller.abort();
        },
      });
      if (mode === "failed") {
        await expect(result).rejects.toThrow("fixture endpoint failed");
        await expect(result).rejects.not.toThrow("synthetic-usage-key");
      } else if (mode === "canceled")
        await expect(result).rejects.toMatchObject({ name: "AbortError" });
      else
        expect(await result).toMatchObject({
          content: "Done.",
          usage: { inputTokens: 12, outputTokens: 4, cachedInputTokens: 4 },
        });
      expect(usage).toEqual([
        {
          inputTokens: mode === "completed" ? 12 : 11,
          outputTokens: mode === "completed" ? 4 : 3,
          cachedInputTokens: 4,
        },
      ]);
    } finally {
      await fixture.close();
    }
  },
);

test("failed chat and compaction turns retain endpoint usage without counting it twice", async () => {
  const fixture = await endpointFixture("failed");
  const events: ProviderEvent[] = [];
  const session = new OpenAiSession({
    id: "usage",
    config: {
      cwd: process.cwd(),
      env: {},
      mcpServers: {},
      settings: { auto_compact: "off" },
      model: "fixture",
      persist: true,
    },
    settings: providerSettings.schema.parse({ baseUrl: fixture.baseUrl, model: "fixture" }),
    emit: (event) => events.push(event),
    resolveApiKey: async () => "synthetic-usage-key",
    persistence: {
      version: 1,
      data: {
        format: "otto-openai-compatible-v1",
        endpoint: `${fixture.baseUrl}/chat/completions`,
        messages: [
          { role: "user", content: "Earlier context ".repeat(1800) },
          { role: "assistant", content: "Earlier answer" },
          { role: "user", content: "Recent request" },
          { role: "assistant", content: "Recent answer" },
        ],
        timeline: [],
      },
    },
  });
  try {
    for (const [clientMessageId, input] of [
      ["chat", { type: "message", content: [{ type: "text", text: "A new request." }] }],
      ["summary", { type: "command", name: "compact", arguments: "" }],
    ] as const) {
      session.start({ clientMessageId, delivery: "auto", input: structuredClone(input) });
      await expect.poll(() => session.running).toBe(false);
    }
    expect(
      events.filter((event) => event.type === "session.turn" && event.state === "failed"),
    ).toHaveLength(2);
    expect(JSON.stringify(events)).not.toContain("synthetic-usage-key");
    expect(
      events
        .filter((event) => event.type === "session.usage")
        .map((event) => (event.type === "session.usage" ? event.usage : null)),
    ).toEqual([
      { inputTokens: 11, outputTokens: 3, cachedInputTokens: 4 },
      { inputTokens: 11, outputTokens: 3, cachedInputTokens: 4 },
    ]);
  } finally {
    await session.close();
    await fixture.close();
  }
});

test("invalid credential header values fail without echoing their contents", async () => {
  const result = streamCompletion({
    baseUrl: "http://127.0.0.1:1/v1",
    model: "fixture",
    tools: [],
    messages: [],
    signal: new AbortController().signal,
    apiKey: "synthetic-secret\ninvalid",
  });
  await expect(result).rejects.toThrow("API key contains invalid characters");
  await expect(result).rejects.not.toThrow("synthetic-secret");
});
