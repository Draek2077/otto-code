import { describe, expect, it } from "vitest";
import { ConnectorStore } from "./store.js";
import { IntegrationAuthorizationSecrets } from "../integrations/authorization-secrets.js";
import {
  IntegrationRegistryConflictError,
  type IntegrationRegistry,
  type IntegrationRegistrySnapshot,
} from "../integrations/registry.js";
import type { CredentialVault } from "../integrations/credential-vault.js";

function memoryRegistry() {
  let sequence = 0;
  let snapshot: IntegrationRegistrySnapshot = {
    revision: "0",
    connections: { futureIntegration: { preserved: true } },
  };
  let unknownOutcome = false;
  const registry: IntegrationRegistry = {
    read: async () => structuredClone(snapshot),
    update: async (input) => {
      if (snapshot.revision !== input.expectedRevision)
        throw new IntegrationRegistryConflictError();
      snapshot = {
        revision: String(++sequence),
        connections: { ...snapshot.connections, [input.integrationId]: input.value },
      };
      if (unknownOutcome) throw new Error("private filesystem detail");
      return structuredClone(snapshot);
    },
  };
  return {
    registry,
    snapshot: () => snapshot,
    failAfterPublication() {
      unknownOutcome = true;
    },
  };
}
function fixture(records: unknown[] = []) {
  let legacy = JSON.stringify({ connectors: records, unrelated: { retained: true } });
  let opens = 0;
  let onPut: (() => void) | null = null;
  const values = new Map<string, string>();
  const vault: CredentialVault = {
    get: async (key) => values.get(JSON.stringify(key)) ?? null,
    put: async (key, value) => {
      onPut?.();
      values.set(JSON.stringify(key), value);
    },
    delete: async (key) => values.delete(JSON.stringify(key)),
  };
  const config = memoryRegistry();
  const grants = memoryRegistry();
  const authorization = new IntegrationAuthorizationSecrets({
    hostId: "fixture-host",
    registry: grants.registry,
    vault: async () => {
      opens++;
      return vault;
    },
  });
  const store = new ConnectorStore({
    registry: config.registry,
    authorization,
    legacy: async () => legacy,
  });
  return {
    store,
    config,
    values,
    opens: () => opens,
    legacy: () => legacy,
    changeLegacy(value: string) {
      legacy = value;
    },
    onPut(value: () => void) {
      onPut = value;
    },
  };
}
const custom = {
  kind: "custom" as const,
  oauth: false,
  scope: "",
  server: {
    type: "http" as const,
    url: "https://fixture.invalid/mcp?key=private-query",
    headers: { Authorization: "Bearer private-header" },
  },
};
const legacyConnector = {
  id: "old-connector",
  label: "Existing",
  server: {
    type: "stdio",
    command: "fixture-command",
    args: ["private-argument"],
    env: { TOKEN: "private-environment" },
  },
  enabled: false,
  disabledTools: ["write"],
  workspaces: { preserved: { enabled: false } },
  auth: { kind: "oauth", tokens: { accessToken: "private-access" } },
  unknown: { preserve: true },
};

describe("host Connector configuration and preserved setups", () => {
  it("quarantines invalid and duplicate legacy records without blocking valid connectors", async () => {
    const host = fixture([
      legacyConnector,
      { id: "invalid", server: { type: "unknown", token: "private-corruption" } },
      { ...legacyConnector, id: "duplicate" },
      { ...legacyConnector, id: "duplicate", label: "Other" },
      null,
    ]);
    const original = host.legacy();
    const read = await host.store.read();
    expect(read.connectors).toHaveLength(4);
    expect(read.connectors.filter((row) => row.server.type === "unavailable")).toHaveLength(3);
    expect(JSON.stringify(read)).not.toContain("private-corruption");
    await expect(host.store.open("duplicate")).rejects.toMatchObject({ kind: "unavailable" });
    await host.store.save({
      id: "invalid",
      label: "Repaired",
      setup: custom,
      expectedRevision: read.revision,
    });
    expect((await host.store.open("invalid")).bundle.server).toEqual(custom.server);
    await host.store.remove("duplicate", (await host.store.read()).revision);
    expect((await host.store.open(legacyConnector.id)).entry.id).toBe(legacyConnector.id);
    expect(host.legacy()).toBe(original);
  });

  it("keeps schemas daemon-owned and sends tool summaries only for the requested connector", async () => {
    const host = fixture();
    const id = await host.store.save({
      label: "Tools",
      setup: custom,
      expectedRevision: (await host.store.read()).revision,
    });
    await host.store.update({
      id,
      expectedRevision: (await host.store.read()).revision,
      patch: {
        verification: {
          state: "verified",
          checkedAt: "2026-10-30T00:00:00.000Z",
          fingerprint: "proof",
          message: null,
          tools: [
            {
              name: "read",
              description: "Read a page",
              inputSchema: {
                type: "object",
                properties: { privateSchemaMarker: { type: "string" } },
              },
              readOnly: true,
            },
          ],
        },
      },
    });
    const list = await host.store.read();
    expect(list.connectors[0].verification).toMatchObject({ toolCount: 1, tools: [] });
    const detail = await host.store.read(id);
    expect(detail.detail?.verification.tools).toEqual([
      { name: "read", description: "Read a page", readOnly: true },
    ]);
    expect(JSON.stringify(detail)).not.toContain("privateSchemaMarker");
    expect((await host.store.open(id)).entry.verification.tools[0].inputSchema).toHaveProperty(
      "properties",
    );
  });
  it("is inert and reads an empty registry without opening the vault", async () => {
    const host = fixture();
    expect((await host.store.read()).connectors).toEqual([]);
    expect(host.opens()).toBe(0);
  });

  it("projects preserved settings without returning secrets or editing their original bytes", async () => {
    const host = fixture([legacyConnector]);
    const original = host.legacy();
    const read = await host.store.read();
    expect(read.connectors[0]).toMatchObject({
      id: legacyConnector.id,
      label: "Existing",
      enabled: false,
      disabledTools: ["write"],
    });
    expect(JSON.stringify(read)).not.toMatch(/private-(?:access|argument|environment)/);
    expect((await host.store.open(legacyConnector.id)).bundle.legacy).toEqual(legacyConnector);
    expect(host.legacy()).toBe(original);
    expect(host.opens()).toBe(0);
  });

  it("keeps a newly saved connector disabled and unverified until actual admission", async () => {
    const host = fixture();
    const before = await host.store.read();
    const id = await host.store.save({
      expectedRevision: before.revision,
      label: "Private",
      setup: custom,
    });
    const read = await host.store.read();
    expect(read.connectors[0]).toMatchObject({
      id,
      enabled: false,
      verification: { state: "unverified", tools: [] },
    });
    expect(JSON.stringify(read)).not.toMatch(/private-query|private-header/);
    expect(JSON.stringify(host.config.snapshot())).not.toMatch(/private-query|private-header/);
    expect((await host.store.open(id)).bundle.server).toEqual(custom.server);
  });

  it("rejects stale settings before any credential write", async () => {
    const host = fixture();
    await expect(
      host.store.save({ expectedRevision: "stale", label: "Private", setup: custom }),
    ).rejects.toMatchObject({ kind: "conflict" });
    expect(host.opens()).toBe(0);
    expect(host.values.size).toBe(0);
  });

  it("materializes an explicitly edited legacy connector while retaining unknown fields and the original file", async () => {
    const host = fixture([legacyConnector]);
    const original = host.legacy();
    const before = await host.store.read();
    await host.store.update({
      id: legacyConnector.id,
      expectedRevision: before.revision,
      patch: { enabled: true },
    });
    expect((await host.store.read()).connectors[0].enabled).toBe(true);
    expect((await host.store.open(legacyConnector.id)).bundle.legacy).toEqual(legacyConnector);
    expect(host.legacy()).toBe(original);
    expect(host.config.snapshot().connections.futureIntegration).toEqual({ preserved: true });
  });

  it("keeps removed legacy connectors removed without destroying the preserved settings", async () => {
    const host = fixture([legacyConnector]);
    const original = host.legacy();
    await host.store.remove(legacyConnector.id, (await host.store.read()).revision);
    expect((await host.store.read()).connectors).toEqual([]);
    expect(host.legacy()).toBe(original);
    host.changeLegacy(
      JSON.stringify({ connectors: [{ ...legacyConnector, label: "Changed externally" }] }),
    );
    expect((await host.store.read()).connectors).toEqual([]);
  });

  it("detects preserved-file edits during vault work and retires only the unpublished generation", async () => {
    const host = fixture();
    const before = await host.store.read();
    host.onPut(() => host.changeLegacy(JSON.stringify({ connectors: [legacyConnector] })));
    await expect(
      host.store.save({ expectedRevision: before.revision, label: "Private", setup: custom }),
    ).rejects.toMatchObject({ kind: "conflict" });
    expect((await host.store.read()).connectors.map((row) => row.id)).toEqual([legacyConnector.id]);
    expect(host.values.size).toBe(0);
  });

  it("preserves a published bundle after an unknown configuration outcome", async () => {
    const host = fixture();
    host.config.failAfterPublication();
    await expect(
      host.store.save({
        expectedRevision: (await host.store.read()).revision,
        label: "Private",
        setup: custom,
      }),
    ).rejects.toMatchObject({ kind: "uncertain" });
    const read = await host.store.read();
    expect(read.connectors).toHaveLength(1);
    expect((await host.store.open(read.connectors[0].id)).bundle.server).toEqual(custom.server);
    expect(host.values.size).toBe(1);
  });

  it("replaces transport authority using a new generation and rejects a late old-generation grant", async () => {
    const host = fixture();
    const id = await host.store.save({
      expectedRevision: (await host.store.read()).revision,
      label: "Private",
      setup: custom,
    });
    const original = await host.store.open(id);
    const version = await host.store.readBundleVersion(original.entry);
    await host.store.save({
      id,
      expectedRevision: original.revision,
      label: "Changed",
      setup: { ...custom, server: { ...custom.server, url: "https://different.invalid/mcp" } },
    });
    await expect(
      host.store.writeBundle(original.entry, version.revision, {
        ...original.bundle,
        authorization: { tokens: "late" },
      }),
    ).rejects.toMatchObject({ kind: "conflict" });
    expect((await host.store.read()).connectors[0]).toMatchObject({
      label: "Changed",
      enabled: false,
      verification: { state: "unverified" },
    });
    expect(host.values.size).toBe(1);
  });

  it("keeps ordinary token refresh out of the user-settings revision domain", async () => {
    const host = fixture();
    const id = await host.store.save({
      expectedRevision: (await host.store.read()).revision,
      label: "Private",
      setup: custom,
    });
    const current = await host.store.open(id);
    const grant = await host.store.readBundleVersion(current.entry);
    await host.store.writeBundle(current.entry, grant.revision, {
      ...current.bundle,
      authorization: { tokens: { accessToken: "refreshed-private-token" } },
    });
    expect((await host.store.read()).revision).toBe(current.revision);
    expect(JSON.stringify(await host.store.read())).not.toContain("refreshed-private-token");
  });

  it("does not overwrite a lazily refreshed legacy grant when its settings are first edited", async () => {
    const host = fixture([legacyConnector]);
    const original = await host.store.open(legacyConnector.id);
    const grant = await host.store.readBundleVersion(original.entry);
    await host.store.writeBundle(original.entry, grant.revision, {
      ...original.bundle,
      authorization: { tokens: { accessToken: "renewed" } },
    });
    await host.store.update({
      id: legacyConnector.id,
      expectedRevision: original.revision,
      patch: { enabled: true },
    });
    expect((await host.store.open(legacyConnector.id)).bundle.authorization).toEqual({
      tokens: { accessToken: "renewed" },
    });
    expect(host.legacy()).toContain("private-access");
  });

  it("supports old IDs matching object property names through explicit map identity", async () => {
    const host = fixture([{ ...legacyConnector, id: "constructor" }]);
    const initial = await host.store.read();
    expect(initial.connectors[0].id).toBe("constructor");
    await host.store.update({
      id: "constructor",
      expectedRevision: initial.revision,
      patch: { enabled: true },
    });
    expect((await host.store.open("constructor")).entry.enabled).toBe(true);
  });
});
