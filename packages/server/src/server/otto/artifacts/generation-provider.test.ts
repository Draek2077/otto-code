import { createServer } from "node:http";
import { once } from "node:events";
import { expect, test } from "vitest";
import pino from "pino";
import { createOpenAiProvider } from "@getpaseo/plugin/server/otto-openai";
import { providerSettings } from "@getpaseo/plugin/otto/openai-settings";
import { PluginAgentClientRegistry } from "../../agent/plugin-provider.js";
import { resolveDefaultAgentCreateConfig } from "../../agent/create-agent-mode.js";
import { createArtifactGeneration } from "./generation.js";

test("Artifact generation crosses the real provider protocol and a loopback HTTP endpoint without a daemon or model", async () => {
  const html = "<html><head><title>Report</title></head><body>Real protocol output</body></html>";
  let requests = 0;
  const server = createServer((request, response) => {
    if (request.method === "GET") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: [{ id: "fixture" }] }));
      return;
    }
    requests++;
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: JSON.stringify({ html }) }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
      );
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing isolated endpoint");
  const settings = providerSettings.schema.parse({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: "fixture",
  });
  const registration = createOpenAiProvider(async () => settings, {
    resolveApiKey: async () => undefined,
  });
  const registry = new PluginAgentClientRegistry(pino({ level: "silent" }));
  registry.replace([registration]);
  const clients = registry.clients(),
    client = clients[registration.id]!;
  try {
    const catalog = await client.fetchCatalog({ scope: "global", force: false });
    const generate = createArtifactGeneration({
      providers: {
        getAgentManagerProviderState: () => ({ clients, providerDefinitions: {} }),
        resolveCreateConfig: async (input) =>
          resolveDefaultAgentCreateConfig({
            provider: input.provider,
            requestedMode: input.requestedMode,
            featureValues: input.featureValues,
            parent: null,
            unattended: input.unattended,
            availableModes: catalog.modes,
          }),
      },
      candidates: async () => [{ provider: registration.id, model: "fixture" }],
    });
    expect(
      await generate({
        cwd: process.cwd(),
        prompt: "Return a report",
        signal: new AbortController().signal,
      }),
    ).toEqual({ html, provider: registration.id, model: "fixture" });
    expect(requests).toBe(1);
  } finally {
    registry.replace([]);
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      }),
    );
  }
});
