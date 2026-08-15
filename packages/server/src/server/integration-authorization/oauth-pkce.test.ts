import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  createOAuthPkceAuthorizationUrl,
  createOAuthPkcePair,
  exchangeOAuthPkceAuthorizationCode,
  OAuthPkceExchangeError,
  refreshOAuthPkceToken,
  type OAuthPkceClientDefinition,
} from "./oauth-pkce.js";

const CLIENT: OAuthPkceClientDefinition = {
  authorizationEndpoint: "https://provider.example/authorize",
  tokenEndpoint: "https://provider.example/token",
  publicClientId: "public-client-id",
  scopes: ["messages.read", "messages.write"],
};

describe("OAuth PKCE", () => {
  test("creates an S256 challenge and sends only public-client fields to the token endpoint", async () => {
    const pair = createOAuthPkcePair();
    expect(createHash("sha256").update(pair.verifier).digest("base64url")).toBe(pair.challenge);

    const calls: Array<{ input: string; init: { headers: Record<string, string>; body: string } }> =
      [];
    await expect(
      exchangeOAuthPkceAuthorizationCode({
        client: CLIENT,
        code: "authorization-code",
        redirectUri: "http://127.0.0.1:1234/callback",
        codeVerifier: pair.verifier,
        now: () => new Date("2026-08-13T12:00:00.000Z"),
        fetch: async (input, init) => {
          calls.push({ input, init });
          return {
            ok: true,
            status: 200,
            json: async () => ({
              access_token: "access-token",
              refresh_token: "refresh-token",
              expires_in: 3600,
              scope: "messages.read messages.write",
            }),
          };
        },
      }),
    ).resolves.toEqual({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: "2026-08-13T13:00:00.000Z",
      grantedScopes: ["messages.read", "messages.write"],
    });

    expect(calls).toEqual([
      {
        input: "https://provider.example/token",
        init: {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/x-www-form-urlencoded",
          },
          body: expect.stringContaining("client_id=public-client-id"),
        },
      },
    ]);
    expect(calls[0]?.init.body).not.toContain("client_secret");
    expect(calls[0]?.init.headers).not.toHaveProperty("authorization");
  });

  test("builds a standards-shaped authorization URL without the verifier", () => {
    const url = new URL(
      createOAuthPkceAuthorizationUrl({
        client: CLIENT,
        redirectUri: "https://callback.example/return",
        state: "state-value",
        codeChallenge: "challenge-value",
      }),
    );

    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "public-client-id",
      redirect_uri: "https://callback.example/return",
      code_challenge: "challenge-value",
      code_challenge_method: "S256",
      state: "state-value",
      scope: "messages.read messages.write",
    });
    expect(url.searchParams.has("code_verifier")).toBe(false);
  });

  test("includes a provider's public reauthorization parameters", () => {
    const url = new URL(
      createOAuthPkceAuthorizationUrl({
        client: { ...CLIENT, authorizationParams: { include_granted_scopes: "true" } },
        redirectUri: "https://callback.example/return",
        state: "state-value",
        codeChallenge: "challenge-value",
      }),
    );

    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
  });

  test("uses the latest refresh token response and never exposes a failed response body", async () => {
    await expect(
      refreshOAuthPkceToken({
        client: CLIENT,
        refreshToken: "old-refresh-token",
        fetch: async () => ({
          ok: false,
          status: 401,
          json: async () => ({ detail: "secret provider response" }),
        }),
      }),
    ).rejects.toEqual(new OAuthPkceExchangeError(401));
  });
});
