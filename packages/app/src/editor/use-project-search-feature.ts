import { useSessionStore } from "@/stores/session-store";

/**
 * The single detection point for the project-search capability.
 * COMPAT(projectSearch): added in v0.4.4, drop the gate when daemon floor >= v0.4.4.
 */
export function useProjectSearchFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.projectSearch === true,
  );
}
