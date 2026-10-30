import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

/** Isolated, deterministic MCP service. No vendor account, sign-in or real file
 * tools; the real daemon transport still initializes and enumerates this server. */
export async function createConnectorFixture() {
  let calls = 0;
  async function respond(request: IncomingMessage, response: ServerResponse) {
    if (request.method !== "POST") {
      response.writeHead(405);
      response.end();
      return;
    }
    let bytes = "";
    for await (const chunk of request) {
      bytes += String(chunk);
      if (bytes.length > 65536) throw new Error("Oversized fixture input");
    }
    const input = JSON.parse(bytes) as {
      id?: string | number;
      method: string;
      params?: { protocolVersion?: string };
    };
    if (input.id === undefined) {
      response.writeHead(202);
      response.end();
      return;
    }
    let result: unknown = {};
    if (input.method === "initialize")
      result = {
        protocolVersion: input.params?.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "otto-connector-fixture", version: "1" },
      };
    if (input.method === "tools/list")
      result = {
        tools: ["fixture_read", "fixture_write"].map((name) => ({
          name,
          description: `Isolated ${name}`,
          inputSchema: { type: "object", properties: {} },
          annotations: { readOnlyHint: name === "fixture_read" },
        })),
      };
    if (input.method === "tools/call") {
      calls++;
      result = { content: [{ type: "text", text: "Fixture result" }] };
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: input.id, result }));
  }
  const server = createServer((request, response) => {
    void respond(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(400);
      response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No MCP fixture address");
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    calls: () => calls,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}
