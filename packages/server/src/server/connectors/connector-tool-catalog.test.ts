import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, test, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ConnectorConfig } from "@otto-code/protocol/provider-config";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { createAgentMcpServer } from "../agent/mcp-server.js";
import { createOttoToolCatalog, type OttoToolHostDependencies } from "../agent/tools/otto-tools.js";
import { ConnectorToolCatalogService } from "./connector-tool-catalog.js";
import { connectorToolName } from "./connector-tool-name.js";
import { createMemoryConnectorAuthStore } from "./connector-auth-store.js";

const servers: Server[] = [];
const services: ConnectorToolCatalogService[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(services.splice(0).map((service) => service.close()));
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

test("real paginated MCP tools reach native and MCP catalogs, with live disable and secret redaction", async () => {
  let calls = 0;
  const server = createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const message = JSON.parse(body);
      if (message.id === undefined) {
        res.writeHead(202).end();
        return;
      }
      let result: unknown;
      if (message.method === "initialize") {
        result = {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "fixture", version: "1" },
        };
      } else if (message.method === "tools/list") {
        result = {
          tools: [
            {
              name: message.params?.cursor ? "second" : "search",
              description: "Search records",
              inputSchema: {
                type: "object",
                properties: { query: { type: "string" } },
                required: ["query"],
              },
            },
          ],
          ...(message.params?.cursor ? {} : { nextCursor: "page-2" }),
        };
      } else {
        calls += 1;
        result = {
          content: [],
          structuredContent: { query: message.params.arguments.query, value: "test-header-secret" },
        };
      }
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  let connectors: ConnectorConfig[] = [
    {
      id: "fixture",
      label: "Fixture",
      server: {
        type: "http",
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`,
        headers: { Authorization: "test-header-secret" },
      },
    },
  ];
  const service = new ConnectorToolCatalogService({
    readConnectors: () => connectors,
    authStore: createMemoryConnectorAuthStore(),
    logger: createTestLogger(),
  });
  services.push(service);
  const connectorTools = await service.getTools(process.cwd());
  expect(connectorTools).toHaveLength(2);
  const deps = {
    agentManager: {},
    agentStorage: {},
    providerSnapshotManager: {},
    logger: createTestLogger(),
    connectorTools,
    enabledOttoToolGroups: [],
  } as unknown as OttoToolHostDependencies;
  const catalog = createOttoToolCatalog(deps);
  const searchName = connectorToolName("fixture", "search");
  expect(catalog.getTool(searchName)).toBeDefined();
  const native = await catalog.executeTool(searchName, { query: "native" });
  expect(JSON.stringify(native)).toContain("native");
  expect(JSON.stringify(native)).not.toContain("test-header-secret");
  const mcp = await createAgentMcpServer(deps);
  const client = new Client({ name: "provider-fixture", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listing = await client.listTools();
    expect(listing.tools.map((tool) => tool.name)).toEqual(connectorTools.map((tool) => tool.name));
    expect(listing.tools[0].inputSchema.required).toEqual(["query"]);
    expect(listing.tools[0].annotations?.readOnlyHint).toBe(false);
    expect(
      (await client.callTool({ name: searchName, arguments: { query: "remote" } })).isError,
    ).not.toBe(true);
    expect(calls).toBe(2);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 301_000);
    await service.getTools(process.cwd());
    expect(
      (await client.callTool({ name: searchName, arguments: { query: "after-reconnect" } }))
        .isError,
    ).not.toBe(true);
    expect(calls).toBe(3);
    clock.mockRestore();
    connectors = [{ ...connectors[0], disabledTools: ["search"] }];
    expect(
      (await client.callTool({ name: searchName, arguments: { query: "blocked" } })).isError,
    ).toBe(true);
    expect(calls).toBe(3);
    expect((await service.getTools(process.cwd())).map((tool) => tool.name)).toEqual([
      connectorToolName("fixture", "second"),
    ]);
    connectors = [];
    expect((await catalog.executeTool(searchName, { query: "removed" })).isError).toBe(true);
  } finally {
    await client.close();
    await mcp.close();
  }
});

test("names remain distinct after sanitization and truncation", () => {
  const a = connectorToolName("same", "long".repeat(50) + "a");
  const b = connectorToolName("same", "long".repeat(50) + "b");
  expect(a).not.toBe(b);
  expect(a.length).toBeLessThanOrEqual(64);
  expect(connectorToolName("a-b", "x")).not.toBe(connectorToolName("a_b", "x"));
});
