import { describe, expect, test, vi } from "vitest";
import { ATTEMPT_TTL, GrantMachine, digest, randomSecret, type GrantRecord } from "./grant";
import { resolveVendor } from "./vendors";

function fixture(
  fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({
      access_token: "access-secret",
      refresh_token: "refresh-secret",
      expires_in: 3600,
      token_type: "bearer",
    }),
  ),
  vendorId = "box",
) {
  let record: GrantRecord | undefined;
  let now = Date.now();
  const writes: string[] = [];
  const machine = new GrantMachine(
    {
      get: async () => record && structuredClone(record),
      put: async (value) => {
        record = structuredClone(value);
        writes.push(JSON.stringify(value));
      },
      delete: async () => {
        record = undefined;
      },
    },
    (id) =>
      resolveVendor(id, {
        BOX_CLIENT_ID: "public-client",
        BOX_CLIENT_SECRET: "publisher-secret",
        HUBSPOT_CLIENT_ID: "hubspot-client",
        HUBSPOT_CLIENT_SECRET: "hubspot-publisher-secret",
      }),
    "https://auth.example",
    fetcher,
    () => now,
  );
  const proof = randomSecret();
  const ready = async () => {
    await machine.start(vendorId, await digest(proof));
    const state = (await machine.view()).state;
    const url = new URL(await machine.authorize("a".repeat(64), state));
    await machine.callback(state, "one-use-code", false);
    return url;
  };
  return {
    machine,
    proof,
    ready,
    fetcher,
    writes,
    record: () => record,
    expire: () => {
      now += ATTEMPT_TTL + 1;
    },
  };
}

describe("host-bound publisher OAuth grants", () => {
  test("HubSpot generates per-attempt PKCE, accepts vendor scopes and uses confidential refresh/revocation", async () => {
    const f = fixture(undefined, "hubspot");
    const other = fixture(undefined, "hubspot");
    const url = await f.ready();
    const otherUrl = await other.ready();
    expect(url.origin + url.pathname).toBe("https://mcp.hubspot.com/oauth/authorize/user");
    expect(url.searchParams.get("client_id")).toBe("hubspot-client");
    expect(url.searchParams.has("scope")).toBe(false);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(await digest(f.record()!.verifier!));
    expect(url.searchParams.get("code_challenge")).not.toBe(
      otherUrl.searchParams.get("code_challenge"),
    );
    const verifier = f.record()!.verifier;
    f.fetcher.mockResolvedValueOnce(
      Response.json({
        access_token: "hubspot-access",
        refresh_token: "hubspot-refresh",
        expires_in: 1800,
        token_type: "bearer",
        scopes: ["crm.objects.contacts.read"],
      }),
    );
    expect(await f.machine.collect(f.proof)).toMatchObject({
      scopes: ["crm.objects.contacts.read"],
    });
    expect(f.fetcher.mock.calls[0][0]).toBe("https://mcp.hubspot.com/oauth/v3/token");
    const exchange = new URLSearchParams(String(f.fetcher.mock.calls[0][1]?.body));
    expect(exchange.get("code_verifier")).toBe(verifier);
    expect(exchange.get("client_secret")).toBe("hubspot-publisher-secret");
    await f.machine.refresh(f.proof, "hubspot-refresh");
    expect(new URLSearchParams(String(f.fetcher.mock.calls[1][1]?.body)).get("grant_type")).toBe(
      "refresh_token",
    );
    f.fetcher.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await f.machine.revoke(f.proof, "refresh-secret");
    expect(f.fetcher.mock.calls[2][0]).toBe("https://api.hubapi.com/oauth/2026-09/token/revoke");
    const revoke = new URLSearchParams(String(f.fetcher.mock.calls[2][1]?.body));
    expect(revoke.get("token_type_hint")).toBe("refresh_token");
    expect(revoke.get("token")).toBe("refresh-secret");
    expect(f.writes.join("\n")).not.toMatch(
      /hubspot-access|hubspot-refresh|hubspot-publisher-secret/,
    );
    expect(f.record()).toBeUndefined();
  });

  test.each(
    [["x".repeat(201)], ["scope with spaces"], [12], Array(101).fill("scope"), "not-an-array"].map(
      (scopes) => ({ scopes }),
    ),
  )("rejects malformed or excessive HubSpot scope metadata: $scopes", async ({ scopes }) => {
    const f = fixture(undefined, "hubspot");
    await f.ready();
    f.fetcher.mockResolvedValueOnce(
      Response.json({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 1800,
        token_type: "bearer",
        scopes,
      }),
    );
    await expect(f.machine.collect(f.proof)).rejects.toThrow("reconnect_required");
  });

  test("does not accept a vendor-managed scope grant for Box or enable HubSpot without both bindings", async () => {
    expect(resolveVendor("hubspot", { HUBSPOT_CLIENT_ID: "public-client" })).toBeNull();
    expect(resolveVendor("hubspot", { HUBSPOT_CLIENT_SECRET: "secret" })).toBeNull();
    const f = fixture();
    await f.ready();
    f.fetcher.mockResolvedValueOnce(
      Response.json({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 1800,
        token_type: "bearer",
        scopes: ["admin"],
      }),
    );
    await expect(f.machine.collect(f.proof)).rejects.toThrow("reconnect_required");
  });
  test("binds redirect, vendor, state and PKCE; never persists returned tokens", async () => {
    const f = fixture();
    const url = await f.ready();
    expect(url.origin).toBe("https://account.box.com");
    expect(url.searchParams.get("redirect_uri")).toBe("https://auth.example/v1/callback");
    expect(url.searchParams.get("scope")).toBe("root_readwrite ai.readwrite");
    expect(url.searchParams.get("code_challenge")).toBe(await digest(f.record()!.verifier!));
    expect(url.toString()).not.toContain("publisher-secret");
    expect(await f.machine.collect(f.proof)).toMatchObject({
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
    });
    const sent = new URLSearchParams(String(f.fetcher.mock.calls[0][1]?.body));
    expect(sent.get("client_secret")).toBe("publisher-secret");
    expect(sent.get("code")).toBe("one-use-code");
    expect(f.fetcher.mock.calls[0][1]?.redirect).toBe("manual");
    expect(f.record()).toMatchObject({
      stage: "active",
      refreshHash: await digest("refresh-secret"),
    });
    expect(f.record()?.code).toBeUndefined();
    expect(f.record()?.verifier).toBeUndefined();
    expect(f.writes.join("\n")).not.toMatch(/access-secret|refresh-secret|publisher-secret/);
    await expect(f.machine.collect(f.proof)).rejects.toMatchObject({ code: "reconnect_required" });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });

  test("rejects another host's proof, foreign state, unsupported vendor, and arbitrary refresh tokens", async () => {
    const f = fixture();
    await expect(f.machine.start("attacker-url", await digest(f.proof))).rejects.toMatchObject({
      code: "vendor_unavailable",
    });
    await f.ready();
    await expect(f.machine.callback(randomSecret(), "injected", false)).rejects.toMatchObject({
      code: "invalid_attempt",
    });
    await expect(f.machine.collect(randomSecret())).rejects.toMatchObject({ code: "unauthorized" });
    expect(f.fetcher).not.toHaveBeenCalled();
    await f.machine.collect(f.proof);
    await expect(f.machine.refresh(f.proof, "someone-elses-token")).rejects.toMatchObject({
      code: "reconnect_required",
    });
    await expect(f.machine.refresh(randomSecret(), "refresh-secret")).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });

  test("rotates refresh authority and rejects the previous token", async () => {
    const f = fixture();
    await f.ready();
    await f.machine.collect(f.proof);
    f.fetcher.mockResolvedValueOnce(
      Response.json({
        access_token: "access-new",
        refresh_token: "refresh-new",
        expires_in: 3600,
        token_type: "Bearer",
      }),
    );
    await expect(f.machine.refresh(f.proof, "refresh-secret")).resolves.toMatchObject({
      refreshToken: "refresh-new",
    });
    await expect(f.machine.refresh(f.proof, "refresh-secret")).rejects.toMatchObject({
      code: "reconnect_required",
    });
    expect(f.writes.join("\n")).not.toContain("refresh-new");
    f.fetcher.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await f.machine.revoke(f.proof, "refresh-new");
    expect(f.record()).toBeUndefined();
  });

  test.each(["collect", "refresh"] as const)(
    "does not replay a potentially consumed %s after a network failure",
    async (operation) => {
      const f = fixture();
      await f.ready();
      if (operation === "refresh") await f.machine.collect(f.proof);
      f.fetcher.mockRejectedValue(new Error("private vendor payload"));
      const call = () =>
        operation === "collect"
          ? f.machine.collect(f.proof)
          : f.machine.refresh(f.proof, "refresh-secret");
      await expect(call()).rejects.toThrow("reconnect_required");
      const count = f.fetcher.mock.calls.length;
      await expect(call()).rejects.toThrow("reconnect_required");
      expect(f.fetcher).toHaveBeenCalledTimes(count);
    },
  );

  test("expires abandoned attempts and handles denial without vendor calls", async () => {
    const f = fixture();
    await f.ready();
    f.expire();
    await expect(f.machine.collect(f.proof)).rejects.toMatchObject({ code: "expired" });
    expect(f.record()).toBeUndefined();
    expect(f.fetcher).not.toHaveBeenCalled();
    await f.machine.start("box", await digest(f.proof));
    const view = await f.machine.view();
    await f.machine.authorize("a".repeat(64), view.state);
    await expect(f.machine.callback(view.state, null, true)).rejects.toMatchObject({
      code: "authorization_denied",
    });
    await expect(f.machine.collect(f.proof)).rejects.toMatchObject({ code: "reconnect_required" });
  });

  test("rejects a redirected token response without following it or exposing credentials", async () => {
    const f = fixture();
    await f.ready();
    f.fetcher.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "https://attacker.example" } }),
    );
    await expect(f.machine.collect(f.proof)).rejects.toThrow("reconnect_required");
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(f.fetcher.mock.calls[0][1]?.redirect).toBe("manual");
  });
});
