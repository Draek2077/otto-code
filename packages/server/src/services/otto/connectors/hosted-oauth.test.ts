import { describe, expect, it } from "vitest";
import { HostedConnectorOAuth } from "./hosted-oauth.js";
import { connectorServerSummary, type ConnectorBundle } from "./configuration.js";
import type { ConnectorEntry } from "./store.js";

const grantId = "a".repeat(64);
const origin = "https://auth.fixture.invalid";
const tokens = {
  accessToken: "private-access",
  refreshToken: "private-refresh",
  expiresAt: 1000000,
  scopes: ["read"],
};
function fixture(
  options: {
    expired?: boolean;
    failRefresh?: boolean;
    failRevoke?: boolean;
    pending?: boolean;
    verifyAfterConsent?: boolean;
  } = {},
) {
  let bundle: ConnectorBundle = {
    server: { type: "http", url: "https://mcp.hubspot.com", headers: {} },
    oauth: true,
    scope: "",
    ...(options.expired
      ? {
          authorization: {
            kind: "hosted-oauth-v1",
            origin,
            vendorId: "hubspot",
            resourceUrl: "https://mcp.hubspot.com",
            grantId,
            proof: "p".repeat(43),
            tokens: { ...tokens, expiresAt: 1 },
            account: null,
          },
        }
      : {}),
  };
  let value: string | null = null;
  let revision = "origin";
  let sequence = 0;
  const requests: Array<{ url: string; body: unknown; authorization: string | null }> = [];
  let settle!: () => void;
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const outcomes: unknown[] = [];
  const entry: ConnectorEntry = {
    id: "fixture",
    label: "HubSpot",
    catalogId: "hubspot",
    generation: "generation",
    fingerprint: "config",
    enabled: false,
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
  const store = {
    open: async () => ({ revision: "settings", entry, bundle }),
    readBundleVersion: async () => ({ revision, value }),
    writeBundle: async (
      _entry: ConnectorEntry,
      expected: string,
      next: ConnectorBundle,
      admit?: () => boolean,
    ) => {
      if (expected !== revision || (admit && !admit())) throw new Error("conflict");
      bundle = next;
      value = JSON.stringify(next);
      revision = `accepted-${++sequence}`;
      return revision;
    },
  };
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({
      url,
      body: JSON.parse(String(init?.body)),
      authorization: new Headers(init?.headers).get("Authorization"),
    });
    if (url.endsWith("/v1/grants"))
      return Response.json({
        grantId,
        authorizationUrl: `${origin}/v1/grants/${grantId}/authorize`,
      });
    if (url.endsWith("/collect"))
      return Response.json(options.pending ? { status: "pending" } : { status: "ready", tokens });
    if (url.endsWith("/refresh")) {
      if (options.failRefresh) throw new Error("private network detail");
      return Response.json({ tokens });
    }
    if (url.endsWith("/revoke"))
      return Response.json({}, { status: options.failRevoke ? 503 : 200 });
    throw new Error("Unexpected fixture URL");
  };
  const driver = new HostedConnectorOAuth({
    store,
    origin,
    fetcher,
    pollMs: 1,
    now: () => 100000,
    settled: async (_id, _generation, outcome, admit) => {
      if (!admit()) throw new Error("stale");
      if (outcome.connected && options.verifyAfterConsent)
        await driver.authorize(await store.open(), new AbortController().signal);
      outcomes.push(outcome);
      settle();
    },
  });
  return { driver, store, entry, requests, outcomes, settled, saved: () => bundle };
}

describe("hosted Connector authorization", () => {
  it("persists the private possession proof before consent, then collects once without exposing it in the browser URL", async () => {
    const host = fixture({ verifyAfterConsent: true });
    try {
      const result = await host.driver.begin(await host.store.open());
      expect(result).toEqual({
        callback: "hosted",
        authorizationUrl: `${origin}/v1/grants/${grantId}/authorize`,
      });
      const proof = String(host.saved().authorization?.proof);
      expect(result.authorizationUrl).not.toContain(proof);
      expect(host.saved().authorization?.kind).toBe("hosted-pending-v1");
      await host.settled;
      expect(host.outcomes).toEqual([{ connected: true }]);
      expect(host.requests.filter((row) => row.url.endsWith("/collect"))).toHaveLength(1);
      expect(host.requests.find((row) => row.url.endsWith("/collect"))?.authorization).toBe(
        `Bearer ${proof}`,
      );
      expect(await host.driver.status("fixture")).toMatchObject({ connected: true });
      expect(JSON.stringify(await host.driver.status("fixture"))).not.toContain("private-access");
      const authorized = await host.driver.authorize(
        await host.store.open(),
        new AbortController().signal,
      );
      expect(authorized.server).toMatchObject({
        headers: { Authorization: "Bearer private-access" },
      });
      expect(host.entry.enabled).toBe(false);
    } finally {
      await host.driver.close();
    }
  });

  it("blocks replay of a possibly rotated refresh token after an uncertain exchange", async () => {
    const host = fixture({ expired: true, failRefresh: true });
    try {
      await expect(
        host.driver.authorize(await host.store.open(), new AbortController().signal),
      ).rejects.toMatchObject({ kind: "uncertain" });
      expect(host.saved().authorization?.refreshBlocked).toBe(true);
      await expect(
        host.driver.authorize(await host.store.open(), new AbortController().signal),
      ).rejects.toMatchObject({ kind: "authorization" });
      expect(host.requests.filter((row) => row.url.endsWith("/refresh"))).toHaveLength(1);
    } finally {
      await host.driver.close();
    }
  });

  it("publishes a successful refresh once and retires the old grant only after confirmed revocation", async () => {
    const host = fixture({ expired: true });
    try {
      await host.driver.authorize(await host.store.open(), new AbortController().signal);
      expect(host.saved().authorization?.refreshBlocked).toBe(false);
      await host.driver.disconnect("fixture");
      expect(host.saved().authorization).toEqual({ kind: "disconnected" });
      expect(await host.driver.status("fixture")).toMatchObject({ connected: false });
    } finally {
      await host.driver.close();
    }
  });

  it("preserves credentials after a rejected revocation instead of claiming disconnection", async () => {
    const host = fixture({ expired: true, failRevoke: true });
    try {
      await expect(host.driver.disconnect("fixture")).rejects.toMatchObject({ kind: "vendor" });
      expect(host.saved().authorization?.kind).toBe("hosted-oauth-v1");
    } finally {
      await host.driver.close();
    }
  });

  it("shutdown cancels active collection without deleting pending authority or publishing a late success", async () => {
    const host = fixture({ pending: true });
    await host.driver.begin(await host.store.open());
    await host.driver.close();
    expect(host.driver.isPending("fixture")).toBe(false);
    expect(host.outcomes).toEqual([]);
    expect(host.saved().authorization?.kind).toBe("hosted-pending-v1");
  });
});
