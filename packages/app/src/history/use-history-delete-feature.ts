import { useSessionStore } from "@/stores/session-store";

/**
 * The single detection point for hard delete of chat records — per-row delete and
 * the bulk archived clear.
 *
 * Per the feature contract there is no fallback path: an old daemon simply does
 * not offer delete, and the client says "update the host" instead of simulating
 * it. Archive keeps working on every daemon regardless — that is the protocol
 * contract doing its job, not a degraded build of this feature.
 *
 * COMPAT(historyDelete): added in v0.7.0, drop the gate when daemon floor >= v0.7.0.
 */
export function useHistoryDeleteFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.historyDelete === true,
  );
}

/**
 * Imperative form, for event handlers that only learn which host a row belongs to
 * at gesture time (the history list spans hosts, so a hook per row is not
 * available). Reads the same flag as {@link useHistoryDeleteFeature}.
 */
export function isHistoryDeleteSupported(serverId: string): boolean {
  return (
    useSessionStore.getState().sessions[serverId]?.serverInfo?.features?.historyDelete === true
  );
}
