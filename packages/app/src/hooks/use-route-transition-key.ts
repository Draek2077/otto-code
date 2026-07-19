import { usePathname } from "expo-router";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";

/**
 * A string that changes exactly once per user-visible page transition, used to
 * trigger the app-wide route fade (RouteFadeContainer, per-platform).
 *
 * It is NOT just `usePathname()`: switching between already-open workspaces is a
 * WorkspaceDeck store swap (useActiveWorkspaceSelection flips which RetainedPanel
 * is active) plus a canonical-URL replace that `usePathname()` does not reactively
 * observe — so keying on pathname alone would skip the most common transition.
 * Folding the active workspace's serverId/workspaceId into the key makes deck
 * switches fade too. Navigating into a workspace changes both parts, but they
 * collapse into a single key value, so it still reads as one transition.
 */
export function useRouteTransitionKey(): string {
  const pathname = usePathname();
  const activeWorkspace = useActiveWorkspaceSelection();
  const isCompact = useIsCompactFormFactor();
  // Desktop settings is a persistent split view (its own sidebar + a content
  // pane), and navigating between settings pages swaps only the pane. Collapsing
  // every /settings* path into one key keeps this app-wide fade from veiling the
  // settings sidebar on each section change — the settings screen runs its own
  // pane-scoped fade instead (KeyedFadeContainer in settings-screen.tsx). On
  // compact layouts every settings page is a full-screen swap, so those keep
  // per-path keys and the normal full fade.
  if (!isCompact && pathname.startsWith("/settings")) {
    return "/settings";
  }
  return activeWorkspace
    ? `${pathname}::${activeWorkspace.serverId}:${activeWorkspace.workspaceId}`
    : pathname;
}
