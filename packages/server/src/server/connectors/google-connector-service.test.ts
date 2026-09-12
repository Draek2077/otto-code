import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAgentMcpServer } from "../agent/mcp-server.js";
import { createOttoToolCatalog, type OttoToolHostDependencies } from "../agent/tools/otto-tools.js";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { afterEach, expect, test, vi } from "vitest";
import {
  GOOGLE_CONNECTOR_SERVICES,
  type ConnectorConfig,
} from "@otto-code/protocol/provider-config";
import { GoogleConnectorService } from "./google-connector-service.js";
import { connectorToolName } from "./connector-tool-name.js";

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const descriptor = GOOGLE_CONNECTOR_SERVICES.find((entry) => entry.id === "google-drive")!;
  const connector: ConnectorConfig = {
    id: "drive",
    label: "Drive",
    builtin: descriptor.id,
    server: { type: "http", url: descriptor.url },
  };
  const connectors = [connector];
  const service = new GoogleConnectorService({
    readConnectors: () => connectors,
    authorization: {
      configured: true,
      start: async () => ({ authorizationUrl: "https://accounts.google.com" }),
      disconnect: async () => {},
      close: async () => {},
      reconcile: async () => {},
      accessToken: async () => "account-token",
    },
  });
  return { connector, connectors, service };
}

test("verification rejects access failures instead of advertising the static REST tool list", async () => {
  const f = fixture();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("private vendor body", { status: 403 })),
  );
  const result = await f.service.listTools(f.connector);
  expect(result.tools).toEqual([]);
  expect(result.error).toContain("did not grant access");
  expect(result.error).not.toContain("private vendor body");
});

test("native tools retain pagination and stale definitions reject disabled or removed grants", async () => {
  const f = fixture();
  const fetch = vi.fn(async (_url: string | URL | Request) =>
    Response.json({ files: [{ id: "file-one", name: "Example" }], nextPageToken: "next-page" }),
  );
  vi.stubGlobal("fetch", fetch);
  const definitions = await f.service.getTools(f.connector);
  const name = connectorToolName("drive", "list_files");
  const tool = definitions.find((entry) => entry.name === name)!;
  expect(tool.source).toBe("connector");
  const result = await tool.handler({ pageSize: 1 }, {});
  expect(JSON.parse(result.content[0].text!)).toMatchObject({ nextPageToken: "next-page" });
  expect(String(fetch.mock.calls[0]?.[0])).toContain("pageSize=1");
  f.connector.disabledTools = ["list_files"];
  expect((await tool.handler({}, {})).isError).toBe(true);
  f.connectors.length = 0;
  expect((await tool.handler({}, {})).isError).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("all Google operations reach native and MCP providers with the same schemas and live switches", async () => {
  const f = fixture();
  f.connectors.splice(
    0,
    1,
    ...GOOGLE_CONNECTOR_SERVICES.map((service) => ({
      id: service.id,
      label: service.label,
      builtin: service.id,
      server: { type: "http" as const, url: service.url },
    })),
  );
  const fetch = vi.fn(async () =>
    Response.json({ files: [{ id: "one" }], nextPageToken: "page-two" }),
  );
  vi.stubGlobal("fetch", fetch);
  const connectorTools = (await Promise.all(f.connectors.map((c) => f.service.getTools(c)))).flat();
  expect(connectorTools).toHaveLength(14);
  const deps = {
    agentManager: {},
    agentStorage: {},
    providerSnapshotManager: {},
    logger: createTestLogger(),
    connectorTools,
    enabledOttoToolGroups: [],
  } as unknown as OttoToolHostDependencies;
  const native = createOttoToolCatalog(deps);
  const mcp = await createAgentMcpServer(deps);
  const client = new Client({ name: "google-provider-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listing = await client.listTools();
    expect(listing.tools.map((t) => t.name).sort()).toEqual(
      connectorTools.map((t) => t.name).sort(),
    );
    const eventName = connectorToolName("google-calendar", "create_event");
    expect(listing.tools.find((t) => t.name === eventName)?.inputSchema.required).toEqual([
      "summary",
      "start",
      "end",
    ]);
    const name = connectorToolName("google-drive", "list_files");
    const args = { pageSize: 1, pageToken: "page-one" };
    const a = await native.executeTool(name, args);
    const b = await client.callTool({ name, arguments: args });
    expect(b.content).toEqual(a.content);
    expect(JSON.stringify(a)).toContain("page-two");
    expect(fetch).toHaveBeenCalledTimes(2);
    f.connectors.find((c) => c.id === "google-drive")!.disabledTools = ["list_files"];
    expect((await native.executeTool(name, args)).isError).toBe(true);
    expect((await client.callTool({ name, arguments: args })).isError).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    await client.close();
    await mcp.close();
  }
});
