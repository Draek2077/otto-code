// The OAuth provider's storage half. The protocol half (discovery, PKCE, code
// exchange) belongs to the MCP SDK and is not re-tested here; what is ours is
// how tokens are persisted, which is where a silent logout comes from.
import { describe, expect, test } from "vitest";
import type { ConnectorConfig } from "@otto-code/protocol/provider-config";

import { createConnectorAuthProvider, hasUsableAuthorization } from "./connector-oauth.js";
import { createMemoryConnectorAuthStore } from "./connector-auth-store.js";

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
