import { useSessionStore } from "@/stores/session-store";
import { useBrowserStore } from "@/desktop/browser/store";
import { removeResidentBrowserWebview } from "@/desktop/browser/resident-webviews";
import { getDesktopHost } from "@/desktop/host";
import { hostBrowserBindings, retiredHostBrowsers } from "./ownership";
import { createHostBrowserClient } from "./client";

export async function closeBrowserResources(browserId: string) {
  const binding = await hostBrowserBindings.read(browserId);
  if (binding) {
    const client = useSessionStore.getState().sessions[binding.hostId]?.client;
    if (!client) throw new Error("Connect the host to close its browser tab.");
    retiredHostBrowsers.add(browserId);
    try {
      await createHostBrowserClient(client, binding.hostId, binding.workspaceId).command({
        command: "close_tab",
        args: { browserId },
      });
    } catch (error) {
      retiredHostBrowsers.delete(browserId);
      throw error;
    }
  } else {
    removeResidentBrowserWebview(browserId);
    await getDesktopHost()?.browser?.unregisterWorkspaceBrowser?.(browserId);
  }
  useBrowserStore.getState().removeBrowser(browserId);
  // Keep positive ownership after close: a stale persisted pane must never open
  // this old host identity as an Electron guest on the client's machine.
}
