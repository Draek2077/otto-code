import { describe, expect, test } from "vitest";
import type {
  CredentialVault,
  CredentialVaultKey,
} from "../integration-authorization/credential-vault.js";
import type { IntegrationAuthorizationRegistry } from "../integration-authorization/integration-authorization-registry.js";
import { IntegrationAuthorizationService } from "../integration-authorization/integration-authorization-service.js";
import {
  ZoomTeamChatManagedAuthorizationBroker,
  ZOOM_TEAM_CHAT_OAUTH_REDIRECT_URI,
  ZOOM_TEAM_CHAT_OAUTH_SCOPES,
} from "./zoom-team-chat-managed-authorization.js";
import { OAuthPkceExchangeError } from "../integration-authorization/oauth-pkce.js";

class MemoryVault implements CredentialVault {
  readonly entries = new Map<string, string>();
  async getAvailability() {
    return { status: "available" as const, backend: "test" };
  }
  async get(key: CredentialVaultKey) {
    return this.entries.get(JSON.stringify(key)) ?? null;
  }
  async put(key: CredentialVaultKey, value: string) {
    this.entries.set(JSON.stringify(key), value);
  }
  async delete(key: CredentialVaultKey) {
    return this.entries.delete(JSON.stringify(key));
  }
}

function createAuthorization() {
  const records = new Map<
    string,
    import("@otto-code/protocol/integration-authorization").IntegrationConnectionMetadata
  >();
  const registry: IntegrationAuthorizationRegistry = {
    initialize: async () => {},
    list: async () => [...records.values()],
    get: async (params) =>
      records.get(JSON.stringify([params.integrationId, params.connectionId])) ?? null,
    upsert: async (record) => {
      records.set(JSON.stringify([record.integrationId, record.connectionId]), record);
    },
    remove: async (params) => {
      records.delete(JSON.stringify([params.integrationId, params.connectionId]));
    },
  };
  return new IntegrationAuthorizationService({
    hostId: "host",
    vault: new MemoryVault(),
    registry,
    now: () => new Date("2026-08-14T00:00:00.000Z"),
  });
}

describe("ZoomTeamChatManagedAuthorizationBroker", () => {
  test("keeps PKCE verifier and token material off the browser URL and persists the exchanged tokens in the vault", async () => {
    const authorization = createAuthorization();
    let exchangeParams: { code: string; codeVerifier: string } | null = null;
    let callbackServerClosed = false;
    const broker = new ZoomTeamChatManagedAuthorizationBroker(
      authorization,
      async (params) => {
        exchangeParams = { code: params.code, codeVerifier: params.codeVerifier };
        return {
          accessToken: "access-token",
          refreshToken: "refresh-token",
          expiresAt: "2026-08-14T01:00:00.000Z",
          grantedScopes: [...ZOOM_TEAM_CHAT_OAUTH_SCOPES],
        };
      },
      async () => ({
        close: () => {
          callbackServerClosed = true;
        },
      }),
      async () => "work@example.test",
    );

    const started = await broker.start();
    const url = new URL(started.authorizationUrl);
    expect(url.searchParams.get("client_id")).toBe("KOYUZEyvQFMLXmYlZ2r6A");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:6872/integrations/zoom-team-chat/oauth/callback",
    );
    expect(url.searchParams.get("redirect_uri")).toBe(ZOOM_TEAM_CHAT_OAUTH_REDIRECT_URI);
    expect(url.searchParams.get("scope")).toBe(ZOOM_TEAM_CHAT_OAUTH_SCOPES.join(" "));
    expect(url.searchParams.get("scope")).toContain("team_chat:read:list_user_sessions");
    expect(url.searchParams.get("scope")).toContain("team_chat:update:chat_control");
    expect(url.searchParams.get("scope")).toContain("team_chat:read:list_shared_spaces");
    expect(started.authorizationUrl).not.toContain("access-token");
    expect(started.authorizationUrl).not.toContain("refresh-token");
    expect(started.authorizationUrl).not.toContain("code_verifier");

    await expect(
      broker.handleCallback(url.searchParams.get("state")!, {
        state: url.searchParams.get("state"),
        code: "authorization-code",
        error: null,
      }),
    ).resolves.toEqual({ status: "connected" });
    expect(exchangeParams).toMatchObject({ code: "authorization-code" });
    expect(exchangeParams?.codeVerifier).toBeTruthy();
    expect(callbackServerClosed).toBe(true);
    await expect(
      authorization.readOAuthTokenSet({ integrationId: "zoom-team-chat", connectionId: "primary" }),
    ).resolves.toMatchObject({ accessToken: "access-token", refreshToken: "refresh-token" });
    await expect(
      authorization.getConnection({ integrationId: "zoom-team-chat", connectionId: "primary" }),
    ).resolves.toMatchObject({ accountLabel: "work@example.test" });
  });

  test("rejects an unsolicited callback without exchanging a code", async () => {
    const authorization = createAuthorization();
    const broker = new ZoomTeamChatManagedAuthorizationBroker(authorization);

    await expect(
      broker.handleCallback("wrong", { state: "wrong", code: "attacker-code", error: null }),
    ).resolves.toEqual({ status: "failed", errorCode: "state_mismatch" });
  });

  test("replaces a pending sign-in without letting its late callback cancel the new attempt", async () => {
    const authorization = createAuthorization();
    let callbackServerCloseCount = 0;
    let exchangeCount = 0;
    const broker = new ZoomTeamChatManagedAuthorizationBroker(
      authorization,
      async () => {
        exchangeCount += 1;
        return {
          accessToken: "access-token",
          refreshToken: "refresh-token",
          expiresAt: "2026-08-14T01:00:00.000Z",
          grantedScopes: [],
        };
      },
      async () => ({
        close: () => {
          callbackServerCloseCount += 1;
        },
      }),
    );

    const first = await broker.start();
    const second = await broker.start();
    const firstState = new URL(first.authorizationUrl).searchParams.get("state");
    const secondState = new URL(second.authorizationUrl).searchParams.get("state");

    expect(callbackServerCloseCount).toBe(1);
    await expect(
      broker.handleCallback(firstState!, { state: firstState, code: "old-code", error: null }),
    ).resolves.toEqual({ status: "failed", errorCode: "state_mismatch" });
    await expect(
      broker.handleCallback(secondState!, { state: secondState, code: "new-code", error: null }),
    ).resolves.toEqual({ status: "connected" });
    expect(exchangeCount).toBe(1);
  });

  test("records an OAuth exchange failure from the callback", async () => {
    const authorization = createAuthorization();
    let callback:
      | ((params: {
          state: string | null;
          code: string | null;
          error: string | null;
        }) => Promise<unknown>)
      | null = null;
    const broker = new ZoomTeamChatManagedAuthorizationBroker(
      authorization,
      async () => {
        throw new OAuthPkceExchangeError(400);
      },
      async (handler) => {
        callback = handler;
        return { close: () => {} };
      },
    );

    const started = await broker.start();
    const state = new URL(started.authorizationUrl).searchParams.get("state");

    await expect(callback?.({ code: "authorization-code", state, error: null })).resolves.toEqual({
      status: "failed",
      errorCode: "exchange_failed_400",
    });
    await expect(
      authorization.getConnection({ integrationId: "zoom-team-chat", connectionId: "primary" }),
    ).resolves.toMatchObject({ state: "error", errorCode: "exchange_failed_400" });
  });

  test("does not mislabel secure token storage failures as Zoom exchange failures", async () => {
    const authorization = createAuthorization();
    authorization.saveOAuthTokenSet = async () => {
      throw new Error("storage unavailable");
    };
    const broker = new ZoomTeamChatManagedAuthorizationBroker(authorization, async () => ({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: "2026-08-14T01:00:00.000Z",
      grantedScopes: [],
    }));

    const started = await broker.start();
    const state = new URL(started.authorizationUrl).searchParams.get("state");

    await expect(
      broker.handleCallback(state!, { state, code: "authorization-code", error: null }),
    ).resolves.toEqual({ status: "failed", errorCode: "token_storage_failed" });
  });
});
