import { useMemo } from "react";
import { useCheckoutDiffQuery } from "@/git/use-diff-query";
import { useCheckoutStatusQuery } from "@/git/use-status-query";
import { useChangesPreferences } from "@/hooks/use-changes-preferences";
import { buildReviewDraftScopeKey, useResolvedDiffMode } from "@/review";
import { usePanelStore } from "@/stores/panel-store";

const EMPTY_CHANGED_PATHS: ReadonlySet<string> = new Set<string>();

interface ChangedPathsInput {
  serverId: string;
  workspaceId?: string | null;
  /**
   * The checkout root, passed through verbatim. Give it the SAME string the
   * Changes pane gets as `cwd` — the diff query key is built from it, and a
   * differing spelling would open a second, redundant subscription instead of
   * sharing the one the Changes pane already holds.
   */
  cwd: string;
  enabled?: boolean;
}

/**
 * The set of file paths in the workspace's current diff — the same set the
 * Changes tab lists.
 *
 * "View changes" is only offered for a file the Changes tab can actually show,
 * so the surfaces that offer it (the Files tree, the file tab's toolbar) need
 * the changed-file list before the user asks. There is no lighter RPC for it:
 * the daemon serves the diff or nothing. So this mounts the very same
 * `useCheckoutDiffQuery` the Changes pane mounts, deriving every parameter the
 * same way, so the two resolve to one query key — one cache entry, and one
 * daemon subscription no matter how many of these are mounted (the push router
 * dedupes by subscription id, which is derived from the key).
 *
 * Anything that changes those parameters (diff mode, base ref, hide-whitespace)
 * must stay in sync with GitDiffPane, or this quietly starts paying for a
 * second subscription.
 */
export function useChangedFilePaths({
  serverId,
  workspaceId,
  cwd,
  enabled = true,
}: ChangedPathsInput): ReadonlySet<string> {
  const { status } = useCheckoutStatusQuery({ serverId, cwd });
  const { preferences: changesPreferences } = useChangesPreferences();
  const gitStatus = status && status.isGit ? status : null;
  const isGit = Boolean(gitStatus);
  const baseRef = gitStatus?.baseRef ?? undefined;
  const hasUncommittedChanges = Boolean(gitStatus?.isDirty);
  const ignoreWhitespace = changesPreferences.hideWhitespace;

  const scopeKey = useMemo(
    () =>
      buildReviewDraftScopeKey({
        serverId,
        workspaceId,
        cwd,
        baseRef,
        ignoreWhitespace,
      }),
    [baseRef, cwd, ignoreWhitespace, serverId, workspaceId],
  );
  const diffMode = useResolvedDiffMode({ scopeKey, hasUncommittedChanges });

  const { files } = useCheckoutDiffQuery({
    serverId,
    cwd,
    mode: diffMode,
    baseRef,
    ignoreWhitespace,
    enabled: enabled && isGit,
  });

  return useMemo(() => {
    if (files.length === 0) {
      return EMPTY_CHANGED_PATHS;
    }
    return new Set(files.map((file) => file.path));
  }, [files]);
}

/**
 * Send the user to this file's diff: stash the reveal, then switch the explorer
 * to Changes. Same shape as the Changes view's "Find in files" going the other
 * way — the destination pane consumes the request on mount, so this works
 * whether or not the Changes tab is currently rendered.
 *
 * `isGit: true` is safe to assert: every caller reached this through a path that
 * already proved the file is in the diff.
 */
export function revealFileInChanges({
  serverId,
  cwd,
  path,
}: {
  serverId: string;
  cwd: string;
  path: string;
}): void {
  const { requestChangesReveal, setExplorerTabForCheckout } = usePanelStore.getState();
  requestChangesReveal(path);
  setExplorerTabForCheckout({ serverId, cwd, isGit: true, tab: "changes" });
}
