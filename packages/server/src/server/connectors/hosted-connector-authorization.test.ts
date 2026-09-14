import { afterEach, expect, test, vi } from "vitest";
import type { ConnectorConfig } from "@otto-code/protocol/provider-config";
import type { IntegrationConnectionMetadata } from "@otto-code/protocol/integration-authorization";
import { IntegrationAuthorizationService } from "../integration-authorization/integration-authorization-service.js";
import {
  HostedConnectorAuthorization,
  setHostedConnectorAuthorization,
} from "./hosted-connector-authorization.js";
import { ConnectorOAuthBroker, createConnectorAuthProvider } from "./connector-oauth.js";
import { createMemoryConnectorAuthStore } from "./connector-auth-store.js";

const active: HostedConnectorAuthorization[] = [];
afterEach(async () => {
  await Promise.all(active.splice(0).map((auth) => auth.close()));
  setHostedConnectorAuthorization(undefined);
});

function fixture(vendorId = "box", origin: string | null = "https://auth.example") {
  const secrets = new Map<string, string>();
  const records = new Map<string, IntegrationConnectionMetadata>();
  const authorization = new IntegrationAuthorizationService({
    hostId: "host-a",
    vault: {
      getAvailability: async () => ({ status: "available", backend: "test" }),
      get: async (key) => secrets.get(key.connectionId) ?? null,
      put: async (key, value) => {
        secrets.set(key.connectionId, value);
      },
      delete: async (key) => secrets.delete(key.connectionId),
    },
    registry: {
      initialize: async () => {},
      list: async () => [...records.values()],
      get: async (key) => records.get(key.connectionId) ?? null,
      upsert: async (record) => {
        records.set(record.connectionId, record);
      },
      remove: async (key) => {
        records.delete(key.connectionId);
      },
    },
  });
  const connectors: ConnectorConfig[] = [
    { id: vendorId, label: vendorId, server: { type: "http", url: `https://mcp.${vendorId}.com` } },
  ];
  const store = createMemoryConnectorAuthStore();
  const originalWrite = store.write;
  store.write = (id, value) => {
    originalWrite(id, value);
    connectors[0].auth = value ?? undefined;
  };
  const tokens = {
    accessToken: "secret-access",
    refreshToken: "secret-refresh",
    expiresAt: Date.now() + 3600_000,
    scopes: ["root_readwrite", "ai.readwrite"],
  };
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    if (String(url).endsWith("/v1/grants"))
      return Response.json({
        grantId: "a".repeat(64),
        authorizationUrl: `${origin ?? "https://auth.otto-code.me"}/v1/grants/${"a".repeat(64)}/authorize`,
      });
    return Response.json({ tokens });
  });
  const auth = new HostedConnectorAuthorization({
    authorization,
    store,
    readConnectors: () => connectors,
    ...(origin === null ? {} : { origin }),
    fetcher,
    pollMs: 1,
  });
  active.push(auth);
  setHostedConnectorAuthorization(auth);
  return { auth, authorization, secrets, records, store, connectors, tokens, fetcher };
}

test("ordinary hosts use the deployed publisher service; an explicit empty override disables sign-in", async () => {
  const f = fixture("hubspot", null);
  expect(f.auth.configured).toBe(true);
  await f.auth.start("hubspot");
  await f.auth.waitForCompletion("hubspot");
  expect(f.fetcher.mock.calls[0][0]).toBe("https://auth.otto-code.me/v1/grants");
  await f.auth.disconnect("hubspot");
  const disabled = fixture("hubspot", "");
  expect(disabled.auth.configured).toBe(false);
  await expect(disabled.auth.start("hubspot")).rejects.toThrow("not enabled");
  expect(disabled.fetcher).not.toHaveBeenCalled();
});

test.each(["box", "hubspot"])(
  "%s broker and MCP provider use hosted auth; credentials never enter config or overview",
  async (vendorId) => {
    const f = fixture(vendorId);
    const broker = new ConnectorOAuthBroker({ store: f.store });
    expect(
      await broker.beginAuthorization({ connector: f.connectors[0], scope: "attacker-scope" }),
    ).toMatchObject({ status: "redirect" });
    await broker.waitForCompletion(vendorId);
    expect(f.connectors[0].auth).toMatchObject({ hosted: { connected: true, vendorId } });
    expect(JSON.parse(String(f.fetcher.mock.calls[0][1]?.body)).vendorId).toBe(vendorId);
    expect(f.connectors[0].auth?.tokens).toBeUndefined();
    expect(JSON.stringify(await f.authorization.getOverview())).not.toContain("secret-");
    expect(JSON.stringify(f.connectors)).not.toContain("secret-");
    const provider = createConnectorAuthProvider({ connector: f.connectors[0], store: f.store })!;
    expect(await provider.tokens()).toEqual({
      access_token: "secret-access",
      token_type: "Bearer",
    });
    expect(JSON.stringify(f.fetcher.mock.calls)).not.toContain("attacker-scope");
    expect(f.secrets.size).toBe(1);
    await broker.disconnect(vendorId);
    expect(f.secrets.size).toBe(0);
    await expect(provider.tokens()).rejects.toThrow("Connect this account");
  },
);

test("concurrent MCP users renew once; a disconnect racing renewal cannot return the new token", async () => {
  const f = fixture();
  await f.auth.start("box");
  await f.auth.waitForCompletion("box");
  const value = JSON.parse(f.secrets.get("box")!);
  value.tokens.expiresAt = 1;
  f.secrets.set("box", JSON.stringify(value));
  const provider = f.auth.provider(f.connectors[0]);
  const before = f.fetcher.mock.calls.length;
  await Promise.all([provider.tokens(), provider.tokens()]);
  expect(f.fetcher).toHaveBeenCalledTimes(before + 1);
  f.secrets.set("box", JSON.stringify(value));
  let release!: (response: Response) => void;
  f.fetcher.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const renewing = provider.tokens();
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  const stopped = f.auth.disconnect("box");
  release(Response.json({ tokens: f.tokens }));
  await expect(renewing).rejects.toThrow();
  await stopped;
  expect(f.secrets.size).toBe(0);
  expect(f.connectors[0].auth).toBeUndefined();
});

test("cannot send tokens to a changed endpoint and reports failed revocation honestly", async () => {
  const f = fixture();
  await f.auth.start("box");
  await f.auth.waitForCompletion("box");
  const provider = f.auth.provider(f.connectors[0]);
  f.connectors[0].server = { type: "http", url: "https://attacker.example" };
  await expect(provider.tokens()).rejects.toThrow("endpoint changed");
  f.connectors[0].server = { type: "http", url: "https://mcp.box.com" };
  f.fetcher.mockRejectedValue(new Error("secret-vendor-response"));
  await expect(f.auth.disconnect("box")).rejects.toThrow(
    "Vendor revocation could not be confirmed",
  );
  expect(f.secrets.size).toBe(0);
});

test("service errors are redacted and never retried after collection could have consumed a code", async () => {
  const f = fixture();
  f.fetcher.mockImplementation(async (url) =>
    String(url).endsWith("/v1/grants")
      ? Response.json({
          grantId: "a".repeat(64),
          authorizationUrl: `https://auth.example/v1/grants/${"a".repeat(64)}/authorize`,
        })
      : new Response("secret-vendor-payload", { status: 502 }),
  );
  await f.auth.start("box");
  await expect(f.auth.waitForCompletion("box")).rejects.toThrow("Sign-in did not finish");
  expect(f.fetcher).toHaveBeenCalledTimes(2);
  expect(f.secrets.size).toBe(0);
});

test("disconnect cancels the service grant while browser consent is still pending", async () => {
  const f = fixture();
  await f.auth.start("box");
  const completion = f.auth.waitForCompletion("box");
  await f.auth.disconnect("box");
  await expect(completion).rejects.toThrow("Sign-in did not finish");
  const revoke = f.fetcher.mock.calls.find(([url]) => String(url).endsWith("/revoke"));
  expect(revoke).toBeDefined();
  expect(new Headers(revoke![1]?.headers).get("authorization")).toMatch(/^Bearer [\w-]{43}$/);
  expect(f.secrets.size).toBe(0);
  expect(f.connectors[0].auth).toBeUndefined();
});
