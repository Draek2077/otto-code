import { useCallback, useEffect, useRef } from "react";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useIsCompactFormFactor } from "@/constants/layout";
import { usePanelStore } from "@/stores/panel-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { useBrowserStore } from "@/desktop/browser/store";
import { useHostBrowserClient } from "./client";
import { adoptHostBrowser } from "./adopt";

/** Explicit Open reveals an existing canonical tab; agent-created tabs remain background tabs. */
export function useRevealBrowser(serverId: string, workspaceId: string) {
  const client = useHostBrowserClient(serverId, workspaceId),
    retained = useRetainedPanelActive(),
    visible = useAppVisible(),
    compact = useIsCompactFormFactor();
  const authority = useRef<object | null>(null);
  useEffect(() => {
    if (!retained || !visible) return;
    const token = {};
    authority.current = token;
    return () => {
      if (authority.current === token) authority.current = null;
    };
  }, [retained, visible, serverId, workspaceId]);
  return useCallback(
    async (browserId: string) => {
      const owner = authority.current;
      if (!owner) return;
      const hosted = client && (await client.list()).find((tab) => tab.browserId === browserId);
      if (hosted && !(await adoptHostBrowser(serverId, hosted))) return;
      if (authority.current !== owner) return;
      if (!useBrowserStore.getState().browsersById[browserId])
        throw new Error("This browser is not available on this client.");
      const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
      if (workspaceKey) {
        useWorkspaceLayoutStore
          .getState()
          .openTab({ workspaceKey, target: { kind: "browser", browserId }, intent: "reveal" });
        if (compact) usePanelStore.getState().showMobileAgent();
      }
    },
    [client, compact, serverId, workspaceId],
  );
}
