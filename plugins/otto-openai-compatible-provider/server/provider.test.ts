import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, expect, it } from "vitest";
import type { ProviderEvent, ProviderInput } from "@getpaseo/plugin/server/provider";
import { createOpenAiProvider } from "./provider.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

it("discovers a model, completes a streamed turn, and resumes the model conversation", async () => {
  const requests: Array<{ messages: unknown[] }> = [];
  const server = createServer(async (request, response) => {
    if (request.url === "/v1/models") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: [{ id: "local-model" }] }));
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push(JSON.parse(body));
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Hello from the model" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing test endpoint");
  const provider = createOpenAiProvider(async () => ({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: "",
    apiKeyEnv: "OPENAI_API_KEY",
    maxToolRounds: 4,
    timeoutMs: 5000,
  }));
  const connect = async () => {
    const connection = await provider.connect({
      versions: [1],
      capabilities: ["prompt.message", "session.persistence"],
    });
    cleanup.push(() => connection.close());
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    return { connection, events };
  };
  const first = await connect();
  await first.connection.send({ type: "catalog", requestId: "models" });
  await expect
    .poll(() => first.events.find((event) => event.type === "catalog"))
    .toMatchObject({
      type: "catalog",
      catalog: { models: [{ id: "local-model", label: "local-model" }] },
    });
  const config = {
    cwd: process.cwd(),
    env: {},
    mcpServers: {},
    model: "local-model",
    settings: {},
    persist: true,
  };
  await first.connection.send({
    type: "session.open",
    requestId: "open",
    sessionId: "one",
    history: "skip",
    config,
  });
  await expect.poll(() => first.events.some((event) => event.type === "session.ready")).toBe(true);
  const prompt = (sessionId: string, id: string, text: string): ProviderInput => ({
    type: "session.prompt",
    sessionId,
    prompt: {
      clientMessageId: id,
      delivery: "auto",
      input: { type: "message", content: [{ type: "text", text }] },
    },
  });
  await first.connection.send(prompt("one", "prompt-1", "Hello"));
  await expect
    .poll(() =>
      first.events.find((event) => event.type === "session.turn" && event.state === "completed"),
    )
    .toMatchObject({ state: "completed" });
  const persisted = first.events.findLast((event) => event.type === "session.persistence");
  if (!persisted || persisted.type !== "session.persistence")
    throw Error("Missing saved conversation");
  await first.connection.close();
  const second = await connect();
  await second.connection.send({
    type: "session.open",
    requestId: "resume",
    sessionId: "two",
    history: "replay",
    config,
    persistence: persisted.persistence,
  });
  await expect.poll(() => second.events.some((event) => event.type === "session.ready")).toBe(true);
  await second.connection.send(prompt("two", "prompt-2", "Continue"));
  await expect
    .poll(() =>
      second.events.find((event) => event.type === "session.turn" && event.state === "completed"),
    )
    .toMatchObject({ state: "completed" });
  expect(requests.map((request) => request.messages)).toEqual([
    [{ role: "user", content: "Hello" }],
    [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hello from the model" },
      { role: "user", content: "Continue" },
    ],
  ]);
  expect(
    second.events.findLast(
      (event) => event.type === "timeline.item" && event.item.type === "assistant_message",
    ),
  ).toMatchObject({ item: { text: "Hello from the model" } });
});
