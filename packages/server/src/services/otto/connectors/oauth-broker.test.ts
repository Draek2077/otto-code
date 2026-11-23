import { afterEach, describe, expect, it } from "vitest";
import { ConnectorOAuthBroker } from "./oauth-broker.js";
import { connectorServerSummary, type ConnectorBundle } from "./configuration.js";
import type { ConnectorEntry } from "./store.js";

const brokers: ConnectorOAuthBroker[] = [];
afterEach(async () => {
  for (const broker of brokers.splice(0)) await broker.close();
});
function deferred() {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    promise,
    resolve() {
      release();
    },
  };
}
function fixture() {
  let revision = "absent";
  let saved: string | null = null;
  let writes = 0;
  let tokenRequests = 0;
  let failStatus = false;
  let tokenWait: (() => Promise<void>) | null = null;
  let bundle: ConnectorBundle = {
    server: { type: "http", url: "https://mcp.fixture.invalid/mcp", headers: {} },
    oauth: true,
    scope: "read",
  };
  const entry: ConnectorEntry = {
    id: "fixture",
    label: "Fixture",
    generation: "generation",
    fingerprint: "configuration",
    catalogId: null,
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
  const outcomes: Array<{ connected: boolean }> = [];
  const store = {
    open: async () => ({ revision: "settings", entry: structuredClone(entry), bundle }),
    readBundleVersion: async () => ({ revision, value: saved }),
    writeBundle: async (
      _entry: ConnectorEntry,
      expected: string,
      next: ConnectorBundle,
      admit?: () => boolean,
    ) => {
      if (expected !== revision || (admit && !admit())) throw new Error("stale grant");
      writes++;
      saved = JSON.stringify(next);
      bundle = next;
      revision = `accepted-${writes}`;
      return revision;
    },
  };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (
      url.hostname === "mcp.fixture.invalid" &&
      url.pathname.startsWith("/.well-known/oauth-protected-resource")
    )
      return Response.json({
        resource: "https://mcp.fixture.invalid/mcp",
        authorization_servers: ["https://auth.fixture.invalid"],
        scopes_supported: ["read"],
      });
    if (url.hostname === "auth.fixture.invalid" && url.pathname.startsWith("/.well-known/"))
      return Response.json({
        issuer: "https://auth.fixture.invalid",
        authorization_endpoint: "https://auth.fixture.invalid/authorize",
        token_endpoint: "https://auth.fixture.invalid/token",
        registration_endpoint: "https://auth.fixture.invalid/register",
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    if (url.href === "https://auth.fixture.invalid/register")
      return Response.json(
        { ...JSON.parse(String(init?.body)), client_id: "fixture-public-client" },
        { status: 201 },
      );
    if (url.href === "https://auth.fixture.invalid/token") {
      tokenRequests++;
      await tokenWait?.();
      return Response.json({
        access_token: "fixture-access",
        refresh_token: "fixture-refresh",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "read",
      });
    }
    throw new Error("Unexpected fixture endpoint");
  };
  const broker = new ConnectorOAuthBroker({
    store,
    fetcher,
    callbackPort: 0,
    settled: async (_id, _generation, outcome, admit) => {
      if (!admit() || failStatus) throw new Error("status write refused");
      outcomes.push(outcome);
    },
  });
  brokers.push(broker);
  return {
    broker,
    open: () => store.open(),
    outcomes,
    writes: () => writes,
    tokenRequests: () => tokenRequests,
    saved: () => saved,
    tokenWait(value: () => Promise<void>) {
      tokenWait = value;
    },
    failStatus() {
      failStatus = true;
    },
  };
}
function callback(consent: string, overrides: Record<string, string> = {}): URL {
  const url = new URL(consent);
  const redirect = new URL(url.searchParams.get("redirect_uri")!);
  redirect.searchParams.set("state", url.searchParams.get("state")!);
  redirect.searchParams.set("code", "fixture-code");
  for (const [key, value] of Object.entries(overrides)) redirect.searchParams.set(key, value);
  return redirect;
}

describe("daemon-owned OAuth callback lifecycle", () => {
  it("uses an isolated loopback listener, leaves the grant staged until callback and keeps grant material out of its response", async () => {
    const host = fixture();
    const result = await host.broker.begin(await host.open());
    expect(result.callback).toBe("host-loopback");
    const target = callback(result.authorizationUrl);
    expect(target.hostname).toBe("127.0.0.1");
    expect(Number(target.port)).toBeGreaterThan(0);
    expect(host.writes()).toBe(0);
    expect(host.broker.isPending("fixture")).toBe(true);
    const response = await fetch(target, { signal: AbortSignal.timeout(5000) });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(await response.text()).toBe("Connected. Return to Otto.");
    expect(JSON.stringify(result)).not.toMatch(/fixture-access|fixture-refresh|fixture-code/);
    expect(host.writes()).toBe(1);
    expect(host.tokenRequests()).toBe(1);
    expect(host.outcomes).toEqual([{ connected: true }]);
    expect(host.broker.isPending("fixture")).toBe(false);
  });

  it("rejects wrong state without terminating the current sign-in", async () => {
    const host = fixture();
    const result = await host.broker.begin(await host.open());
    const rejected = await fetch(callback(result.authorizationUrl, { state: "wrong-state" }), {
      signal: AbortSignal.timeout(5000),
    });
    expect(rejected.status).toBe(400);
    await rejected.body?.cancel();
    expect(host.broker.isPending("fixture")).toBe(true);
    expect(host.tokenRequests()).toBe(0);
    const accepted = await fetch(callback(result.authorizationUrl), {
      signal: AbortSignal.timeout(5000),
    });
    expect(accepted.status).toBe(200);
    await accepted.body?.cancel();
  });

  it("does not accept a superseded callback against a newer listener", async () => {
    const host = fixture();
    const old = await host.broker.begin(await host.open());
    const current = await host.broker.begin(await host.open());
    const oldState = new URL(old.authorizationUrl).searchParams.get("state")!;
    const rejected = await fetch(callback(current.authorizationUrl, { state: oldState }), {
      signal: AbortSignal.timeout(5000),
    });
    expect(rejected.status).toBe(400);
    await rejected.body?.cancel();
    const accepted = await fetch(callback(current.authorizationUrl), {
      signal: AbortSignal.timeout(5000),
    });
    expect(accepted.status).toBe(200);
    await accepted.body?.cancel();
    expect(host.tokenRequests()).toBe(1);
  });

  it("treats denied consent as a safe failure without exchanging a code", async () => {
    const host = fixture();
    const result = await host.broker.begin(await host.open());
    const denied = await fetch(callback(result.authorizationUrl, { error: "access_denied" }), {
      signal: AbortSignal.timeout(5000),
    });
    expect(denied.status).toBe(400);
    expect(await denied.text()).not.toContain("access_denied");
    expect(host.tokenRequests()).toBe(0);
    expect(host.writes()).toBe(0);
    expect(host.outcomes[0]).toMatchObject({ connected: false });
  });

  it("invalidates an in-flight code exchange on cancel and waits for owned completion at shutdown", async () => {
    const host = fixture();
    const entered = deferred();
    const release = deferred();
    host.tokenWait(async () => {
      entered.resolve();
      await release.promise;
    });
    const result = await host.broker.begin(await host.open());
    const response = fetch(callback(result.authorizationUrl), {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
    await entered.promise;
    host.broker.cancel("fixture");
    const closing = host.broker.close();
    release.resolve();
    await closing;
    await response;
    expect(host.tokenRequests()).toBe(1);
    expect(host.writes()).toBe(0);
    expect(host.outcomes).toEqual([]);
    expect(host.saved()).toBeNull();
  });

  it("always ends the browser response when canonical status publication fails", async () => {
    const host = fixture();
    host.failStatus();
    const result = await host.broker.begin(await host.open());
    const response = await fetch(callback(result.authorizationUrl), {
      signal: AbortSignal.timeout(5000),
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("review the connection");
    expect(host.writes()).toBe(1);
    expect(host.broker.isPending("fixture")).toBe(false);
  });
});
