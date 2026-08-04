import { useSessionStore } from "@/stores/session-store";

/**
 * The single detection point for the Solution view capability - the daemon can discover solutions
 * and serve `code.solution.*`.
 *
 * Deliberately **not** implied by `features.lsp`: there is no project-structure request in the
 * Language Server Protocol, so this subsystem is independent of language servers and of the C#
 * row's on/off state. Without the flag the client never shows the switcher and never asks; there
 * is no client-side substitute for reading a solution, and a hand-parsed half-tree is exactly the
 * class of mistake the whole design exists to avoid.
 *
 * The flag says the host can *serve* the feature, not that it is on. The switch itself lives in
 * the daemon config (`dotnetSolutionManagement`), and a host with it off simply reports no
 * solutions - which the client already treats as "no switcher", so nothing here has to know.
 *
 * COMPAT(solutionView): added in v0.6.8, drop the gate when daemon floor >= v0.6.8.
 */
export function useSolutionViewFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.solutionView === true,
  );
}
