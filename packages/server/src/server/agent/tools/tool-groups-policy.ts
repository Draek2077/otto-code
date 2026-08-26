import type { OttoToolGroup } from "@otto-code/protocol/provider-config";
import { resolveStoredOttoToolGroups } from "@otto-code/protocol/provider-config";
import type { DaemonConfigStore, MutableDaemonConfig } from "../../daemon-config-store.js";

/**
 * Live-read policy for the daemon-wide Otto tool-group allowlist on the MCP
 * (Claude) path. Mirrors DaemonConfigBrowserToolsPolicy: the MCP server is
 * rebuilt per request (stateless transport), so reading the store each call
 * makes group toggles take effect without a restart.
 *
 * `undefined` means "all groups enabled" - the same semantics openai-compat's
 * per-provider `ottoToolGroups` uses. An empty array means "no Otto tools".
 */
export interface OttoToolGroupsPolicy {
  getEnabledGroups(): OttoToolGroup[] | undefined;
}

export class DaemonConfigOttoToolGroupsPolicy implements OttoToolGroupsPolicy {
  public constructor(private readonly configStore: Pick<DaemonConfigStore, "get">) {}

  public getEnabledGroups(): OttoToolGroup[] | undefined {
    return readMcpToolGroups(this.configStore.get());
  }
}

function readMcpToolGroups(config: MutableDaemonConfig): OttoToolGroup[] | undefined {
  const mcp = config.mcp;
  if (typeof mcp !== "object" || mcp === null || Array.isArray(mcp)) {
    return undefined;
  }
  const stored = mcp as { toolGroups?: unknown; toolGroupsV2?: unknown };
  // COMPAT(ottoToolGroupsV2): v2 is authoritative; a config written before the
  // "agents" split carries only the legacy key and is migrated forward there.
  return resolveStoredOttoToolGroups({ v2: stored.toolGroupsV2, legacy: stored.toolGroups });
}
