import { describe, expect, test } from "vitest";
import {
  isBlockedBrowserIp,
  isBlockedIp,
  screenBrowserUrl,
  type ResolvedHostAddress,
} from "./url-screen.js";

function lookupReturning(...addresses: string[]) {
  return async (): Promise<ResolvedHostAddress[]> =>
    addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
}

async function failingLookup(): Promise<ResolvedHostAddress[]> {
  throw new Error("ENOTFOUND");
}

describe("isBlockedIp (web_fetch policy)", () => {
  test.each([
    "127.0.0.1",
    "10.0.0.5",
    "172.16.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "169.254.169.254",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fd00::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "not-an-ip",
  ])("blocks %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  test.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "2607:f8b0:4004:c07::93"])(
    "allows public address %s",
    (ip) => {
      expect(isBlockedIp(ip)).toBe(false);
    },
  );
});

describe("isBlockedBrowserIp (browser-tools policy)", () => {
  // Loopback, private LAN, CGNAT (Tailscale), and IPv6 ULA stay reachable -
  // previews, dev servers, and LAN devices are the browser pane's purpose.
  test.each([
    "127.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "10.0.0.5",
    "172.16.0.1",
    "192.168.1.1",
    "100.100.1.1",
    "fd7a:115c:a1e0::1",
    "8.8.8.8",
  ])("allows %s", (ip) => {
    expect(isBlockedBrowserIp(ip)).toBe(false);
  });

  test.each([
    // Link-local: cloud instance metadata.
    "169.254.169.254",
    "169.254.0.1",
    // Alibaba/OpenStack metadata IP inside CGNAT.
    "100.100.100.200",
    // Special-use ranges with no browsing use.
    "0.0.0.0",
    "192.0.2.1",
    "198.18.0.5",
    "224.0.0.1",
    "255.255.255.255",
    // IPv6 link-local, multicast, unspecified, and mapped-v4 link-local.
    "fe80::1",
    "ff02::1",
    "::",
    "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe",
    "not-an-ip",
  ])("blocks %s", (ip) => {
    expect(isBlockedBrowserIp(ip)).toBe(true);
  });
});

describe("screenBrowserUrl", () => {
  test("allows localhost without consulting DNS", async () => {
    expect(await screenBrowserUrl("http://localhost:3000/", { lookup: failingLookup })).toBeNull();
    expect(
      await screenBrowserUrl("http://app.localhost:3000/", { lookup: failingLookup }),
    ).toBeNull();
  });

  test("allows loopback and private-LAN IP literals without consulting DNS", async () => {
    expect(await screenBrowserUrl("http://127.0.0.1:6788/", { lookup: failingLookup })).toBeNull();
    expect(await screenBrowserUrl("http://[::1]:5173/", { lookup: failingLookup })).toBeNull();
    expect(await screenBrowserUrl("http://192.168.1.50/", { lookup: failingLookup })).toBeNull();
    expect(
      await screenBrowserUrl("http://100.100.1.1:1235/", { lookup: failingLookup }),
    ).toBeNull();
  });

  test("blocks the cloud metadata endpoint by literal", async () => {
    const message = await screenBrowserUrl("http://169.254.169.254/latest/meta-data/");
    expect(message).toContain("restricted network range");
  });

  test("blocks IPv6 link-local literals", async () => {
    expect(await screenBrowserUrl("http://[fe80::1]/")).toContain("restricted network range");
  });

  test("blocks a hostname that resolves to a blocked address (DNS rebinding)", async () => {
    const message = await screenBrowserUrl("http://evil.example/", {
      lookup: lookupReturning("169.254.169.254"),
    });
    expect(message).toContain("resolved to 169.254.169.254");
  });

  test("blocks when any resolved address is blocked", async () => {
    const message = await screenBrowserUrl("http://evil.example/", {
      lookup: lookupReturning("93.184.216.34", "169.254.169.254"),
    });
    expect(message).toContain("restricted network range");
  });

  test("allows a hostname that resolves cleanly", async () => {
    expect(
      await screenBrowserUrl("https://example.com/", { lookup: lookupReturning("93.184.216.34") }),
    ).toBeNull();
  });

  test("blocks on DNS failure or empty resolution", async () => {
    expect(await screenBrowserUrl("http://nx.example/", { lookup: failingLookup })).toContain(
      "DNS resolution failed",
    );
    expect(await screenBrowserUrl("http://nx.example/", { lookup: lookupReturning() })).toContain(
      "DNS resolution failed",
    );
  });

  test("blocks non-http protocols and unparseable URLs defensively", async () => {
    expect(await screenBrowserUrl("ftp://example.com/")).toContain("http://");
    expect(await screenBrowserUrl("::::")).toContain("not a valid URL");
  });
});
