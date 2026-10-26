import { useMemo } from "react";
import {
  clearBrowserHistory,
  recordBrowserHistory,
  searchBrowserHistory,
} from "@getpaseo/plugin/otto/browser-history";
import { useSessionStore } from "@/stores/session-store";
import { useHostFeature } from "@/runtime/host-features";
import type { BrowserHistoryPort } from "./history-model";

export function useBrowserHistoryPort(
  hostId: string,
  workspaceId: string,
): BrowserHistoryPort | null {
  // COMPAT(ottoBrowserHistory): added v0.10.0; remove after 2027-04-26 when host floor >= v0.10.0.
  const supported = useHostFeature(hostId, "ottoBrowserHistory");
  const client = useSessionStore((state) => state.sessions[hostId]?.client ?? null);
  return useMemo(() => {
    if (!supported || !client) return null;
    const scope = { hostId, workspaceId };
    const invoke = (method: string, input: unknown) =>
      client.invokePluginRpc("otto-browser", method, input);
    return {
      async search(query) {
        const response = searchBrowserHistory.output.parse(
          await invoke(searchBrowserHistory.name, { ...scope, query }),
        );
        if (!response.ok) throw new Error(response.error.message);
        return response.value;
      },
      async record(url, title) {
        const response = recordBrowserHistory.output.parse(
          await invoke(recordBrowserHistory.name, { ...scope, url, title }),
        );
        if (!response.ok) throw new Error(response.error.message);
      },
      async clear() {
        const response = clearBrowserHistory.output.parse(
          await invoke(clearBrowserHistory.name, { ...scope, userApprovedClear: true }),
        );
        if (!response.ok) throw new Error(response.error.message);
      },
    };
  }, [client, hostId, workspaceId, supported]);
}
