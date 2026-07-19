import type { OttoToolGroup } from "@otto-code/protocol/provider-config";
import { OTTO_TOOL_GROUPS } from "@otto-code/protocol/provider-config";
import type { DaemonConfigStore, MutableDaemonConfig } from "../../daemon-config-store.js";

/**
 * Live-read policy for the daemon-wide Otto tool-group allowlist on the MCP
 * (Claude) path. Mirrors DaemonConfigBrowserToolsPolicy: the MCP server is
 * rebuilt per request (stateless transport), so reading the store each call
 * makes group toggles take effect without a restart.
 *
 * `undefined` means "all groups enabled" — the same semantics openai-compat's
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

const OTTO_TOOL_GROUP_SET = new Set<string>(OTTO_TOOL_GROUPS);

function readMcpToolGroups(config: MutableDaemonConfig): OttoToolGroup[] | undefined {
  const mcp = config.mcp;
  if (typeof mcp !== "object" || mcp === null || Array.isArray(mcp)) {
    return undefined;
  }
  const groups = (mcp as { toolGroups?: unknown }).toolGroups;
  if (!Array.isArray(groups)) {
    return undefined;
  }
  return groups.filter(
    (group): group is OttoToolGroup => typeof group === "string" && OTTO_TOOL_GROUP_SET.has(group),
  );
}
