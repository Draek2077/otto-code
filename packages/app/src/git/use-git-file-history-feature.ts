import { useSessionStore } from "@/stores/session-store";

/**
 * Whether this host serves the local-git file investigation RPCs (history,
 * per-commit diff, blame, origin commit).
 *
 * There is deliberately no per-provider variant of this check: the capability is
 * git, not an agent, so it is either present on the host or it isn't.
 *
 * COMPAT(checkoutGitFileHistory): added in v0.6.6, drop the gate when daemon
 * floor >= v0.6.6.
 */
export function useGitFileHistoryFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.checkoutGitFileHistory === true,
  );
}
