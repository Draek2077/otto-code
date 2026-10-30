import { describe, expect, it } from "vitest";
import { McpOAuthSession, connectorAuthorizationFetch } from "./oauth-session.js";
import { connectorServerSummary, type ConnectorBundle } from "./configuration.js";
import type { ConnectorEntry } from "./store.js";
import { SLACK_OAUTH_REGISTRATION } from "./oauth-registration.js";

const metadata = {
  issuer: "https://auth.fixture.invalid",
  authorization_endpoint: "https://auth.fixture.invalid/authorize",
  token_endpoint: "https://auth.fixture.invalid/token",
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
};
function fixture(
  options: {
    interactive?: boolean;
    authorization?: Record<string, unknown>;
    legacy?: boolean;
    serverUrl?: string;
    fetcher?: typeof fetch;
  } = {},
) {
  let revision = "origin";
  let value: string | null = null;
  let active = true;
  let writes = 0;
  let generation = "generation";
  const redirects: string[] = [];
  const bundle: ConnectorBundle = {
    server: {
      type: "http",
      url: options.serverUrl ?? "https://mcp.fixture.invalid/mcp",
      headers: {},
    },
    oauth: true,
    scope: "read",
    authorization: options.authorization,
    ...(options.legacy ? { legacy: { original: true } } : {}),
  };
  const entry: ConnectorEntry = {
    id: "fixture",
    label: "Fixture",
    generation,
    fingerprint: "config",
    catalogId: null,
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
  const store = {
    open: async () => ({ revision: "settings", entry: { ...entry, generation }, bundle }),
    readBundleVersion: async () => ({ revision, value }),
    writeBundle: async (_entry: ConnectorEntry, expected: string, next: ConnectorBundle) => {
      if (expected !== revision) throw new Error("conflict");
      writes++;
      value = JSON.stringify(next);
      revision = `accepted-${writes}`;
      return revision;
    },
  };
  return {
    bundle,
    entry,
    redirects,
    writes: () => writes,
    saved: () => (value ? (JSON.parse(value) as ConnectorBundle) : null),
    invalidate() {
      active = false;
    },
    peer() {
      revision = "peer";
    },
    changeGeneration() {
      generation = "changed";
    },
    open: () =>
      McpOAuthSession.open({
        store,
        bundle,
        entry,
        redirectUri: "http://127.0.0.1:6871/connectors/oauth/callback",
        state: "fixture-state",
        interactive: options.interactive ?? false,
        active: () => active,
        onRedirect: (url) => {
          redirects.push(url.toString());
        },
        fetcher: options.fetcher,
        now: () => 100000,
      }),
  };
}
const grant = {
  kind: "oauth",
  resourceUrl: "https://mcp.fixture.invalid/mcp",
  client: {
    clientId: "registered-client",
    redirectUri: "http://127.0.0.1:6871/connectors/oauth/callback",
  },
  tokens: {
    accessToken: "old-access",
    refreshToken: "keep-refresh",
    tokenType: "Bearer",
    expiresAt: 200000,
    scope: "read",
  },
};

describe("host-only captured OAuth grants", () => {
  it("writes a renewal guard before a rotating refresh and does not replay an uncertain token", async () => {
    let exchanges = 0;
    const host = fixture({
      authorization: {
        ...grant,
        discovery: {
          authorizationServerUrl: metadata.issuer,
          authorizationServerMetadata: metadata,
        },
        tokens: { ...grant.tokens, expiresAt: 1 },
      },
      fetcher: async () => {
        exchanges++;
        throw new Error("network interrupted");
      },
    });
    const session = await host.open();
    await expect(session.access()).rejects.toBeInstanceOf(Error);
    expect(host.saved()?.authorization?.refreshBlocked).toBe(true);
    await expect(session.access()).rejects.toMatchObject({ kind: "authorization" });
    expect(exchanges).toBe(1);
  });

  it("clears the renewal guard only after an acknowledged refresh and preserves omitted refresh tokens", async () => {
    const host = fixture({
      authorization: {
        ...grant,
        discovery: {
          authorizationServerUrl: metadata.issuer,
          authorizationServerMetadata: metadata,
        },
        tokens: { ...grant.tokens, expiresAt: 1 },
      },
      fetcher: async () =>
        Response.json({ access_token: "refreshed", token_type: "Bearer", expires_in: 3600 }),
    });
    expect((await (await host.open()).access()).token).toBe("Bearer refreshed");
    expect(host.saved()?.authorization).toMatchObject({
      refreshBlocked: false,
      tokens: { refreshToken: "keep-refresh" },
    });
    expect(host.writes()).toBe(2);
  });

  it("records explicit disconnection so preserved inline grants cannot reappear", async () => {
    const host = fixture({ authorization: grant, legacy: true });
    const session = await host.open();
    await session.disconnect();
    expect(host.saved()?.authorization).toEqual({ kind: "disconnected" });
    expect(session.status().connected).toBe(false);
    await expect(session.access()).rejects.toMatchObject({ kind: "authorization" });
  });
  it("uses existing grants quietly and cannot open a browser or register a replacement client", async () => {
    const host = fixture({ authorization: grant });
    const session = await host.open();
    expect(await session.access()).toEqual({ token: "Bearer old-access", revision: "origin" });
    await expect(
      session.redirectToAuthorization(new URL("https://auth.fixture.invalid/authorize")),
    ).rejects.toMatchObject({ kind: "authorization" });
    await expect(session.saveClientInformation({ client_id: "replacement" })).rejects.toMatchObject(
      { kind: "authorization" },
    );
    expect(host.redirects).toEqual([]);
    expect(host.writes()).toBe(0);
  });

  it("stages registration/discovery/verifier without replacing a working grant, then exchanges a code exactly once", async () => {
    const requests: URLSearchParams[] = [];
    const host = fixture({
      interactive: true,
      authorization: grant,
      fetcher: async (_input, init) => {
        requests.push(new URLSearchParams(String(init?.body)));
        return Response.json({
          access_token: "new-access",
          refresh_token: "new-refresh",
          token_type: "Bearer",
          expires_in: 3600,
        });
      },
    });
    const session = await host.open();
    expect(await session.tokens()).toBeUndefined();
    await session.saveClientInformation({ client_id: "new-client" });
    await session.saveCodeVerifier("host-only-verifier");
    await session.saveDiscoveryState({
      authorizationServerUrl: metadata.issuer,
      authorizationServerMetadata: metadata,
      resourceMetadata: {
        resource: "https://mcp.fixture.invalid/mcp",
        authorization_servers: [metadata.issuer],
      },
    });
    expect(host.writes()).toBe(0);
    await session.complete("host-only-code");
    expect(requests).toHaveLength(1);
    expect(requests[0].get("code")).toBe("host-only-code");
    expect(requests[0].get("code_verifier")).toBe("host-only-verifier");
    expect(host.writes()).toBe(1);
    expect(host.saved()?.authorization).toMatchObject({
      resourceUrl: "https://mcp.fixture.invalid/mcp",
      client: { clientId: "new-client" },
      tokens: { accessToken: "new-access", refreshToken: "new-refresh" },
    });
    expect(JSON.stringify(host.saved())).not.toMatch(/host-only-code|host-only-verifier/);
    await expect(session.complete("host-only-code")).rejects.toMatchObject({
      kind: "authorization",
    });
    expect(requests).toHaveLength(1);
  });

  it("does not replay a rejected code or delete a working grant to hide the vendor's error", async () => {
    let requests = 0;
    const host = fixture({
      interactive: true,
      authorization: grant,
      fetcher: async () => {
        requests++;
        return Response.json({ error: "invalid_client" }, { status: 400 });
      },
    });
    const session = await host.open();
    await session.saveCodeVerifier("verifier");
    await session.saveDiscoveryState({
      authorizationServerUrl: metadata.issuer,
      authorizationServerMetadata: metadata,
    });
    await expect(session.complete("code")).rejects.toBeInstanceOf(Error);
    await expect(session.complete("code")).rejects.toMatchObject({ kind: "authorization" });
    expect(requests).toBe(1);
    expect(host.writes()).toBe(0);
  });

  it("preserves omitted refresh tokens and advances only its own acknowledged revision", async () => {
    const host = fixture({ authorization: grant });
    const session = await host.open();
    await session.saveTokens({ access_token: "first", token_type: "Bearer", expires_in: 3600 });
    await session.saveTokens({ access_token: "second", token_type: "Bearer", expires_in: 3600 });
    expect(host.writes()).toBe(2);
    expect(host.saved()?.authorization).toMatchObject({
      tokens: { accessToken: "second", refreshToken: "keep-refresh" },
    });
    expect((await session.access()).revision).toBe("accepted-2");
  });

  it.each(["hidden", "generation", "revision"])(
    "rejects stale %s write authority without rebasing",
    async (kind) => {
      const host = fixture({ authorization: grant });
      const session = await host.open();
      if (kind === "hidden") host.invalidate();
      else if (kind === "generation") host.changeGeneration();
      else host.peer();
      await expect(
        session.saveTokens({ access_token: "late", token_type: "Bearer" }),
      ).rejects.toBeInstanceOf(Error);
      expect(host.writes()).toBe(0);
    },
  );

  it("does not send a grant to a changed resource, and confines legacy binding to the preserved transport", async () => {
    const changed = fixture({ authorization: grant, serverUrl: "https://different.invalid/mcp" });
    await expect((await changed.open()).access()).rejects.toMatchObject({ kind: "authorization" });
    const unbound = { ...grant, resourceUrl: undefined };
    const fresh = fixture({ authorization: unbound });
    await expect((await fresh.open()).access()).rejects.toMatchObject({ kind: "authorization" });
    const legacy = fixture({ authorization: unbound, legacy: true });
    expect((await (await legacy.open()).access()).token).toBe("Bearer old-access");
  });

  it("pins registered public clients to the exact vendor endpoint and discovery metadata", async () => {
    const host = fixture({ interactive: true, serverUrl: SLACK_OAUTH_REGISTRATION.serverUrl });
    const session = await host.open();
    expect(await session.clientInformation()).toEqual({
      client_id: SLACK_OAUTH_REGISTRATION.clientId,
    });
    await expect(
      session.saveDiscoveryState({
        authorizationServerUrl: metadata.issuer,
        authorizationServerMetadata: metadata,
      }),
    ).rejects.toMatchObject({ kind: "authorization" });
    expect(host.writes()).toBe(0);
  });

  it("bounds authorization HTTP and forbids redirect-based credential forwarding", async () => {
    let redirect: RequestRedirect | undefined;
    const request = connectorAuthorizationFetch(async (_input, init) => {
      redirect = init?.redirect;
      return Response.json({ valid: true });
    });
    expect(await (await request("https://auth.fixture.invalid/token")).json()).toEqual({
      valid: true,
    });
    expect(redirect).toBe("error");
    const oversized = connectorAuthorizationFetch(
      async () => new Response("x".repeat(2 * 1024 * 1024 + 1)),
    );
    await expect(oversized("https://auth.fixture.invalid/token")).rejects.toThrow("exceeds 2 MiB");
    await expect(request("http://remote.invalid/token")).rejects.toMatchObject({
      kind: "validation",
    });
  });
});
