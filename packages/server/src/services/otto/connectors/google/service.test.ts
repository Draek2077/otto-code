import { describe, expect, it } from "vitest";
import { GOOGLE_CONNECTOR_SERVICES } from "@getpaseo/plugin/otto/connectors";
import { GoogleConnectorTools } from "./service.js";
import { GOOGLE_CONNECTOR_OPERATION_SCOPES } from "./google-connector-scopes.js";
import { connectorServerSummary, type ConnectorBundle } from "../configuration.js";
import type { ConnectorEntry } from "../store.js";

function fixture(serviceId = "google-drive") {
  const service = GOOGLE_CONNECTOR_SERVICES.find((row) => row.id === serviceId)!;
  const bundle: ConnectorBundle = {
    server: { type: "http", url: service.url, headers: {} },
    builtin: service.id,
    oauth: true,
    scope: "",
  };
  const entry: ConnectorEntry = {
    id: "fixture",
    label: "Google account",
    catalogId: service.id,
    generation: "generation",
    fingerprint: "config",
    enabled: true,
    disabledTools: [],
    server: connectorServerSummary(bundle.server),
    authorization: { state: "connected", account: null, scopes: [], message: null },
    verification: {
      state: "unverified",
      checkedAt: null,
      fingerprint: null,
      message: null,
      tools: [],
    },
  };
  const requests: Array<{ url: URL; headers: Headers; method: string | undefined }> = [];
  let authorizations = 0;
  let afterAuthorization = () => {};
  let output: unknown = { files: [] };
  const store = {
    open: async () => ({ revision: "settings", entry: structuredClone(entry), bundle }),
  };
  const tools = new GoogleConnectorTools({
    store,
    authorization: {
      authorize: async () => {
        authorizations++;
        afterAuthorization();
        return {
          server: {
            type: "http",
            url: service.url,
            headers: { Authorization: 'Bearer private"token' },
          },
          revision: "grant",
        };
      },
    },
    fetcher: async (input, init) => {
      requests.push({
        url: new URL(String(input)),
        headers: new Headers(init?.headers),
        method: init?.method,
      });
      return Response.json(output);
    },
  });
  return {
    tools,
    entry,
    requests,
    authorizations: () => authorizations,
    afterAuthorization(callback: () => void) {
      afterAuthorization = callback;
    },
    output(value: unknown) {
      output = value;
    },
  };
}

describe("native Google Connector tools", () => {
  it("does not verify a replacement connection using an earlier generation's authorization", async () => {
    const host = fixture();
    host.afterAuthorization(() => {
      host.entry.generation = "replacement";
    });
    await expect(host.tools.verify("fixture", new AbortController().signal)).rejects.toMatchObject({
      kind: "conflict",
    });
    expect(host.requests).toEqual([]);
  });
  it.each(["gmail", "google-drive", "google-calendar"])(
    "exposes every frozen %s operation through the shared catalog with an explicit scope mapping",
    async (service) => {
      const host = fixture(service);
      const definitions = await host.tools.definitions("fixture");
      expect(definitions.map((tool) => tool.originalName).toSorted()).toEqual(
        Object.keys(GOOGLE_CONNECTOR_OPERATION_SCOPES[service]).toSorted(),
      );
      expect(new Set(definitions.map((tool) => tool.name)).size).toBe(definitions.length);
      expect(definitions.every((tool) => tool.name.length <= 64)).toBe(true);
      expect(host.requests).toEqual([]);
    },
  );

  it("runs bounded Drive queries using daemon authorization and redacts returned credential strings before JSON encoding", async () => {
    const host = fixture();
    host.output({ files: [{ name: 'private"token' }] });
    const tool = (await host.tools.definitions("fixture")).find(
      (row) => row.originalName === "list_files",
    )!;
    const result = await tool.handler({}, {});
    expect(host.requests).toHaveLength(1);
    expect(host.requests[0].headers.get("Authorization")).toBe('Bearer private"token');
    expect(host.requests[0].url.searchParams.get("pageSize")).toBe("25");
    expect(JSON.parse(String(result.content[0].text))).toEqual({ files: [{ name: "[redacted]" }] });
  });

  it("rejects invalid inputs before authorization or vendor I/O", async () => {
    const host = fixture();
    const tool = (await host.tools.definitions("fixture")).find(
      (row) => row.originalName === "create_file",
    )!;
    expect((await tool.handler({}, {})).isError).toBe(true);
    expect(host.authorizations()).toBe(0);
    expect(host.requests).toEqual([]);
  });

  it.each(["disabled", "tool", "generation", "during-auth"])(
    "rejects live %s authority changes before vendor dispatch",
    async (kind) => {
      const host = fixture();
      const tool = (await host.tools.definitions("fixture")).find(
        (row) => row.originalName === "list_files",
      )!;
      if (kind === "disabled") host.entry.enabled = false;
      else if (kind === "tool") host.entry.disabledTools = ["list_files"];
      else if (kind === "generation") host.entry.generation = "replacement";
      else
        host.afterAuthorization(() => {
          host.entry.enabled = false;
        });
      expect((await tool.handler({}, {})).isError).toBe(true);
      expect(host.requests).toEqual([]);
    },
  );

  it.each(["gmail", "google-drive", "google-calendar"])(
    "verifies actual %s account access without enabling its tools",
    async (service) => {
      const host = fixture(service);
      host.entry.enabled = false;
      expect(
        (await host.tools.verify("fixture", new AbortController().signal)).length,
      ).toBeGreaterThan(0);
      expect(host.requests).toHaveLength(1);
      expect(host.entry.enabled).toBe(false);
    },
  );
});
