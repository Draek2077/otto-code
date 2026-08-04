import { useSessionStore } from "@/stores/session-store";

/**
 * The single detection point for Refine.
 *
 * No fallback path by design: without a daemon that can run the rewrite there
 * is nothing to degrade to - the old behaviour was handing a prompt to a full
 * agent with no diff and no review, which is the thing Refine replaces.
 *
 * COMPAT(refine): added in v0.6.9, drop the gate when daemon floor >= v0.6.9.
 */
export function useRefineFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.refine === true,
  );
}
