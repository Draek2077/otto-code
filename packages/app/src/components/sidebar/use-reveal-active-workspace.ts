import { useEffect, useRef } from "react";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { requestSidebarReveal } from "@/stores/sidebar-reveal-store";
import { workspaceRowKey } from "./sidebar-row-anchors";

// When the active workspace changes (route-derived), ask the sidebar to scroll
// that workspace's row into view. The reveal controller no-ops if the row isn't
// mounted in the current group mode's scroll container, so this is safe to fire
// unconditionally. Mount once inside the sidebar.
export function useRevealActiveWorkspace(): void {
  const selection = useActiveWorkspaceSelection();
  const serverId = selection?.serverId ?? null;
  const workspaceId = selection?.workspaceId ?? null;
  // Guard against re-requesting for the same workspace on unrelated re-renders.
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!serverId || !workspaceId) {
      lastKeyRef.current = null;
      return;
    }
    const key = workspaceRowKey(serverId, workspaceId);
    if (lastKeyRef.current === key) {
      return;
    }
    lastKeyRef.current = key;
    // Temporary diagnostic (see use-sidebar-reveal-controller). Remove once verified.
    console.warn("[SidebarReveal] producer requesting", key);
    requestSidebarReveal(key);
  }, [serverId, workspaceId]);
}
