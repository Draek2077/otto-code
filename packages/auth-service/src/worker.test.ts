import { afterEach, expect, test, vi } from "vitest";
import worker, { AuthGrant } from "./worker";
import { digest, randomSecret } from "./grant";

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const objects = new Map<string, AuthGrant>();
  const storage = new Map<string, Map<string, unknown>>();
  const env = {
    PUBLIC_ORIGIN: "https://auth.example",
    BOX_CLIENT_ID: "public-client",
    BOX_CLIENT_SECRET: "publisher-secret",
    REQUEST_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    GRANTS: {
      newUniqueId: () => ({ toString: () => "a".repeat(64) }),
      idFromString: (id: string) => ({ toString: () => id }),
      get: (id: { toString(): string }) => {
        const key = id.toString();
        if (!objects.has(key)) {
          const values = new Map<string, unknown>();
          storage.set(key, values);
          const ctx = {
            id,
            storage: {
              get: async (name: string) => structuredClone(values.get(name)),
              put: async (name: string, value: unknown) => {
                values.set(name, structuredClone(value));
              },
              deleteAll: async () => values.clear(),
              setAlarm: async () => {},
              deleteAlarm: async () => {},
            },
          };
          objects.set(
            key,
            new AuthGrant(
              ctx as unknown as DurableObjectState,
              env as unknown as Parameters<typeof worker.fetch>[1],
            ),
          );
        }
        return objects.get(key)!;
      },
    },
  };
  const call = (path: string, init?: RequestInit) =>
    worker.fetch(
      new Request(env.PUBLIC_ORIGIN + path, init),
      env as unknown as Parameters<typeof worker.fetch>[1],
    );
  const proof = randomSecret();
  const setup = async () => {
    const start = await call("/v1/grants", {
      method: "POST",
      body: JSON.stringify({
        vendorId: "box",
        proofHash: await digest(proof),
        tokenUrl: "https://attacker.example",
        scope: "admin",
      }),
    });
    const { grantId, authorizationUrl } = (await start.json()) as {
      grantId: string;
      authorizationUrl: string;
    };
    const view = await call(new URL(authorizationUrl).pathname);
    expect(view.headers.get("referrer-policy")).toBe("same-origin");
    expect(view.headers.get("content-security-policy")).toContain(
      "form-action 'self' https://account.box.com https://app.box.com;",
    );
    const html = await view.text();
    const state = /action="\?state=([\w-]+)"/.exec(html)![1];
    for (const origin of ["null", "https://attacker.example"]) {
      const rejected = await call(`/v1/grants/${grantId}/authorize?state=${state}`, {
        method: "POST",
        headers: { origin },
      });
      expect(rejected.status).toBe(403);
      expect(await rejected.json()).toEqual({ error: "invalid_origin" });
    }
    const go = await call(`/v1/grants/${grantId}/authorize?state=${state}`, {
      method: "POST",
      headers: { origin: env.PUBLIC_ORIGIN },
    });
    const vendorUrl = new URL(go.headers.get("location")!);
    expect(go.headers.get("content-security-policy")).toContain(
      "form-action 'self' https://account.box.com https://app.box.com;",
    );
    expect(go.headers.get("referrer-policy")).toBe("no-referrer");
    const callback = await call(
      `/v1/callback?state=${vendorUrl.searchParams.get("state")}&code=private-code`,
    );
    expect(callback.status).toBe(200);
    expect(callback.headers.get("referrer-policy")).toBe("no-referrer");
    expect(callback.headers.get("content-security-policy")).toContain("form-action 'self';");
    return { grantId, vendorUrl };
  };
  return { env, storage, call, setup, proof };
}

test("HTTP flow requires deliberate browser consent and emits no credentials or cacheable callback", async () => {
  const f = fixture();
  const { grantId, vendorUrl } = await f.setup();
  expect(vendorUrl.origin).toBe("https://account.box.com");
  expect(vendorUrl.searchParams.get("scope")).not.toBe("admin");
  const collect = await f.call(`/v1/grants/${grantId}/collect`, {
    method: "POST",
    headers: { origin: "https://attacker.example", authorization: `Bearer ${f.proof}` },
  });
  expect(collect.status).toBe(403);
  expect(collect.headers.get("cache-control")).toBe("no-store");
  expect(collect.headers.get("access-control-allow-origin")).toBeNull();
  expect(await collect.text()).not.toContain(f.proof);
  expect((await f.call("/internal/start", { method: "POST" })).status).toBe(404);
  expect((await f.call("/v1/callback?state=foreign&code=private-code")).status).toBe(400);
});

test("Durable Object serializes concurrent collection so only one token exchange occurs", async () => {
  const f = fixture();
  const { grantId } = await f.setup();
  let release!: (value: Response) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  // Existing object captured fetch at construction. Recreate against the same
  // state to exercise crash restoration and the actual request serialization.
  const values = f.storage.get(grantId)!;
  const restored = new AuthGrant(
    {
      id: { toString: () => grantId },
      storage: {
        get: async (key: string) => structuredClone(values.get(key)),
        put: async (key: string, value: unknown) => {
          values.set(key, structuredClone(value));
        },
        setAlarm: async () => {},
        deleteAll: async () => values.clear(),
        deleteAlarm: async () => {},
      },
    } as unknown as DurableObjectState,
    f.env as unknown as Parameters<typeof worker.fetch>[1],
  );
  const request = () =>
    new Request(`https://auth.example/v1/grants/${grantId}/collect`, {
      method: "POST",
      headers: { authorization: `Bearer ${f.proof}` },
    });
  const first = restored.fetch(request());
  const second = restored.fetch(request());
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  release(
    Response.json({
      access_token: "private-access",
      refresh_token: "private-refresh",
      expires_in: 3600,
      token_type: "Bearer",
    }),
  );
  expect((await first).status).toBe(200);
  expect((await second).status).toBe(409);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.stringify([...values])).not.toContain("private-access");
  expect(JSON.stringify([...values])).not.toContain("private-refresh");
});

test("rate limits before creating grants and denies unavailable vendor bindings", async () => {
  const f = fixture();
  f.env.REQUEST_LIMITER.limit.mockResolvedValueOnce({ success: false });
  expect((await f.call("/v1/grants", { method: "POST", body: "{}" })).status).toBe(429);
  f.env.BOX_CLIENT_SECRET = "";
  expect(
    (
      await f.call("/v1/grants", {
        method: "POST",
        body: JSON.stringify({ vendorId: "box", proofHash: await digest(f.proof) }),
      })
    ).status,
  ).toBe(503);
  expect(f.storage.size).toBe(0);
});
