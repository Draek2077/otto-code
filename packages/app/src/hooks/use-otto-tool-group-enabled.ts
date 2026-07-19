import type { OttoToolGroup } from "@otto-code/protocol/provider-config";
import { useDaemonConfig } from "@/hooks/use-daemon-config";

// The bridge between the daemon-wide Otto tool-group allowlist (host-side tool
// availability) and app UI visibility. The DAEMON's `mcp.toolGroups` set is the
// single source of truth: when a group is disabled on the host, the app hides
// the corresponding UI feature/entry point — there is no separate device-local
// switch to keep in sync.
//
// Semantics mirror the daemon: undefined toolGroups = every group enabled, so a
// host that has never touched categories (or an old daemon that predates the
// feature) shows every feature exactly as before. Presentation-only features
// with no daemon tool group (e.g. the Visualizer) keep using the device-local
// feature-catalog flag instead — this hook is only for features backed by a
// tool group.
export function useOttoToolGroupEnabled(serverId: string | null, group: OttoToolGroup): boolean {
  const { config } = useDaemonConfig(serverId);
  const groups = config?.mcp?.toolGroups;
  if (!Array.isArray(groups)) {
    return true;
  }
  return groups.includes(group);
}
