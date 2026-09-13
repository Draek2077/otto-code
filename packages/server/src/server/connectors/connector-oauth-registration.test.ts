import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { ConnectorOAuthBroker, createConnectorAuthProvider } from "./connector-oauth.js";
import { createMemoryConnectorAuthStore } from "./connector-auth-store.js";
import {
  getConnectorOAuthRegistration,
  DROPBOX_OAUTH_REGISTRATION,
  SLACK_OAUTH_REGISTRATION,
} from "./connector-oauth-registration.js";
import * as registrations from "./connector-oauth-registration.js";

const registration = { ...SLACK_OAUTH_REGISTRATION };
const connector = { id: "slack", server: { type: "http" as const, url: registration.serverUrl } };
const nativeFetch = globalThis.fetch;
const brokers: ConnectorOAuthBroker[] = [];
const servers: Server[] = [];
const resolveRegistration = getConnectorOAuthRegistration;

beforeEach(async () => {
  Object.assign(registration, SLACK_OAUTH_REGISTRATION, { authorizationParams: undefined });
  // Never bind the real sign-in port: the user may be authorizing another app.
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP listener");
  registration.redirectUri = `http://127.0.0.1:${address.port}/connectors/oauth/callback`;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  vi.spyOn(registrations, "getConnectorOAuthRegistration").mockImplementation((candidate) =>
    resolveRegistration(candidate) ? registration : undefined,
  );
});

afterEach(async () => {
  for (const broker of brokers.splice(0)) broker.closeAll();
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fixture(options: { wrongTokenEndpoint?: boolean; dcr?: boolean } = {}) {
  const tokenRequests: URLSearchParams[] = [];
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("/.well-known/oauth-protected-resource"))
        return Response.json({
          resource: options.dcr ? "https://example.test/mcp" : registration.serverUrl,
          authorization_servers: [registration.authorizationServerUrl],
          scopes_supported: [...registration.scopes, "unapproved:scope"],
        });
      if (url.includes("/.well-known/oauth-authorization-server"))
        return Response.json({
          issuer: registration.authorizationServerUrl,
          authorization_endpoint: registration.authorizationEndpoint,
          token_endpoint: options.wrongTokenEndpoint
            ? "https://other.example/token"
            : registration.tokenEndpoint,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["client_secret_post"],
          code_challenge_methods_supported: ["S256"],
          ...(options.dcr ? { registration_endpoint: "https://example.test/register" } : {}),
        });
      if (url === "https://example.test/register") {
        return Response.json({ ...JSON.parse(String(init?.body)), client_id: "dynamic-client" });
      }
      if (url === registration.tokenEndpoint) {
        const params = new URLSearchParams(String(init?.body));
        tokenRequests.push(params);
        return Response.json({
          access_token: `access-${tokenRequests.length}`,
          refresh_token: `refresh-${tokenRequests.length}`,
          token_type: "Bearer",
          expires_in: 3600,
          scope: registration.scopes.join(" "),
        });
      }
      throw new Error(`Unexpected OAuth request: ${url}`);
    }),
  );
  const store = createMemoryConnectorAuthStore();
  const broker = new ConnectorOAuthBroker({ store });
  brokers.push(broker);
  return { store, broker, requests, tokenRequests };
}

async function start(broker: ConnectorOAuthBroker) {
  const result = await broker.beginAuthorization({ connector, scope: "caller:scope" });
  expect(result.status).toBe("redirect");
  if (result.status !== "redirect") throw new Error("Expected browser sign-in");
  return new URL(result.authorizationUrl);
}

async function complete(broker: ConnectorOAuthBroker, url: URL, connectorId = connector.id) {
  const callback = new URL(url.searchParams.get("redirect_uri")!);
  callback.searchParams.set("state", url.searchParams.get("state")!);
  callback.searchParams.set("code", "test-authorization-code");
  const response = await nativeFetch(callback);
  expect(response.status).toBe(200);
  await response.text();
  await broker.waitForCompletion(connectorId);
}

test("matches the exact HTTP endpoint, never a connector name or lookalike URL", () => {
  expect(getConnectorOAuthRegistration({ ...connector, id: "renamed" })).toBe(registration);
  for (const url of [
    "https://mcp.slack.com.evil.example/mcp",
    "https://example.com/mcp",
    "http://mcp.slack.com/mcp",
    `${registration.serverUrl}?other=1`,
  ]) {
    expect(
      getConnectorOAuthRegistration({ ...connector, server: { type: "http", url } }),
    ).toBeUndefined();
  }
  expect(
    getConnectorOAuthRegistration({
      ...connector,
      server: { type: "sse", url: registration.serverUrl },
    }),
  ).toBeUndefined();
});

test("ordinary connectors still register dynamically and use their requested scope", async () => {
  const { broker, requests } = fixture({ dcr: true });
  const result = await broker.beginAuthorization({
    connector: { id: "ordinary", server: { type: "http", url: "https://example.test/mcp" } },
    scope: "ordinary:read",
  });
  expect(result.status).toBe("redirect");
  if (result.status !== "redirect") throw new Error("Expected browser sign-in");
  const url = new URL(result.authorizationUrl);
  expect(url.searchParams.get("client_id")).toBe("dynamic-client");
  expect(url.searchParams.get("scope")).toBe("ordinary:read");
  expect(requests).toContain("https://example.test/register");
  await complete(broker, url, "ordinary");
});

test("fresh Slack sign-in skips DCR, uses approved scopes and PKCE, and silently rotates tokens", async () => {
  const { broker, store, requests, tokenRequests } = fixture();
  const url = await start(broker);
  expect(url.origin + url.pathname).toBe(registration.authorizationEndpoint);
  expect(url.searchParams.get("client_id")).toBe(registration.clientId);
  expect(url.searchParams.get("redirect_uri")).toBe(registration.redirectUri);
  expect(url.searchParams.get("scope")).toBe(registration.scopes.join(" "));
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  await complete(broker, url);
  const exchange = tokenRequests[0]!;
  expect(exchange.get("client_id")).toBe(registration.clientId);
  expect(exchange.has("client_secret")).toBe(false);
  expect(createHash("sha256").update(exchange.get("code_verifier")!).digest("base64url")).toBe(
    url.searchParams.get("code_challenge"),
  );
  expect(store.read(connector.id)).toMatchObject({
    resourceUrl: registration.serverUrl,
    client: { clientId: registration.clientId, redirectUri: registration.redirectUri },
    tokens: { accessToken: "access-1", refreshToken: "refresh-1" },
  });
  const provider = createConnectorAuthProvider({ connector, store })!;
  expect(await auth(provider, { serverUrl: registration.serverUrl })).toBe("AUTHORIZED");
  expect(tokenRequests[1]!.get("grant_type")).toBe("refresh_token");
  expect(tokenRequests[1]!.get("refresh_token")).toBe("refresh-1");
  expect(tokenRequests[1]!.has("client_secret")).toBe(false);
  expect(store.read(connector.id)?.tokens?.refreshToken).toBe("refresh-2");
  expect(requests.some((request) => request.endsWith("/register"))).toBe(false);
});

test("rejects changed authorization endpoints before exposing a code or refresh token", async () => {
  const { broker, tokenRequests } = fixture({ wrongTokenEndpoint: true });
  await expect(start(broker)).rejects.toThrow("authorization endpoints no longer match");
  expect(tokenRequests).toHaveLength(0);
});

test("Dropbox uses its registered app with PKCE and offline access, then refreshes without a secret", async () => {
  const redirectUri = registration.redirectUri;
  Object.assign(registration, DROPBOX_OAUTH_REGISTRATION, { redirectUri });
  const dropbox = { id: "dropbox", server: { type: "http" as const, url: registration.serverUrl } };
  const { broker, store, requests, tokenRequests } = fixture();
  const result = await broker.beginAuthorization({ connector: dropbox });
  if (result.status !== "redirect") throw new Error("Expected Dropbox consent");
  const url = new URL(result.authorizationUrl);
  expect(url.origin + url.pathname).toBe(registration.authorizationEndpoint);
  expect(url.searchParams.get("client_id")).toBe(registration.clientId);
  expect(url.searchParams.get("token_access_type")).toBe("offline");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("scope")).toBe(registration.scopes.join(" "));
  await complete(broker, url, dropbox.id);
  expect(tokenRequests[0]!.has("client_secret")).toBe(false);
  expect(
    createHash("sha256").update(tokenRequests[0]!.get("code_verifier")!).digest("base64url"),
  ).toBe(url.searchParams.get("code_challenge"));
  const provider = createConnectorAuthProvider({ connector: dropbox, store })!;
  expect(await auth(provider, { serverUrl: registration.serverUrl })).toBe("AUTHORIZED");
  expect(tokenRequests[1]!.get("grant_type")).toBe("refresh_token");
  expect(tokenRequests[1]!.has("client_secret")).toBe(false);
  expect(store.read(dropbox.id)?.tokens?.refreshToken).toBe("refresh-2");
  expect(requests.some((request) => request.endsWith("/register"))).toBe(false);
});

test("never refreshes credentials belonging to another Slack client", async () => {
  const { broker, store, tokenRequests } = fixture();
  store.write(connector.id, {
    kind: "oauth",
    resourceUrl: registration.serverUrl,
    client: {
      clientId: "another-app",
      clientSecret: "another-secret",
      redirectUri: registration.redirectUri,
    },
    tokens: { accessToken: "foreign-access", refreshToken: "foreign-refresh" },
  });
  const url = await start(broker);
  expect(tokenRequests).toHaveLength(0);
  await complete(broker, url);
  expect(store.read(connector.id)?.client?.clientSecret).toBeUndefined();
  expect(tokenRequests[0]!.get("client_id")).toBe(registration.clientId);
});

test("a replaced callback cannot cancel the newer registered-client sign-in", async () => {
  const { broker, tokenRequests } = fixture();
  const first = await start(broker);
  const second = await start(broker);
  const stale = new URL(registration.redirectUri);
  stale.searchParams.set("state", first.searchParams.get("state")!);
  stale.searchParams.set("code", "stale-code");
  expect((await nativeFetch(stale)).status).toBe(400);
  expect(tokenRequests).toHaveLength(0);
  await complete(broker, second);
});

test("a registered callback port collision never falls back to an unregistered port", async () => {
  const occupied = createServer();
  await new Promise<void>((resolve, reject) => {
    occupied.once("error", reject);
    occupied.listen(Number(new URL(registration.redirectUri).port), "127.0.0.1", resolve);
  });
  servers.push(occupied);
  const { broker, requests } = fixture();
  await expect(start(broker)).rejects.toThrow(
    `sign-in port ${new URL(registration.redirectUri).port} is in use`,
  );
  expect(requests).toHaveLength(0);
});
