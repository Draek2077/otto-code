/**
 * A thin promisified wrapper over the `tailscale` CLI - the OS boundary for the
 * `tailscale` TLS mode and the `listen.host: "tailscale"` bind. All Tailscale
 * interaction goes through here. Ported from otto-brain-relay's `tailscale.js`.
 *
 * The default executable is `tailscale` on PATH; a caller may pass an explicit
 * path (`tls.tailscaleExe`) when the CLI is installed somewhere non-standard
 * (e.g. `C:\Program Files\Tailscale\tailscale.exe`).
 */
import { execFile } from "node:child_process";

export const DEFAULT_TAILSCALE_EXE = "tailscale";

export interface RunResult {
  stdout: string;
  stderr: string;
}

/** Promisified execFile with a hard timeout and a useful error message. */
export function run(exe: string, args: string[], timeout = 120_000): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(exe, args, { timeout, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const detail = (stderr || stdout || error.message).toString().trim();
        reject(new Error(`\`${exe} ${args.join(" ")}\` failed: ${detail}`));
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** The tailnet IPv4 address of this machine (for a tailnet-only bind). */
export async function ipv4(exe: string = DEFAULT_TAILSCALE_EXE): Promise<string> {
  const { stdout } = await run(exe, ["ip", "-4"], 15_000);
  const address = stdout.trim().split(/\r?\n/)[0]?.trim();
  if (!address) throw new Error("tailscale reported no IPv4 address - is it connected?");
  return address;
}

/** This machine's MagicDNS name, e.g. greyskull.tail279562.ts.net (trailing dot stripped). */
export async function dnsName(exe: string = DEFAULT_TAILSCALE_EXE): Promise<string> {
  const { stdout } = await run(exe, ["status", "--json"], 15_000);
  const status: unknown = JSON.parse(stdout);
  const name =
    typeof status === "object" && status !== null
      ? (status as { Self?: { DNSName?: unknown } }).Self?.DNSName
      : undefined;
  if (typeof name !== "string" || !name) {
    throw new Error("could not read Self.DNSName from `tailscale status --json`");
  }
  return name.replace(/\.$/, "");
}

/**
 * Ask tailscaled for a Let's Encrypt cert for `hostname`, written to disk.
 * Idempotent: tailscaled serves a cached cert until it is near expiry.
 */
export async function issueCert(
  exe: string,
  hostname: string,
  certFile: string,
  keyFile: string,
): Promise<void> {
  await run(exe, ["cert", "--cert-file", certFile, "--key-file", keyFile, hostname], 180_000);
}

/** True if the tailscale CLI is present and the daemon answers. */
export async function isAvailable(exe: string = DEFAULT_TAILSCALE_EXE): Promise<boolean> {
  try {
    await run(exe, ["version"], 10_000);
    return true;
  } catch {
    return false;
  }
}
