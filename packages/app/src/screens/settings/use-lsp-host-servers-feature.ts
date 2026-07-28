import { useSessionStore } from "@/stores/session-store";

/**
 * The single detection point for host-wide language-server listing — the daemon answers
 * `lsp.servers.list` with no `cwd`.
 *
 * Settings is a host screen, so it asks the host question: what can this machine run. An
 * older daemon requires a `cwd` and rejects the request, and there is no client-side
 * substitute for probing another machine's PATH, so without the flag the screen says to
 * update the host rather than showing a screen that looks empty.
 *
 * COMPAT(lspHostServers): added in v0.7.3, drop the gate when daemon floor >= v0.7.3.
 */
export function useLspHostServersFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.lspHostServers === true,
  );
}
