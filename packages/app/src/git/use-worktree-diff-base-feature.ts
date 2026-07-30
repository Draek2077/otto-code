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

/**
 * Whether this host stores the diff base *per branch*.
 *
 * That is what lets any git checkout repoint it rather than only an Otto worktree: a plain
 * checkout's gitdir is shared by every branch in it, so one stored base would bleed across
 * branch switches. The same capability covers parent-branch detection, pinning an
 * `origin/`-qualified base, and the re-detect action.
 *
 * COMPAT(checkoutDiffBaseAnyRepo): added in v0.7.4, drop the gate when daemon
 * floor >= v0.7.4.
 */
export function useCheckoutDiffBaseAnyRepoFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.checkoutDiffBaseAnyRepo === true,
  );
}
