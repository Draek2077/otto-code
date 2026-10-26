import { useCallback, useEffect, useRef } from "react";
import { useFetchQuery } from "@/data/query";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useToast } from "@/contexts/toast-context";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { useHostBrowserClient } from "./client";
import { adoptHostBrowser } from "./adopt";

/** Shares the canonical query cache; only a visible workspace requests metadata, never paints. */
export function HostBrowserWorkspace({
  serverId,
  workspaceId,
  focused,
}: {
  serverId: string;
  workspaceId: string;
  focused: boolean;
}) {
  const client = useHostBrowserClient(serverId, workspaceId),
    visible = useAppVisible(),
    connected = useHostRuntimeIsConnected(serverId);
  const active = focused && visible && connected && client !== null;
  const seen = useRef(new Set<string>()),
    toast = useToast();
  const read = useCallback(async () => (client ? client.list() : []), [client]);
  const query = useFetchQuery({
    dataShape: "list",
    queryKey: ["ottoHostBrowserTabs", serverId, workspaceId],
    staleTimeMs: 1000,
    enabled: active,
    retry: false,
    refetchInterval: active ? 2000 : false,
    queryFn: read,
  });
  useEffect(() => {
    if (!active || !query.data) return;
    let live = true;
    void (async () => {
      for (const tab of query.data) {
        if (!live) return;
        try {
          if (!(await adoptHostBrowser(serverId, tab))) continue;
          if (!live || seen.current.has(tab.browserId)) continue;
          seen.current.add(tab.browserId);
          const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
          if (workspaceKey)
            useWorkspaceLayoutStore.getState().openTab({
              workspaceKey,
              target: { kind: "browser", browserId: tab.browserId },
              intent: "background",
            });
        } catch {
          if (live && !seen.current.has(tab.browserId))
            toast.error("A Host Browser tab could not be restored. Its saved data is preserved.");
          seen.current.add(tab.browserId);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [active, query.data, serverId, toast, workspaceId]);
  return null;
}
