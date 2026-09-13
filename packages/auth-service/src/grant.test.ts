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
      resolveVendor(id, { BOX_CLIENT_ID: "public-client", BOX_CLIENT_SECRET: "publisher-secret" }),
    "https://auth.example",
    fetcher,
    () => now,
  );
  const proof = randomSecret();
  const ready = async () => {
    await machine.start("box", await digest(proof));
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
