import { createServer } from "node:http";
import { once } from "node:events";
import { expect, it } from "vitest";
import type { ProviderEvent } from "@getpaseo/plugin/server/provider";
import { createOpenAiProvider } from "./provider.js";
import { providerSettings } from "../shared/settings.js";
import { qualifyModel } from "./endpoints.js";

async function endpointFixture() {
  const requests: Array<{ key: string | undefined; model: string; messages: unknown[] }> = [];
  let offline = false;
  const server = createServer(async (request, response) => {
    if (request.method === "GET") {
      response.writeHead(offline ? 503 : 200, { "content-type": "application/json" });
      response.end(
        JSON.stringify(offline ? { error: "Offline fixture" } : { data: [{ id: "same/model" }] }),
      );
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ ...JSON.parse(body), key: request.headers.authorization });
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Done." }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing endpoint");
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests,
    offline: () => {
      offline = true;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

it("routes identical model IDs and host credentials to their owning endpoints while isolating offline catalogs", async () => {
  const first = await endpointFixture();
  const second = await endpointFixture();
  const settings = providerSettings.schema.parse({
    baseUrl: first.url,
    timeoutMs: 5000,
    endpoints: [{ id: "second", label: "Second endpoint", baseUrl: second.url }],
  });
  const provider = createOpenAiProvider(async () => settings, {
    resolveApiKey: async (profile) => `synthetic-${profile.id}-key`,
  });
  const connection = await provider.connect({
    versions: [1],
    capabilities: ["prompt.message", "session.configure", "session.persistence"],
  });
  const events: ProviderEvent[] = [];
  connection.onEvent((event) => events.push(event));
  const secondaryModel = qualifyModel("second", "same/model");
  try {
    await connection.send({ type: "catalog", requestId: "initial" });
    await expect
      .poll(() => events.find((event) => event.type === "catalog" && event.requestId === "initial"))
      .toMatchObject({
        catalog: {
          models: [{ id: "same/model" }, { id: secondaryModel }],
          defaultModel: "same/model",
        },
      });
    for (const [sessionId, model] of [
      ["one", "same/model"],
      ["two", secondaryModel],
    ] as const) {
      await connection.send({
        type: "session.open",
        requestId: `open-${sessionId}`,
        sessionId,
        history: "skip",
        config: { cwd: process.cwd(), env: {}, model, settings: {}, mcpServers: {}, persist: true },
      });
      await expect
        .poll(() =>
          events.some((event) => event.type === "session.ready" && event.sessionId === sessionId),
        )
        .toBe(true);
      await connection.send({
        type: "session.prompt",
        sessionId,
        prompt: {
          clientMessageId: sessionId,
          delivery: "auto",
          input: { type: "message", content: [{ type: "text", text: `Hello ${sessionId}` }] },
        },
      });
      await expect
        .poll(() =>
          events.some(
            (event) =>
              event.type === "session.turn" &&
              event.sessionId === sessionId &&
              event.state === "completed",
          ),
        )
        .toBe(true);
    }
    expect(first.requests).toHaveLength(1);
    expect(second.requests).toHaveLength(1);
    expect(first.requests[0]).toMatchObject({
      model: "same/model",
      key: "Bearer synthetic-primary-key",
    });
    expect(second.requests[0]).toMatchObject({
      model: "same/model",
      key: "Bearer synthetic-second-key",
    });
    expect(
      JSON.stringify(events.filter((event) => event.type === "session.persistence")).includes(
        "synthetic-second-key",
      ),
    ).toBe(false);
    await connection.send({
      type: "session.configure",
      requestId: "move-endpoint",
      sessionId: "two",
      changes: { model: "same/model" },
    });
    await expect
      .poll(() =>
        events.find(
          (event) => event.type === "request.failed" && event.requestId === "move-endpoint",
        ),
      )
      .toMatchObject({ error: { message: expect.stringContaining("new chat") } });
    first.offline();
    await connection.send({ type: "catalog", requestId: "offline" });
    await expect
      .poll(() => events.find((event) => event.type === "catalog" && event.requestId === "offline"))
      .toMatchObject({
        catalog: {
          models: [{ isSelectable: false }, { id: secondaryModel }],
          defaultModel: secondaryModel,
        },
      });
  } finally {
    await connection.close();
    await first.close();
    await second.close();
  }
});
