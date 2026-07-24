import { useSessionStore } from "@/stores/session-store";

/**
 * The single detection point for the code-index capability — the daemon-side
 * symbol index behind `code.symbols` / `code.outline` / `code.list_files`.
 * Callers hide their entry point when it is absent; there is no fallback path.
 * COMPAT(codeIndex): added in v0.4.4, drop the gate when daemon floor >= v0.4.4.
 */
export function useCodeIndexFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.codeIndex === true,
  );
}
