import { useMemo } from "react";
import {
  readHostBrowserTabs,
  executeHostBrowser,
  watchHostBrowser,
  detachHostBrowser,
  ackHostBrowser,
  inputHostBrowser,
  type HostBrowserTab,
} from "@getpaseo/plugin/otto/host-browser";
import type { BrowserAutomationCommand } from "@getpaseo/protocol/browser-automation/rpc-schemas";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useHostFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import { updateHostBrowser } from "./adopt";
import type { HostViewerPort } from "./viewer-model";

export function createHostBrowserClient(client: DaemonClient, hostId: string, workspaceId: string) {
  const scope = { hostId, workspaceId };
  const invoke = (method: string, input: unknown) =>
    client.invokePluginRpc("otto-browser", method, input);
  const list = async (): Promise<HostBrowserTab[]> => {
    const result = readHostBrowserTabs.output.parse(await invoke(readHostBrowserTabs.name, scope));
    if (!result.ok) throw new Error(result.error);
    return result.value;
  };
  return {
    list,
    async command(command: BrowserAutomationCommand) {
      const response = executeHostBrowser.output.parse(
        await invoke(executeHostBrowser.name, { ...scope, command }),
      );
      if (!response.ok) throw new Error(response.error.message);
      return response.result;
    },
    viewer(browserId: string): HostViewerPort {
      return {
        ticket: () => globalThis.crypto.randomUUID(),
        observe: (ticket, observer) => client.observeHostBrowserPaint(ticket, observer),
        async watch(ticket) {
          const result = watchHostBrowser.output.parse(
            await invoke(watchHostBrowser.name, { ...scope, browserId, ticket }),
          );
          if (!result.ok) throw new Error(result.error);
          return result.value;
        },
        async detach(ticket) {
          const result = detachHostBrowser.output.parse(
            await invoke(detachHostBrowser.name, { ...scope, ticket }),
          );
          if (!result.ok) throw new Error(result.error);
        },
        async acknowledge(ticket, sequence) {
          const result = ackHostBrowser.output.parse(
            await invoke(ackHostBrowser.name, { ...scope, ticket, sequence }),
          );
          if (!result.ok) throw new Error(result.error);
          return result.value;
        },
        async input(ticket, event) {
          const result = inputHostBrowser.output.parse(
            await invoke(inputHostBrowser.name, { ...scope, ticket, event }),
          );
          if (!result.ok) throw new Error(result.error);
        },
        update: updateHostBrowser,
      };
    },
  };
}
export type HostBrowserClient = ReturnType<typeof createHostBrowserClient>;
export function useHostBrowserClient(
  hostId: string,
  workspaceId: string,
): HostBrowserClient | null {
  // COMPAT(ottoHostBrowser): added v0.10.0; remove after 2027-04-26 when host floor >= v0.10.0.
  const supported = useHostFeature(hostId, "ottoHostBrowser");
  const client = useSessionStore((state) => state.sessions[hostId]?.client ?? null);
  return useMemo(
    () => (supported && client ? createHostBrowserClient(client, hostId, workspaceId) : null),
    [client, supported, hostId, workspaceId],
  );
}
