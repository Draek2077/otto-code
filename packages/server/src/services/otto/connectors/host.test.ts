import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import type { AgentTool } from "@getpaseo/plugin/server/otto-openai";
import {
  readConnectors,
  writeConnectors,
  authorizeConnector,
  GOOGLE_CONNECTOR_SERVICES,
} from "@getpaseo/plugin/otto/connectors";
import { ConnectorHost } from "./host.js";
import { registerConnectorTools } from "./catalog.js";
import { GOOGLE_CONNECTOR_IDENTITY_SCOPES } from "./google/google-connector-scopes.js";
import { IntegrationAuthorizationSecrets } from "../integrations/authorization-secrets.js";
import {
  IntegrationRegistryConflictError,
  type IntegrationRegistry,
  type IntegrationRegistrySnapshot,
} from "../integrations/registry.js";
import type { PaseoToolDefinition } from "../../../server/agent/tools/types.js";
function textPart(part: { text?: string }): { type: "text"; text: string } {
  return { type: "text", text: part.text ?? "" };
}

function registry(): IntegrationRegistry {
  let state: IntegrationRegistrySnapshot = { revision: "origin", connections: {} };
  let sequence = 0;
  return {
    read: async () => structuredClone(state),
    update: async (input) => {
      if (state.revision !== input.expectedRevision) throw new IntegrationRegistryConflictError();
      state = {
        revision: String(++sequence),
        connections: { ...state.connections, [input.integrationId]: input.value },
      };
      return structuredClone(state);
    },
  };
}
function fixture(
  legacyRecords: unknown[] = [],
  legacyCredential?: (integrationId: string, connectionId: string) => Promise<string | null>,
) {
  let loads = 0;
  let calls = 0;
  let closes = 0;
  let vaultReads = 0;
  let fail = false;
  const values = new Map<string, string>();
  const authorization = new IntegrationAuthorizationSecrets({
    hostId: "fixture",
    registry: registry(),
    vault: async () => {
      vaultReads++;
      return {
        get: async (key) => values.get(JSON.stringify(key)) ?? null,
        put: async (key, value) => {
          values.set(JSON.stringify(key), value);
        },
        delete: async (key) => values.delete(JSON.stringify(key)),
      };
    },
  });
  const tools: AgentTool[] = ["read", "write"].map((name) => ({
    access: name === "read" ? "read" : "write",
    preapproval: { server: "fixture", tool: name },
    definition: {
      type: "function",
      function: {
        name,
        description: `Fixture ${name}`,
        parameters: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
        },
      },
    },
    detail: () => ({ type: "unknown", input: {}, output: null }),
    execute: async () => {
      calls++;
      return "safe result with private-token";
    },
  }));
  const host = new ConnectorHost({
    hostId: "fixture",
    cwd: "host-home",
    registry: registry(),
    authorization,
    legacy: async () => JSON.stringify({ connectors: legacyRecords }),
    legacyCredential,
    legacyAccount: async () => "preserved@example.test",
    providers: () => [{ id: "local", label: "Local model", available: true, reason: null }],
    load: async () => {
      loads++;
      if (fail) throw new Error("private-process-error private-token");
      return {
        tools,
        instructions: [],
        close: async () => {
          closes++;
        },
      };
    },
  });
  const add = async () =>
    host.write((await host.read()).revision, {
      kind: "add",
      label: "Fixture",
      setup: {
        kind: "custom",
        oauth: false,
        scope: "",
        server: {
          type: "http",
          url: "https://fixture.invalid/mcp",
          headers: { Authorization: "Bearer private-token" },
        },
      },
    });
  return {
    host,
    add,
    values,
    calls: () => calls,
    loads: () => loads,
    closes: () => closes,
    vaultReads: () => vaultReads,
    fail() {
      fail = true;
    },
  };
}

describe("integrated Connector host", () => {
  it("reuses the exact legacy Google grant identity and account label without migrating or replacing it", async () => {
    const service = GOOGLE_CONNECTOR_SERVICES.find((row) => row.id === "google-drive")!;
    const legacy = {
      id: "original-google-id",
      label: "Work Drive",
      builtin: service.id,
      enabled: true,
      server: { type: "http", url: service.url, headers: {} },
      unknown: { retained: true },
    };
    const before = JSON.stringify(legacy);
    const reads: string[][] = [];
    const test = fixture([legacy], async (integrationId, connectionId) => {
      reads.push([integrationId, connectionId]);
      return JSON.stringify({
        kind: "oauth-token-set-v1",
        accessToken: "preserved-private-access",
        refreshToken: "preserved-private-refresh",
        expiresAt: "2099-01-01T00:00:00.000Z",
        grantedScopes: [...service.scopes, ...GOOGLE_CONNECTOR_IDENTITY_SCOPES],
      });
    });
    try {
      const view = await test.host.read(legacy.id);
      expect(view.detail?.authorization).toMatchObject({
        state: "connected",
        account: "preserved@example.test",
      });
      expect(reads).toEqual([["google-connectors", legacy.id]]);
      expect(JSON.stringify(view)).not.toMatch(/preserved-private/);
      expect(test.values.size).toBe(0);
      expect(JSON.stringify(legacy)).toBe(before);
    } finally {
      await test.host.close();
    }
  });

  it("refreshes catalog snapshots on later construction and closes retired idle clients", async () => {
    const test = fixture();
    const clock = vi.spyOn(Date, "now");
    try {
      await test.add();
      const initial = Date.now();
      clock.mockReturnValue(initial + 300001);
      expect(await test.host.definitions("workspace")).toHaveLength(2);
      expect(test.loads()).toBe(2);
      expect(test.closes()).toBe(1);
      const current = await test.host.read();
      const id = current.connectors[0].id;
      await test.host.write(current.revision, { kind: "remove", id });
      expect(test.closes()).toBe(2);
    } finally {
      clock.mockRestore();
      await test.host.close();
    }
  });
  it("does no vault, process or network work on construction or empty Settings reads", async () => {
    const test = fixture();
    try {
      expect((await test.host.read()).connectors).toEqual([]);
      expect(test.loads()).toBe(0);
      expect(test.vaultReads()).toBe(0);
    } finally {
      await test.host.close();
    }
  });

  it("admits real discovered tools on explicit Add and exposes the same tool through the ordinary MCP protocol", async () => {
    const test = fixture();
    const server = new McpServer({ name: "fixture", version: "1" });
    const client = new Client({ name: "fixture", version: "1" });
    try {
      const saved = await test.add();
      expect(saved.detail).toMatchObject({
        enabled: true,
        verification: { state: "verified", toolCount: 2 },
      });
      expect(JSON.stringify(saved)).not.toContain("private-token");
      const definitions = await test.host.definitions("workspace");
      expect(definitions).toHaveLength(2);
      for (const tool of definitions)
        server.registerTool(
          tool.name,
          {
            inputSchema: tool.inputSchema,
            description: tool.description,
            annotations: tool.annotations,
          },
          async (input: unknown) => ({
            content: (await tool.handler(input, {})).content.map(textPart),
          }),
        );
      const [left, right] = InMemoryTransport.createLinkedPair();
      await server.connect(left);
      await client.connect(right);
      const listed = (await client.listTools()).tools;
      expect(listed).toHaveLength(2);
      expect(listed[0].annotations?.readOnlyHint).toBe(true);
      const result = await client.callTool({
        name: definitions[0].name,
        arguments: { value: "fixture" },
      });
      expect(result.content).toEqual([{ type: "text", text: "safe result with [redacted]" }]);
      expect(test.calls()).toBe(1);
    } finally {
      await client.close();
      await server.close();
      await test.host.close();
    }
    expect(test.closes()).toBe(1);
  });

  it("removes disabled tools from new catalogs and blocks previously captured handlers before execution", async () => {
    const test = fixture();
    try {
      const saved = await test.add();
      const id = saved.detail!.id;
      const captured = await test.host.definitions("workspace");
      await test.host.write(saved.revision, { kind: "tools", id, disabledTools: ["write"] });
      expect(await test.host.definitions("workspace")).toHaveLength(1);
      expect((await captured[1].handler({ value: "fixture" }, {})).isError).toBe(true);
      const state = await test.host.read();
      await test.host.write(state.revision, { kind: "enable", id, enabled: false });
      expect(await test.host.definitions("workspace")).toEqual([]);
      expect((await captured[0].handler({ value: "fixture" }, {})).isError).toBe(true);
      expect(test.calls()).toBe(0);
    } finally {
      await test.host.close();
    }
  });

  it("keeps rejected discovery disabled and sanitizes errors, with no implicit retry", async () => {
    const test = fixture();
    test.fail();
    try {
      const saved = await test.add();
      expect(saved.detail).toMatchObject({
        enabled: false,
        verification: { state: "failed", toolCount: 0 },
      });
      expect(JSON.stringify(saved)).not.toMatch(/private-token|private-process-error/);
      await expect(
        test.host.write(saved.revision, { kind: "enable", id: saved.detail!.id, enabled: true }),
      ).rejects.toMatchObject({ kind: "validation" });
      expect(test.loads()).toBe(1);
    } finally {
      await test.host.close();
    }
  });

  it("rejects cross-host and stale settings RPCs before secure writes", async () => {
    const test = fixture();
    try {
      const wrong = readConnectors.output.parse(
        await test.host.invoke(readConnectors.name, { hostId: "other" }),
      );
      expect(wrong).toMatchObject({ ok: false, error: { kind: "validation" } });
      const stale = writeConnectors.output.parse(
        await test.host.invoke(writeConnectors.name, {
          hostId: "fixture",
          expectedRevision: "stale",
          action: {
            kind: "add",
            label: "Stale",
            setup: { kind: "catalog", catalogId: "deepwiki", roots: [] },
          },
        }),
      );
      expect(stale).toMatchObject({ ok: false, error: { kind: "conflict" } });
      expect(test.vaultReads()).toBe(0);
      expect(() =>
        authorizeConnector.input.parse({
          hostId: "fixture",
          expectedRevision: "origin",
          id: "fixture",
          code: "browser-code",
        }),
      ).toThrow();
    } finally {
      await test.host.close();
    }
  });

  it.each(["unbound", "master", "tool", "enabled"])(
    "keeps upstream %s admission authoritative for every provider catalog",
    (mode) => {
      const tools = new Map<string, PaseoToolDefinition>();
      const definition: PaseoToolDefinition = {
        name: "connector_fixture",
        description: "Fixture",
        inputSchema: z.object({}),
        handler: async () => ({ content: [] }),
      };
      registerConnectorTools({
        tools,
        definitions: [definition],
        callerAgentId: mode === "unbound" ? undefined : "chat",
        policy: {
          enabled: mode !== "master",
          disabledTools: mode === "tool" ? [definition.name] : [],
        },
      });
      expect(tools.size).toBe(mode === "enabled" ? 1 : 0);
    },
  );
});
