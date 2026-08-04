// Connector credentials must not ride the wire, and a client must not be able to
// author one. Both properties were absent before OAuth landed: `connectors` is
// an array, and the redaction pass only understood dotted paths, so every token
// a user pasted was echoed back in the config payload.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  DaemonConfigStore,
  DAEMON_CONFIG_SECRET_SENTINEL,
  redactDaemonConfigForClient,
} from "../daemon-config-store.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createStore(): DaemonConfigStore {
  const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-connector-secrets-"));
  tempDirs.push(ottoHome);
  return new DaemonConfigStore(
    ottoHome,
    {
      mcp: { injectIntoAgents: false },
      browserTools: { enabled: false },
      providers: {},
      metadataGeneration: { providers: [] },
      autoArchiveAfterMerge: false,
      enableTerminalAgentHooks: false,
      appendSystemPrompt: "",
    },
    undefined,
  );
}

describe("connector secret redaction", () => {
  test("masks a stdio connector's env values on the way to a client", () => {
    const store = createStore();
    store.patch({
      connectors: [
        {
          id: "acme",
          server: {
            type: "stdio",
            command: "npx",
            args: ["-y", "@acme/mcp"],
            env: { ACME_TOKEN: "super-secret-value" },
          },
        },
      ],
    });

    const wire = redactDaemonConfigForClient(store.get());
    const server = wire.connectors[0]?.server;
    expect(server?.type).toBe("stdio");
    if (server?.type !== "stdio") {
      throw new Error("expected a stdio connector");
    }
    expect(server.env?.ACME_TOKEN).toBe(DAEMON_CONFIG_SECRET_SENTINEL);
    expect(JSON.stringify(wire)).not.toContain("super-secret-value");
  });

  test("masks an http connector's Authorization header", () => {
    const store = createStore();
    store.patch({
      connectors: [
        {
          id: "remote",
          server: {
            type: "http",
            url: "https://mcp.example.com",
            headers: { Authorization: "Bearer secret-bearer-token" },
          },
        },
      ],
    });

    const wire = redactDaemonConfigForClient(store.get());
    expect(JSON.stringify(wire)).not.toContain("secret-bearer-token");
  });

  test("restores a masked env value when the client saves the config back", () => {
    const store = createStore();
    store.patch({
      connectors: [
        {
          id: "acme",
          server: { type: "stdio", command: "npx", env: { ACME_TOKEN: "original-secret" } },
        },
      ],
    });

    // Exactly what a client does: read the redacted config, change something
    // unrelated, send the whole array back with the sentinel still in place.
    const wire = redactDaemonConfigForClient(store.get());
    const echoed = structuredClone(wire.connectors);
    echoed[0]!.label = "Renamed";
    store.patch({ connectors: echoed });

    const stored = store.get().connectors[0]?.server;
    if (stored?.type !== "stdio") {
      throw new Error("expected a stdio connector");
    }
    expect(stored.env?.ACME_TOKEN).toBe("original-secret");
    expect(store.get().connectors[0]?.label).toBe("Renamed");
  });
});

describe("connector authorization ownership", () => {
  test("never sends OAuth tokens to a client, only that one exists", () => {
    const store = createStore();
    store.patch({
      connectors: [{ id: "linear", server: { type: "http", url: "https://mcp.linear.app/mcp" } }],
    });
    store.setConnectorAuth("linear", {
      kind: "oauth",
      tokens: { accessToken: "access-abc", refreshToken: "refresh-xyz" },
      account: "someone@example.com",
    });

    const wire = redactDaemonConfigForClient(store.get());
    const serialized = JSON.stringify(wire);
    expect(serialized).not.toContain("access-abc");
    expect(serialized).not.toContain("refresh-xyz");
    // The label survives: the UI has to be able to say who is connected.
    expect(wire.connectors[0]?.auth?.account).toBe("someone@example.com");
    expect(wire.connectors[0]?.auth?.tokens?.accessToken).toBe(DAEMON_CONFIG_SECRET_SENTINEL);
  });

  test("a client cannot mint an authorization by saving config", () => {
    const store = createStore();
    store.patch({
      connectors: [{ id: "linear", server: { type: "http", url: "https://mcp.linear.app/mcp" } }],
    });

    store.patch({
      connectors: [
        {
          id: "linear",
          server: { type: "http", url: "https://mcp.linear.app/mcp" },
          auth: { kind: "oauth", tokens: { accessToken: "forged-token" } },
        },
      ],
    });

    expect(store.get().connectors[0]?.auth).toBeUndefined();
  });

  test("a client cannot clear an authorization by saving config", () => {
    const store = createStore();
    store.patch({
      connectors: [{ id: "linear", server: { type: "http", url: "https://mcp.linear.app/mcp" } }],
    });
    store.setConnectorAuth("linear", {
      kind: "oauth",
      tokens: { accessToken: "real-token" },
    });

    // A client echoing back the redacted config must not log the user out.
    store.patch({
      connectors: [
        {
          id: "linear",
          label: "Linear",
          server: { type: "http", url: "https://mcp.linear.app/mcp" },
        },
      ],
    });

    expect(store.get().connectors[0]?.auth?.tokens?.accessToken).toBe("real-token");
  });

  test("disconnect clears the stored authorization", () => {
    const store = createStore();
    store.patch({
      connectors: [{ id: "linear", server: { type: "http", url: "https://mcp.linear.app/mcp" } }],
    });
    store.setConnectorAuth("linear", { kind: "oauth", tokens: { accessToken: "real-token" } });
    store.setConnectorAuth("linear", null);

    expect(store.get().connectors[0]?.auth).toBeUndefined();
  });

  test("an authorization for an unknown connector is dropped, not resurrected", () => {
    const store = createStore();
    store.setConnectorAuth("deleted-connector", {
      kind: "oauth",
      tokens: { accessToken: "orphan" },
    });

    expect(store.get().connectors).toHaveLength(0);
  });
});
