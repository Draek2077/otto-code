import { createServer } from "node:http";
import { once } from "node:events";
import { expect, it } from "vitest";
import type { ProviderEvent } from "@getpaseo/plugin/server/provider";
import { createOpenAiProvider } from "./provider.js";
import { qualifyModel } from "./endpoints.js";

it("disconnects active sessions for a removed connection, retains transcript events and leaves other connections open", async () => {
  let requestStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    requestStarted = resolve;
  });
  let requestClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    requestClosed = resolve;
  });
  const server = createServer(async (request, response) => {
    for await (const chunk of request) void chunk;
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Retained partial answer" } }] })}\n\n`,
    );
    response.on("close", requestClosed);
    requestStarted();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test port");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const provider = createOpenAiProvider(async () => ({
    baseUrl,
    model: "fixture",
    apiKeyEnv: "UNSET_SYNTHETIC_KEY",
    maxToolRounds: 4,
    timeoutMs: 10000,
    endpoints: [
      { id: "other", label: "Other", baseUrl, model: "fixture", apiKeyEnv: "UNSET_SYNTHETIC_KEY" },
    ],
  }));
  const connection = await provider.connect({
    versions: [1],
    capabilities: ["prompt.message", "session.persistence"],
  });
  const events: ProviderEvent[] = [];
  connection.onEvent((event) => events.push(event));
  try {
    for (const [sessionId, model] of [
      ["removed", "fixture"],
      ["kept", qualifyModel("other", "fixture")],
    ]) {
      await connection.send({
        type: "session.open",
        requestId: sessionId,
        sessionId: sessionId!,
        history: "skip",
        config: { cwd: process.cwd(), env: {}, model, mcpServers: {}, settings: {}, persist: true },
      });
      await expect
        .poll(() =>
          events.some((event) => event.type === "session.ready" && event.sessionId === sessionId),
        )
        .toBe(true);
    }
    await connection.send({
      type: "session.prompt",
      sessionId: "removed",
      prompt: {
        clientMessageId: "keep-history",
        delivery: "auto",
        input: { type: "message", content: [{ type: "text", text: "Retain my chat history" }] },
      },
    });
    await started;
    await provider.retireProfile("primary");
    await closed;
    expect(events.filter((event) => event.type === "session.closed")).toEqual([
      {
        type: "session.closed",
        sessionId: "removed",
        error: {
          code: "connection_removed",
          message: "This connection was removed. Chat history is retained.",
        },
      },
    ]);
    expect(
      JSON.stringify(events.filter((event) => event.type === "session.persistence")),
    ).toContain("Retain my chat history");
    expect(
      events.some((event) => event.type === "session.ready" && event.sessionId === "kept"),
    ).toBe(true);
  } finally {
    await connection.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
