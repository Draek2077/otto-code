import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { createWorkspaceBrowser, useBrowserStore } from "@/desktop/browser/store";
import { removeResidentBrowserWebview } from "@/desktop/browser/resident-webviews";
import {
  ignoreHostedBrowserTab,
  allowHostedBrowserTab,
} from "@/screens/workspace/use-hosted-browser-tabs";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

/** Replace the browser backing without moving its pane or claiming a live-page transfer. */
export async function convertBrowserRenderMode(input: {
  browserId: string;
  serverId: string;
  workspaceId: string;
  client: DaemonClient | null;
}): Promise<void> {
  const browsers = useBrowserStore.getState();
  const current = browsers.browsersById[input.browserId];
  if (!current || current.isPreview) return;
  const workspaceKey = buildWorkspaceTabPersistenceKey(input);
  if (!workspaceKey) throw new Error("Workspace is no longer available.");
  const layoutStore = useWorkspaceLayoutStore.getState();
  const layout = layoutStore.layoutByWorkspace[workspaceKey];
  const tab =
    layout &&
    collectAllTabs(layout.root).find(
      (item) => item.target.kind === "browser" && item.target.browserId === input.browserId,
    );
  if (!tab) throw new Error("Browser tab is no longer open.");

  const nextMode = current.renderMode === "hosted" ? "native" : "hosted";
  if (current.renderMode === "hosted") {
    if (!input.client) throw new Error("Host disconnected.");
    ignoreHostedBrowserTab(input.browserId);
    try {
      // Closing also withdraws the hosted page from phones and other clients.
      await input.client.remoteBrowserExecute(input.workspaceId, {
        kind: "close",
        browserId: input.browserId,
      });
    } catch (error) {
      allowHostedBrowserTab(input.browserId);
      throw error;
    }
  }

  const { browserId: replacementId } = createWorkspaceBrowser({
    initialUrl: current.url,
    renderMode: nextMode,
  });
  useBrowserStore.getState().updateBrowser(replacementId, {
    title: current.title,
    faviconUrl: current.faviconUrl,
    viewport: current.viewport,
  });
  const replaced = layoutStore.retargetTab(workspaceKey, tab.tabId, {
    kind: "browser",
    browserId: replacementId,
  });
  if (!replaced) {
    useBrowserStore.getState().removeBrowser(replacementId);
    throw new Error("Browser tab is no longer open.");
  }
  useBrowserStore.getState().removeBrowser(input.browserId);
  if (current.renderMode === "native") removeResidentBrowserWebview(input.browserId);
}
