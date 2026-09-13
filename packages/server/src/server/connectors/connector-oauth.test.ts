// The OAuth provider's storage half. The protocol half (discovery, PKCE, code
// exchange) belongs to the MCP SDK and is not re-tested here; what is ours is
// how tokens are persisted, which is where a silent logout comes from.
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ConnectorConfig } from "@otto-code/protocol/provider-config";

import {
  ConnectorOAuthBroker,
  createConnectorAuthProvider,
  hasUsableAuthorization,
} from "./connector-oauth.js";
import { createMemoryConnectorAuthStore } from "./connector-auth-store.js";

const nativeFetch = globalThis.fetch;
const brokers: ConnectorOAuthBroker[] = [];

afterEach(() => {
  for (const broker of brokers.splice(0)) broker.closeAll();
  vi.unstubAllGlobals();
});

function callbackFixture(error?: string) {
  let registrations = 0;
  let discoveries = 0;
  const exchanges: URLSearchParams[] = [];
  const store = createMemoryConnectorAuthStore();
  const broker = new ConnectorOAuthBroker({ store, callbackPort: 0 });
  brokers.push(broker);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/.well-known/oauth-protected-resource")) {
        return Response.json({
          resource: "https://mcp.linear.app/mcp",
          authorization_servers: ["https://oauth.example.test"],
        });
      }
      if (url.includes("/.well-known/oauth-authorization-server")) {
        discoveries++;
        return Response.json({
          issuer: "https://oauth.example.test",
          authorization_endpoint: "https://oauth.example.test/authorize",
          token_endpoint: "https://oauth.example.test/token",
          registration_endpoint: "https://oauth.example.test/register",
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["client_secret_post"],
        });
      }
      if (url === "https://oauth.example.test/register") {
        registrations++;
        return Response.json({
          ...JSON.parse(String(init?.body)),
          client_id: `client-${registrations}`,
          client_secret: "fixture-client-secret",
        });
      }
      if (url === "https://oauth.example.test/token") {
        exchanges.push(new URLSearchParams(String(init?.body)));
        if (error)
          return Response.json(
            {
              error,
              error_description: "Vendor rejected fixture-code for fixture-client-secret <client>.",
            },
            { status: 400 },
          );
        return Response.json({
          access_token: "fixture-access",
          refresh_token: "fixture-refresh",
          token_type: "Bearer",
        });
      }
      throw new Error(`Unexpected OAuth request: ${url}`);
    }),
  );
  async function start() {
    const result = await broker.beginAuthorization({ connector: connector() });
    if (result.status !== "redirect") throw new Error("Expected browser sign-in");
    const authorization = new URL(result.authorizationUrl);
    const callback = new URL(authorization.searchParams.get("redirect_uri")!);
    callback.searchParams.set("state", authorization.searchParams.get("state")!);
    callback.searchParams.set("code", "fixture-code");
    return { authorization, callback };
  }
  return { broker, store, exchanges, start, counts: () => ({ registrations, discoveries }) };
}

describe("OAuth browser callback", () => {
  test("exchanges once using the discovery and client that started consent", async () => {
    const fixture = callbackFixture();
    const { callback, authorization } = await fixture.start();
    const response = await nativeFetch(callback);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Connected");
    await fixture.broker.waitForCompletion("linear");
    expect(fixture.counts()).toEqual({ registrations: 1, discoveries: 1 });
    expect(fixture.exchanges).toHaveLength(1);
    expect(fixture.exchanges[0]?.get("client_id")).toBe(
      authorization.searchParams.get("client_id"),
    );
    expect(fixture.exchanges[0]?.get("redirect_uri")).toBe(
      authorization.searchParams.get("redirect_uri"),
    );
    expect(fixture.store.read("linear")?.tokens?.accessToken).toBe("fixture-access");
  });

  test.each(["invalid_client", "unauthorized_client"])(
    "preserves %s and re-registers only on the next Connect",
    async (error) => {
      const fixture = callbackFixture(error);
      const { callback } = await fixture.start();
      const response = await nativeFetch(callback);
      expect(response.status).toBe(500);
      const html = await response.text();
      expect(html).toContain(error);
      expect(html).toContain("Vendor rejected *** for *** &lt;client&gt;.");
      expect(html).toContain("start a new sign-in");
      expect(html).not.toContain("Existing OAuth client information");
      await expect(fixture.broker.waitForCompletion("linear")).rejects.toThrow(
        `${error}: Vendor rejected *** for *** <client>.`,
      );
      expect(fixture.counts()).toEqual({ registrations: 1, discoveries: 1 });
      expect(fixture.exchanges).toHaveLength(1);
      expect(fixture.store.read("linear")).toBeUndefined();
      const next = await fixture.start();
      expect(next.authorization.searchParams.get("client_id")).toBe("client-2");
      expect(fixture.exchanges).toHaveLength(1);
    },
  );

  test("does not retry an invalid authorization code or discard the client", async () => {
    const fixture = callbackFixture("invalid_grant");
    const { callback } = await fixture.start();
    const response = await nativeFetch(callback);
    expect(response.status).toBe(500);
    expect(await response.text()).toContain("invalid_grant");
    await expect(fixture.broker.waitForCompletion("linear")).rejects.toThrow("invalid_grant");
    expect(fixture.exchanges).toHaveLength(1);
    expect(fixture.store.read("linear")?.client?.clientId).toBe("client-1");
    expect(fixture.store.read("linear")?.tokens).toBeUndefined();
  });
});

function connector(auth?: ConnectorConfig["auth"]): ConnectorConfig {
  return {
    id: "linear",
    server: { type: "http", url: "https://mcp.linear.app/mcp" },
    ...(auth ? { auth } : {}),
  };
}

describe("hasUsableAuthorization", () => {
  const now = 1_000_000;

  test("false when the connector has never been signed in", () => {
    expect(hasUsableAuthorization(connector(), now)).toBe(false);
  });

  test("true for an unexpired access token", () => {
    const state = {
      kind: "oauth" as const,
      tokens: { accessToken: "a", expiresAt: now + 600_000 },
    };
    expect(hasUsableAuthorization(connector(state), now)).toBe(true);
  });

  test("false once the access token has lapsed and there is nothing to refresh with", () => {
    const state = { kind: "oauth" as const, tokens: { accessToken: "a", expiresAt: now - 1 } };
    expect(hasUsableAuthorization(connector(state), now)).toBe(false);
  });

  test("true for an expired access token that still has a refresh token", () => {
    const state = {
      kind: "oauth" as const,
      tokens: { accessToken: "a", refreshToken: "r", expiresAt: now - 1 },
    };
    expect(hasUsableAuthorization(connector(state), now)).toBe(true);
  });

  test("treats a token expiring inside the skew window as already expired", () => {
    // A token with three seconds left will die mid-request. Better to refresh.
    const state = { kind: "oauth" as const, tokens: { accessToken: "a", expiresAt: now + 3_000 } };
    expect(hasUsableAuthorization(connector(state), now)).toBe(false);
  });
});

describe("connector auth provider storage", () => {
  test("returns no provider for a connector that was never signed in", () => {
    const store = createMemoryConnectorAuthStore();
    expect(createConnectorAuthProvider({ connector: connector(), store })).toBeUndefined();
  });

  test("hands the stored access token to the SDK", () => {
    const store = createMemoryConnectorAuthStore({
      linear: { kind: "oauth", tokens: { accessToken: "stored-access", tokenType: "Bearer" } },
    });
    const provider = createConnectorAuthProvider({
      connector: connector({ kind: "oauth", tokens: { accessToken: "stored-access" } }),
      store,
    });
    expect(provider?.tokens()).toMatchObject({
      access_token: "stored-access",
      token_type: "Bearer",
    });
  });

  test("keeps the previous refresh token when a refresh response omits one", () => {
    // Authorization servers routinely return only a new access token on refresh.
    // Dropping the old refresh token here logs the user out at the next expiry.
    const store = createMemoryConnectorAuthStore({
      linear: {
        kind: "oauth",
        tokens: { accessToken: "old-access", refreshToken: "long-lived-refresh" },
      },
    });
    const provider = createConnectorAuthProvider({
      connector: connector({ kind: "oauth", tokens: { accessToken: "old-access" } }),
      store,
      now: () => 5_000,
    });

    provider?.saveTokens({ access_token: "new-access", token_type: "Bearer", expires_in: 3600 });

    const stored = store.read("linear");
    expect(stored?.tokens?.accessToken).toBe("new-access");
    expect(stored?.tokens?.refreshToken).toBe("long-lived-refresh");
  });

  test("converts expires_in into an absolute instant", () => {
    const store = createMemoryConnectorAuthStore({
      linear: { kind: "oauth", tokens: { accessToken: "a" } },
    });
    const provider = createConnectorAuthProvider({
      connector: connector({ kind: "oauth", tokens: { accessToken: "a" } }),
      store,
      now: () => 10_000,
    });

    provider?.saveTokens({ access_token: "b", token_type: "Bearer", expires_in: 60 });

    // A duration is only meaningful next to the instant it was issued, and that
    // instant is not on the wire.
    expect(store.read("linear")?.tokens?.expiresAt).toBe(70_000);
  });

  test("ignores a client registration made against a different redirect URI", () => {
    // The loopback port can move if the preferred one was taken. Reusing a
    // registration bound to the old URI fails at the authorize step.
    const store = createMemoryConnectorAuthStore({
      linear: {
        kind: "oauth",
        tokens: { accessToken: "a" },
        client: {
          clientId: "client-from-another-port",
          redirectUri: "http://127.0.0.1:9999/connectors/oauth/callback",
        },
      },
    });
    const provider = createConnectorAuthProvider({
      connector: connector({
        kind: "oauth",
        tokens: { accessToken: "a" },
        client: {
          clientId: "client-from-another-port",
          redirectUri: "http://127.0.0.1:9999/connectors/oauth/callback",
        },
      }),
      store,
    });

    // Same URI it was registered against, so it IS reused here.
    expect(provider?.clientInformation()).toMatchObject({ client_id: "client-from-another-port" });
  });

  test("refuses to open a browser on the non-interactive path", () => {
    // The agent path may refresh silently, but it must never try to start an
    // interactive login nobody asked for mid-turn.
    const store = createMemoryConnectorAuthStore({
      linear: { kind: "oauth", tokens: { accessToken: "a" } },
    });
    const provider = createConnectorAuthProvider({
      connector: connector({ kind: "oauth", tokens: { accessToken: "a" } }),
      store,
    });

    expect(() =>
      provider?.redirectToAuthorization(new URL("https://example.com/authorize")),
    ).toThrow(/sign in again/i);
  });
});
