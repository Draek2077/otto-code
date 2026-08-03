import * as dns from "node:dns";
import * as net from "node:net";

// ---------------------------------------------------------------------------
// SSRF screening shared by web_fetch and the browser tools.
//
// Two policies live here because the two surfaces have opposite relationships
// with the local network:
//
// - web_fetch (`isBlockedIp`) is a headless daemon-side fetch nobody watches,
//   so everything internal is blocked: loopback, RFC 1918, CGNAT, link-local,
//   unique-local, multicast, reserved.
// - browser_navigate / browser_new_tab (`isBlockedBrowserIp`,
//   `screenBrowserUrl`) drive the user-visible Otto browser pane, whose whole
//   purpose is loopback previews and dev servers. Loopback is allowed
//   unconditionally rather than only-when-a-preview-server-matches: adopted
//   servers nobody declared in launch.json are a documented flow
//   (docs/preview.md), and the preview-server list is an optional dependency
//   of the browser tools that may be absent entirely. Private LAN (RFC 1918,
//   IPv6 ULA) and CGNAT stay reachable too — browsing another device's dev
//   build or a Tailscale node (Tailscale assigns from 100.64.0.0/10 and
//   fd7a::/48) is legitimate on a visible surface, and navigation prompts in
//   default permission mode. What must never be reachable is anything that
//   yields credentials silently or has no browsing use at all: link-local
//   (cloud instance metadata at 169.254.169.254 — the credential-exfiltration
//   chain this screen exists to break), the Alibaba/OpenStack metadata IP
//   inside CGNAT, and the unroutable special-use ranges.
// ---------------------------------------------------------------------------

/**
 * IP ranges that must never be reachable from web_fetch.
 * Covers: loopback, link-local, private (RFC 1918), carrier-grade,
 * unique-local, multicast, reserved, and cloud metadata endpoints.
 */
export const BLOCKED_IP_RANGES: Array<[string, string]> = [
  // Loopback: 127.0.0.0/8
  ["127.0.0.0", "127.255.255.255"],
  // Link-local: 169.254.0.0/16
  ["169.254.0.0", "169.254.255.255"],
  // Private: 10.0.0.0/8
  ["10.0.0.0", "10.255.255.255"],
  // Private: 172.16.0.0/12
  ["172.16.0.0", "172.31.255.255"],
  // Private: 192.168.0.0/16
  ["192.168.0.0", "192.168.255.255"],
  // Carrier-grade NAT: 100.64.0.0/10
  ["100.64.0.0", "100.127.255.255"],
  // Documentation: 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24
  // (not strictly needed but defensive)
  ["192.0.2.0", "192.0.2.255"],
  ["198.51.100.0", "198.51.100.255"],
  ["203.0.113.0", "203.0.113.255"],
  // Benchmarking: 198.18.0.0/15
  ["198.18.0.0", "198.19.255.255"],
  // Multicast: 224.0.0.0/4
  ["224.0.0.0", "239.255.255.255"],
  // Reserved + broadcast: 240.0.0.0/4
  ["240.0.0.0", "255.255.255.255"],
  // Any local: 0.0.0.0/8
  ["0.0.0.0", "0.255.255.255"],
];

/**
 * IP ranges blocked for browser_navigate / browser_new_tab. Deliberately
 * narrower than BLOCKED_IP_RANGES — see the module comment for which local
 * ranges stay reachable and why.
 */
export const BROWSER_BLOCKED_IP_RANGES: Array<[string, string]> = [
  // "This network": 0.0.0.0/8
  ["0.0.0.0", "0.255.255.255"],
  // Alibaba/OpenStack cloud metadata. A single IP, not the whole CGNAT
  // block — Tailscale legitimately occupies the rest of 100.64.0.0/10.
  ["100.100.100.200", "100.100.100.200"],
  // Link-local: 169.254.0.0/16 — AWS/GCP/Azure instance metadata lives here.
  ["169.254.0.0", "169.254.255.255"],
  // Documentation: 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24
  ["192.0.2.0", "192.0.2.255"],
  ["198.51.100.0", "198.51.100.255"],
  ["203.0.113.0", "203.0.113.255"],
  // Benchmarking: 198.18.0.0/15
  ["198.18.0.0", "198.19.255.255"],
  // Multicast: 224.0.0.0/4
  ["224.0.0.0", "239.255.255.255"],
  // Reserved + broadcast: 240.0.0.0/4
  ["240.0.0.0", "255.255.255.255"],
];

/**
 * Convert an IPv4 address string to an unsigned 32-bit integer for range
 * comparison. Throws on anything that is not a dotted quad.
 */
function ipv4ToNumber(ip: string): number {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    throw new Error(`Not an IPv4 address: ${ip}`);
  }
  let value = 0;
  for (const part of parts) {
    const octet = Number.parseInt(part, 10);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      throw new Error(`Not an IPv4 address: ${ip}`);
    }
    value = (value * 256 + octet) >>> 0;
  }
  return value;
}

/**
 * Extract the IPv4 address embedded in an IPv4-mapped IPv6 address
 * (::ffff:a.b.c.d, including the hex form ::ffff:aabb:ccdd). Returns null for
 * anything else. Mapped addresses must be screened with the IPv4 rules — a
 * socket to ::ffff:127.0.0.1 reaches loopback.
 */
function extractMappedIpv4(lowerIp: string): string | null {
  const dotted = lowerIp.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u);
  if (dotted) {
    return dotted[1];
  }
  const hex = lowerIp.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u);
  if (hex) {
    const high = Number.parseInt(hex[1], 16);
    const low = Number.parseInt(hex[2], 16);
    return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
  }
  return null;
}

function isBlockedIpv4(ip: string, ranges: Array<[string, string]>): boolean {
  try {
    const num = ipv4ToNumber(ip);
    for (const [start, end] of ranges) {
      if (num >= ipv4ToNumber(start) && num <= ipv4ToNumber(end)) {
        return true;
      }
    }
  } catch {
    // Unparseable IP — block it defensively
    return true;
  }
  return false;
}

/**
 * Check whether an IP address falls within any range blocked for web_fetch.
 * Returns true if the IP is dangerous and should be blocked.
 */
export function isBlockedIp(ip: string): boolean {
  // IPv6: block loopback (::1), unique-local (fc00::/7), multicast (ff00::/8),
  // link-local (fe80::/10, over-broadly as fe*), and IPv4-mapped addresses
  // whose embedded IPv4 is blocked.
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    const mapped = extractMappedIpv4(lower);
    if (mapped !== null) {
      return isBlockedIp(mapped);
    }
    return (
      lower === "::1" ||
      lower === "::" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe") ||
      lower.startsWith("ff")
    );
  }

  return isBlockedIpv4(ip, BLOCKED_IP_RANGES);
}

/**
 * Check whether an IP address is blocked for the browser tools. IPv6 mirrors
 * the browser IPv4 policy: loopback (::1) and unique-local fc00::/7 (private
 * LAN, Tailscale) stay reachable; link-local (fe80::/10, over-broadly as fe*
 * to match isBlockedIp), multicast (ff00::/8), and the unspecified address do
 * not.
 */
export function isBlockedBrowserIp(ip: string): boolean {
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    const mapped = extractMappedIpv4(lower);
    if (mapped !== null) {
      return isBlockedBrowserIp(mapped);
    }
    return lower === "::" || lower.startsWith("fe") || lower.startsWith("ff");
  }

  return isBlockedIpv4(ip, BROWSER_BLOCKED_IP_RANGES);
}

export interface ResolvedHostAddress {
  address: string;
  family: number;
}

export type LookupAllFunction = (
  host: string,
  options: { all: true },
) => Promise<ResolvedHostAddress[]>;

async function defaultLookup(host: string, options: { all: true }): Promise<ResolvedHostAddress[]> {
  return dns.promises.lookup(host, options);
}

/**
 * Decide whether the browser tools may point a tab at a URL. Returns a
 * model-readable refusal message when the destination is blocked, or null when
 * navigation may proceed.
 *
 * Hostnames are resolved with getaddrinfo and every resolved address is
 * screened — the same approach web_fetch's validateHostname takes — so a DNS
 * name pointing at 169.254.169.254 is caught, not just the literal IP. Unlike
 * web_fetch the daemon cannot pin the webview's sockets to the validated
 * addresses (Chromium resolves independently), so a low-TTL DNS rebind between
 * this check and the page load remains possible; closing that would require
 * proxying all webview traffic. DNS failure blocks: the load would fail
 * anyway, and a resolver that answers the browser but not the daemon is
 * itself suspect.
 *
 * localhost / *.localhost skip DNS and are always allowed — Chromium maps them
 * to loopback without consulting the resolver, and loopback is exactly what
 * the preview pane exists to show.
 */
export async function screenBrowserUrl(
  urlString: string,
  options?: { lookup?: LookupAllFunction | undefined },
): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return `Blocked: '${urlString}' is not a valid URL`;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return "Blocked: only http:// and https:// URLs are allowed";
  }

  const host = parsed.hostname;
  if (host === "localhost" || host.endsWith(".localhost")) {
    return null;
  }

  // URL.hostname keeps the brackets around IPv6 literals.
  const literal = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (net.isIP(literal) !== 0) {
    return isBlockedBrowserIp(literal) ? blockedBrowserHostMessage(literal, null) : null;
  }

  const lookup = options?.lookup ?? defaultLookup;
  let results: ResolvedHostAddress[];
  try {
    results = await lookup(host, { all: true });
  } catch {
    return `Blocked: DNS resolution failed for '${host}'`;
  }
  if (results.length === 0) {
    return `Blocked: DNS resolution failed for '${host}'`;
  }
  for (const { address } of results) {
    if (isBlockedBrowserIp(address)) {
      return blockedBrowserHostMessage(host, address);
    }
  }
  return null;
}

function blockedBrowserHostMessage(host: string, resolvedAddress: string | null): string {
  const target = resolvedAddress ? `'${host}' resolved to ${resolvedAddress}, which` : `'${host}'`;
  return (
    `Blocked: ${target} is in a restricted network range. Link-local/cloud-metadata addresses ` +
    `and other special-use ranges are not reachable from browser tools; loopback and ` +
    `private-LAN hosts are.`
  );
}
