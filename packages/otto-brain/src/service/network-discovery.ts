/** Explicit discovery only. No certificate issuance, configuration write or host launch. */
import { execFile } from "node:child_process";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { z } from "zod/v3";
import type { BrainConfig } from "../config/schema.js";
import type { BrainPaths } from "../config/paths.js";

export interface BrainNetworkPorts {
  addresses(): { address: string; label: string }[];
  tailscale(executable: string, signal: AbortSignal): Promise<unknown>;
}
function hostAddresses() {
  const rows: { address: string; label: string }[] = [];
  for (const [name, interfaces] of Object.entries(networkInterfaces())) {
    for (const entry of interfaces ?? [])
      rows.push({ address: entry.address, label: `${name} (${entry.address})` });
  }
  return rows;
}
function tailscaleStatus(executable: string, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      ["status", "--json"],
      { signal, timeout: 3000, windowsHide: true, maxBuffer: 256 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (parseError) {
          reject(parseError);
        }
      },
    );
  });
}
const SelfSchema = z.object({
  Self: z.object({ DNSName: z.string().min(1).max(253) }),
  BackendState: z.literal("Running"),
});

export async function discoverBrainNetwork(
  ownerId: string,
  config: BrainConfig,
  paths: BrainPaths,
  signal: AbortSignal,
  ports: BrainNetworkPorts = { addresses: hostAddresses, tailscale: tailscaleStatus },
) {
  signal.throwIfAborted();
  const seen = new Set<string>();
  const addresses = ports
    .addresses()
    .filter((row) => {
      if (seen.has(row.address)) return false;
      seen.add(row.address);
      return true;
    })
    .map((row) => ({ id: row.address, label: row.label }));
  let hostname: string | null = null;
  try {
    const status = SelfSchema.safeParse(
      await ports.tailscale(config.tls.tailscaleExe ?? "tailscale", signal),
    );
    if (status.success) hostname = status.data.Self.DNSName.replace(/\.$/u, "");
  } catch {
    signal.throwIfAborted();
  }
  signal.throwIfAborted();
  return {
    ownerId,
    addresses,
    tailscale: {
      available: hostname !== null,
      hostname,
      certificateDirectory: hostname
        ? (config.tls.certDir ?? path.join(paths.root, "certs"))
        : null,
    },
  };
}
