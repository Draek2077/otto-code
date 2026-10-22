import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, expect, it } from "vitest";
import { loadHttpMcpTools } from "./mcp.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

it("negotiates the HTTP MCP session and retains the exact tool-policy identity", async () => {
  const methods: string[] = [];
  const calls: unknown[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    if (request.method === "DELETE") {
      response.writeHead(204);
      response.end();
      return;
    }
    const input = JSON.parse(body) as { id?: number; method: string; params?: unknown };
    methods.push(input.method);
    if (input.method === "notifications/initialized") {
      response.writeHead(202);
      response.end();
      return;
    }
    if (input.method !== "initialize")
      expect(request.headers["mcp-session-id"]).toBe("test-session");
    response.setHeader("content-type", "application/json");
    if (input.method === "initialize") {
      response.setHeader("mcp-session-id", "test-session");
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: input.id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "fixture", version: "1" },
            instructions: "Keep this server instruction.",
          },
        }),
      );
    } else if (input.method === "tools/list") {
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: input.id,
          result: {
            tools: [
              {
                name: "echo.value",
                description: "Return the supplied value.",
                inputSchema: {
                  type: "object",
                  properties: { value: { type: "string" } },
                  required: ["value"],
                },
              },
            ],
          },
        }),
      );
    } else if (input.method === "tools/call") {
      calls.push(input.params);
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: input.id,
          result: { content: [{ type: "text", text: "tool result" }] },
        }),
      );
    } else {
      response.writeHead(400);
      response.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing endpoint");
  const loaded = await loadHttpMcpTools(
    { "otto-host": { type: "http", url: `http://127.0.0.1:${address.port}/mcp` } },
    5000,
    AbortSignal.timeout(5000),
  );
  cleanup.unshift(() => loaded.close());
  expect(loaded.instructions).toEqual(["[otto-host]\nKeep this server instruction."]);
  expect(loaded.tools).toHaveLength(1);
  const tool = loaded.tools[0]!;
  expect(tool.definition.function.name).toMatch(/^mcp_[a-f0-9]{24}$/);
  expect(tool.preapproval).toEqual({ server: "otto-host", tool: "echo.value" });
  expect(await tool.execute({ value: "proof" }, AbortSignal.timeout(5000))).toBe("tool result");
  expect(methods).toEqual(["initialize", "notifications/initialized", "tools/list", "tools/call"]);
  expect(calls).toEqual([{ name: "echo.value", arguments: { value: "proof" } }]);
});
