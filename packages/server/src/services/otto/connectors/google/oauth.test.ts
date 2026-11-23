import { describe, expect, it } from "vitest";
import { GOOGLE_CONNECTOR_SERVICES } from "@getpaseo/plugin/otto/connectors";
import { GoogleOAuthSessions, type GoogleOAuthRegistration } from "./oauth.js";
import { GOOGLE_CONNECTOR_IDENTITY_SCOPES } from "./google-connector-scopes.js";
import { connectorServerSummary, type ConnectorBundle } from "../configuration.js";
import type { ConnectorEntry } from "../store.js";

const registration: GoogleOAuthRegistration = {
  client_id: "fixture.apps.googleusercontent.com",
  client_secret: "fixture-publisher-secret",
};
function fixture(
  options: {
    serviceId?: string;
    registration?: GoogleOAuthRegistration | null;
    authorization?: Record<string, unknown>;
    legacy?: boolean;
    legacyTokens?: string;
    unverified?: boolean;
    failExchange?: boolean;
    missingScope?: boolean;
    revokeFailure?: boolean;
  } = {},
) {
  const service = GOOGLE_CONNECTOR_SERVICES.find(
    (row) => row.id === (options.serviceId ?? "google-drive"),
  )!;
  let bundle: ConnectorBundle = {
    server: { type: "http", url: service.url, headers: {} },
    builtin: service.id,
    oauth: true,
    scope: "",
    authorization: options.authorization,
    ...(options.legacy ? { legacy: { id: "fixture" } } : {}),
  };
  let saved: string | null = null;
  let revision = "origin";
  let writes = 0;
  let registrationReads = 0;
  let active = true;
  const requests: Array<{ url: string; body: URLSearchParams }> = [];
  const redirects: URL[] = [];
  const legacyReads: string[] = [];
  const store = {
    open: async () => ({ revision: "settings", entry, bundle }),
    readBundleVersion: async () => ({ revision, value: saved }),
    writeBundle: async (
      _entry: ConnectorEntry,
      expected: string,
      next: ConnectorBundle,
      admit?: () => boolean,
    ) => {
      if (expected !== revision || (admit && !admit())) throw new Error("conflict");
      writes++;
      saved = JSON.stringify(next);
      bundle = next;
      revision = `accepted-${writes}`;
      return revision;
    },
  };
  const entry: ConnectorEntry = {
    id: "fixture",
    label: "Google",
    catalogId: service.id,
    generation: "generation",
    fingerprint: "configuration",
    enabled: true,
    disabledTools: [],
    server: connectorServerSummary(bundle.server),
    authorization: { state: "disconnected", account: null, scopes: [], message: null },
    verification: {
      state: "unverified",
      checkedAt: null,
      fingerprint: null,
      message: null,
      tools: [],
    },
  };
  const driver = new GoogleOAuthSessions({
    registration: async () => {
      registrationReads++;
      return options.registration === undefined ? registration : options.registration;
    },
    legacyCredential: async (id) => {
      legacyReads.push(id);
      return options.legacyTokens ?? null;
    },
    legacyAccount: async () => "previous@example.test",
    now: () => 100000,
  });
  const fetcher: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = new URLSearchParams(String(init?.body ?? ""));
    requests.push({ url, body });
    if (url === "https://oauth2.googleapis.com/token") {
      if (options.failExchange) throw new Error("transport unavailable");
      return Response.json({
        access_token: "google-access",
        token_type: "Bearer",
        expires_in: 3600,
        ...(body.get("grant_type") === "authorization_code"
          ? { refresh_token: "google-refresh" }
          : {}),
        scope: options.missingScope
          ? "openid"
          : [...service.scopes, ...GOOGLE_CONNECTOR_IDENTITY_SCOPES].join(" "),
      });
    }
    if (url === "https://www.googleapis.com/oauth2/v2/userinfo")
      return Response.json({ email: "current@example.test", verified_email: !options.unverified });
    if (url === "https://oauth2.googleapis.com/revoke")
      return options.revokeFailure
        ? Response.json({ error: "unavailable" }, { status: 503 })
        : new Response(null, { status: 200 });
    throw new Error("Unexpected fixture URL");
  };
  return {
    service,
    redirects,
    requests,
    legacyReads,
    entry,
    writes: () => writes,
    saved: () => (saved ? (JSON.parse(saved) as ConnectorBundle) : null),
    registrationReads: () => registrationReads,
    deactivate() {
      active = false;
    },
    open: (interactive = false) =>
      driver.open({
        store,
        entry,
        bundle,
        redirectUri: "http://127.0.0.1:12345/connectors/oauth/callback",
        state: "state",
        interactive,
        active: () => active,
        onRedirect: (url) => {
          redirects.push(url);
        },
        fetcher,
      }),
  };
}
function storedGoogleGrant(expiresAt = 1000000) {
  return {
    kind: "google-oauth-v1",
    resourceUrl: GOOGLE_CONNECTOR_SERVICES[0].url,
    serviceId: "google-drive",
    clientId: registration.client_id,
    account: "previous@example.test",
    tokens: {
      accessToken: "previous-access",
      refreshToken: "previous-refresh",
      expiresAt,
      scopes: [...GOOGLE_CONNECTOR_SERVICES[0].scopes, ...GOOGLE_CONNECTOR_IDENTITY_SCOPES],
    },
  };
}

describe("native Google account authorization", () => {
  it.each(GOOGLE_CONNECTOR_SERVICES)(
    "restores $id consent, PKCE, required scopes and a verified account without exposing publisher secrets",
    async (service) => {
      const host = fixture({ serviceId: service.id });
      const session = await host.open(true);
      await session.begin();
      const consent = host.redirects[0];
      expect(consent.origin).toBe("https://accounts.google.com");
      expect(consent.searchParams.get("code_challenge_method")).toBe("S256");
      expect(consent.searchParams.get("scope")?.split(" ")).toEqual([
        ...service.scopes,
        ...GOOGLE_CONNECTOR_IDENTITY_SCOPES,
      ]);
      expect(consent.searchParams.get("access_type")).toBe("offline");
      expect(host.writes()).toBe(0);
      await session.complete("code");
      expect(host.requests[0].body.get("client_secret")).toBe(registration.client_secret);
      expect(host.saved()?.authorization).toMatchObject({
        kind: "google-oauth-v1",
        account: "current@example.test",
        serviceId: service.id,
        tokens: { accessToken: "google-access", refreshToken: "google-refresh" },
      });
      expect(JSON.stringify(host.saved())).not.toContain(registration.client_secret);
      expect((await session.access()).token).toBe("Bearer google-access");
      await expect(session.complete("code")).rejects.toMatchObject({ kind: "authorization" });
    },
  );

  it("keeps an existing valid grant usable without reading missing publisher registration", async () => {
    const host = fixture({ registration: null, authorization: storedGoogleGrant() });
    expect((await (await host.open()).access()).token).toBe("Bearer previous-access");
    expect(host.registrationReads()).toBe(0);
    expect(host.requests).toEqual([]);
  });

  it("does not offer an invented sign-in when the host lacks publisher registration", async () => {
    const host = fixture({ registration: null });
    await expect((await host.open(true)).begin()).rejects.toMatchObject({ kind: "unavailable" });
    expect(host.redirects).toEqual([]);
    expect(host.writes()).toBe(0);
  });

  it.each(["scope", "account"])("does not admit a grant with missing %s proof", async (reason) => {
    const host = fixture({ missingScope: reason === "scope", unverified: reason === "account" });
    const session = await host.open(true);
    await session.begin();
    await expect(session.complete("code")).rejects.toBeInstanceOf(Error);
    expect(host.writes()).toBe(0);
  });

  it("preserves refresh tokens and uses a write-ahead block around rotating refresh", async () => {
    const host = fixture({ authorization: storedGoogleGrant(1) });
    const session = await host.open();
    expect((await session.access()).token).toBe("Bearer google-access");
    expect(host.requests).toHaveLength(1);
    expect(host.requests[0].body.get("grant_type")).toBe("refresh_token");
    expect(host.saved()?.authorization).toMatchObject({
      refreshBlocked: false,
      tokens: { refreshToken: "previous-refresh" },
    });
    expect(host.writes()).toBe(2);
  });

  it("does not replay an old refresh token after an uncertain exchange", async () => {
    const host = fixture({ authorization: storedGoogleGrant(1), failExchange: true });
    await expect((await host.open()).access()).rejects.toBeInstanceOf(Error);
    expect(host.saved()?.authorization).toMatchObject({ refreshBlocked: true });
    await expect((await host.open()).access()).rejects.toMatchObject({ kind: "authorization" });
    expect(host.requests).toHaveLength(1);
  });

  it("preserves a grant when revocation fails and clears it only after a completed explicit disconnect", async () => {
    const failed = fixture({ authorization: storedGoogleGrant(), revokeFailure: true });
    await expect((await failed.open()).disconnect()).rejects.toMatchObject({ kind: "uncertain" });
    expect(failed.writes()).toBe(0);
    const accepted = fixture({ authorization: storedGoogleGrant() });
    await (await accepted.open()).disconnect();
    expect(accepted.saved()?.authorization).toEqual({ kind: "disconnected" });
    await expect((await accepted.open()).access()).rejects.toMatchObject({ kind: "authorization" });
  });

  it("reads only a preserved connection's legacy tuple and never resurrects it after disconnect", async () => {
    const host = fixture({
      legacy: true,
      legacyTokens: JSON.stringify({
        kind: "oauth-token-set-v1",
        accessToken: "old-access",
        refreshToken: "old-refresh",
        expiresAt: new Date(1000000).toISOString(),
        grantedScopes: [
          ...GOOGLE_CONNECTOR_SERVICES[0].scopes,
          ...GOOGLE_CONNECTOR_IDENTITY_SCOPES,
        ],
      }),
    });
    expect((await (await host.open()).access()).token).toBe("Bearer old-access");
    expect(host.legacyReads).toEqual(["fixture"]);
    await (await host.open()).disconnect();
    const count = host.legacyReads.length;
    await expect((await host.open()).access()).rejects.toMatchObject({ kind: "authorization" });
    expect(host.legacyReads).toHaveLength(count);
  });
});
