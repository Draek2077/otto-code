import { useSessionStore } from "@/stores/session-store";

/**
 * Whether this host can repoint a worktree's stored base branch
 * (`worktree.baseRef.set.*`).
 *
 * There is no client-side fallback: only the daemon can write the worktree's
 * metadata, so without the capability the base stays a read-only label.
 *
 * COMPAT(worktreeDiffBase): added in v0.6.8, drop the gate when daemon
 * floor >= v0.6.8.
 */
export function useWorktreeDiffBaseFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.worktreeDiffBase === true,
  );
}
