import { useSessionStore } from "@/stores/session-store";

/**
 * The single detection point for the file-mutation capability — create, delete,
 * rename/move. There is no client-side substitute (the client never touches the
 * filesystem), so callers omit the affordance entirely rather than offering a
 * degraded one.
 *
 * COMPAT(fileMutations): added in v0.7.0, drop the gate when daemon floor >= v0.7.0.
 */
export function useFileMutationsFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.fileMutations === true,
  );
}
