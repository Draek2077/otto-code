import { useSessionStore } from "@/stores/session-store";

/**
 * The single detection point for the text-editor capability.
 * COMPAT(textEditor): added in v0.4.4, drop the gate when daemon floor >= v0.4.4.
 */
export function useTextEditorFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.textEditor === true,
  );
}
