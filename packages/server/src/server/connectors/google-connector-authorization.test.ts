import { afterEach, expect, test } from "vitest";
import {
  GOOGLE_CONNECTOR_SERVICES,
  type ConnectorConfig,
} from "@otto-code/protocol/provider-config";
import type { IntegrationConnectionMetadata } from "@otto-code/protocol/integration-authorization";
import { IntegrationAuthorizationService } from "../integration-authorization/integration-authorization-service.js";
import {
  GoogleConnectorAuthorization,
  GOOGLE_CONNECTOR_INTEGRATION_ID,
} from "./google-connector-authorization.js";

const running: GoogleConnectorAuthorization[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((auth) => auth.close()));
});

function fixture() {
  const secrets = new Map<string, string>();
  const records = new Map<string, IntegrationConnectionMetadata>();
  const authorization = new IntegrationAuthorizationService({
    hostId: "test",
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
  const service = GOOGLE_CONNECTOR_SERVICES.find((entry) => entry.id === "gmail")!;
  const connectors: ConnectorConfig[] = [
    {
      id: "my-gmail",
      builtin: service.id,
      label: service.label,
      server: { type: "http", url: service.url },
    },
  ];
  const scopes = [...service.scopes, "openid", "https://www.googleapis.com/auth/userinfo.email"];
  return { authorization, secrets, records, connectors, scopes };
}

test("loopback PKCE saves only safe account status outside the vault and disconnect removes the grant", async () => {
  const f = fixture();
  const requests: URLSearchParams[] = [];
  const auth = new GoogleConnectorAuthorization({
    authorization: f.authorization,
    registration: {
      client_id: "otto.apps.googleusercontent.com",
      client_secret: "publisher-secret",
    },
    readConnectors: () => f.connectors,
    fetch: async (url, init) => {
      if (String(url).includes("/userinfo"))
        return Response.json({ email: "person@example.com", verified_email: true });
      requests.push(new URLSearchParams(String(init?.body)));
      return Response.json({
        access_token: "private-access",
        refresh_token: "private-refresh",
        expires_in: 3600,
        scope: f.scopes.join(" "),
      });
    },
  });
  running.push(auth);
  const started = await auth.start("my-gmail");
  const url = new URL(started.authorizationUrl);
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(started.authorizationUrl).not.toContain("publisher-secret");
  const callback = new URL(url.searchParams.get("redirect_uri")!);
  expect(callback.hostname).toBe("127.0.0.1");
  callback.search = new URLSearchParams({ state: "wrong", code: "example" }).toString();
  expect((await fetch(callback)).status).toBe(400);
  expect(requests).toHaveLength(0);
  callback.searchParams.set("state", url.searchParams.get("state")!);
  expect((await fetch(callback)).status).toBe(200);
  expect(requests[0].get("client_secret")).toBe("publisher-secret");
  expect(requests[0].get("code_verifier")).toBeTruthy();
  expect(await auth.accessToken("my-gmail")).toBe("private-access");
  const overview = await f.authorization.getOverview();
  expect(overview.connections[0]).toMatchObject({
    state: "connected",
    accountLabel: "person@example.com",
  });
  expect(JSON.stringify(overview)).not.toContain("private-");
  await auth.disconnect("my-gmail");
  expect(f.secrets.size).toBe(0);
  expect(f.records.size).toBe(0);
  await expect(auth.accessToken("my-gmail")).rejects.toThrow("Connect this Google account");
});

test("a refresh already in flight cannot restore a disconnected connection", async () => {
  const f = fixture();
  await f.authorization.saveOAuthTokenSet({
    integrationId: GOOGLE_CONNECTOR_INTEGRATION_ID,
    connectionId: "my-gmail",
    method: "oauth-pkce",
    tokens: {
      accessToken: "old",
      refreshToken: "refresh",
      expiresAt: "2020-01-01T00:00:00.000Z",
      grantedScopes: f.scopes,
    },
  });
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const auth = new GoogleConnectorAuthorization({
    authorization: f.authorization,
    registration: { client_id: "otto.apps.googleusercontent.com", client_secret: "secret" },
    readConnectors: () => f.connectors,
    fetch: async () => {
      entered();
      await pending;
      return Response.json({ access_token: "new", expires_in: 3600 });
    },
  });
  running.push(auth);
  const token = expect(auth.accessToken("my-gmail")).rejects.toThrow("Reconnect this account");
  await started;
  const disconnected = auth.disconnect("my-gmail");
  release();
  await token;
  await disconnected;
  expect(f.secrets.size).toBe(0);
  expect(f.records.size).toBe(0);
});
