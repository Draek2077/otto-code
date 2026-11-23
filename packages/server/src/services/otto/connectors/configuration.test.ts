import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONNECTOR_CATALOG } from "@getpaseo/plugin/otto/connectors";
import {
  connectorEndpoint,
  connectorServerSummary,
  connectorSetup,
  legacyConnectorBundle,
  serializeConnectorBundle,
} from "./configuration.js";

describe("host-owned Connector construction", () => {
  it.each(CONNECTOR_CATALOG)(
    "constructs $id from the pinned catalog without accepting a client-supplied command or endpoint",
    (row) => {
      const result = connectorSetup({
        kind: "catalog",
        catalogId: row.id,
        roots: row.id === "filesystem" ? [path.resolve("fixture-root")] : [],
        credential: row.setup.kind === "token" ? "fixture-key" : undefined,
        ...(row.setup.kind === "oauth" && row.setup.registration?.required
          ? { client: { clientId: "fixture-client", clientSecret: "fixture-client-secret" } }
          : {}),
      });
      expect(result.catalogId).toBe(row.id);
      if ("url" in row.setup) {
        expect(result.bundle.server).toMatchObject({ url: row.setup.url });
        expect(result.bundle.oauth).toBe(row.setup.kind === "oauth");
      } else expect(result.bundle.server).toMatchObject({ command: row.setup.command });
      expect(JSON.parse(serializeConnectorBundle(result.bundle))).toMatchObject({
        server: result.bundle.server,
      });
    },
  );

  it("requires explicit owning-host directories for Local files", () => {
    expect(() => connectorSetup({ kind: "catalog", catalogId: "asana", roots: [] })).toThrow(
      "registered MCP app",
    );
    expect(() => connectorSetup({ kind: "catalog", catalogId: "filesystem", roots: [] })).toThrow(
      "absolute directory",
    );
    expect(() =>
      connectorSetup({ kind: "catalog", catalogId: "filesystem", roots: ["relative-root"] }),
    ).toThrow("absolute directory");
  });

  it("does not put saved arguments, environment values, URL query values or header values in a presentation summary", () => {
    const stdio = connectorServerSummary({
      type: "stdio",
      command: "server",
      args: ["argument-secret"],
      env: { TOKEN: "env-secret" },
    });
    expect(stdio).toMatchObject({ argumentCount: 1, environmentNames: ["TOKEN"] });
    expect(JSON.stringify(stdio)).not.toMatch(/argument-secret|env-secret/);
    const http = connectorServerSummary({
      type: "http",
      url: "https://service.invalid/mcp?key=query-secret",
      headers: { Authorization: "header-secret" },
    });
    expect(http).toMatchObject({
      endpoint: "https://service.invalid/mcp",
      headerNames: ["Authorization"],
    });
    expect(JSON.stringify(http)).not.toMatch(/query-secret|header-secret/);
  });

  it.each([
    "http://remote.invalid/mcp",
    "https://user:secret@remote.invalid/mcp",
    "file:///tmp/mcp",
    "https://remote.invalid/mcp#secret",
  ])("rejects unsafe remote endpoint %s", (url) => {
    expect(() => connectorEndpoint(url)).toThrow("Use HTTPS");
  });

  it("allows isolated loopback fixtures without widening remote credential transport", () => {
    expect(connectorEndpoint("http://127.0.0.1:1234/mcp").hostname).toBe("127.0.0.1");
    expect(connectorEndpoint("http://[::1]:1234/mcp").hostname).toBe("[::1]");
  });

  it("keeps legacy auth and unknown fields daemon-only, without changing the original record", () => {
    const record = {
      id: "existing",
      enabled: false,
      disabledTools: ["write"],
      workspaces: { old: { enabled: false } },
      server: { type: "stdio", command: "existing-command", env: { KEY: "old-secret" } },
      auth: { kind: "oauth", tokens: { accessToken: "old-access" } },
      unknown: { retained: true },
    };
    const before = structuredClone(record);
    const bundle = legacyConnectorBundle(record);
    expect(bundle.authorization).toEqual(record.auth);
    expect(bundle.legacy).toEqual(before);
    expect(record).toEqual(before);
    expect(JSON.stringify(connectorServerSummary(bundle.server))).not.toMatch(
      /old-secret|old-access/,
    );
  });

  it("rejects incompatible auth setup and oversized secure bundles before vault I/O", () => {
    expect(() =>
      connectorSetup({
        kind: "custom",
        server: { type: "stdio", command: "server", args: [], env: {} },
        oauth: true,
        scope: "",
      }),
    ).toThrow("HTTP or SSE");
    expect(() =>
      connectorSetup({
        kind: "custom",
        server: {
          type: "http",
          url: "https://server.invalid/mcp",
          headers: { authorization: "Bearer key" },
        },
        oauth: true,
        scope: "",
      }),
    ).toThrow("rather than both");
    expect(() =>
      serializeConnectorBundle({
        server: { type: "stdio", command: "server", args: [], env: { KEY: "x".repeat(125000) } },
        oauth: false,
        scope: "",
      }),
    ).toThrow("secure storage limits");
  });
});
