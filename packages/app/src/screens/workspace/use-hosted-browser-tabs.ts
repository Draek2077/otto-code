import { useEffect } from "react";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import type { RemoteBrowserTab } from "@otto-code/protocol/browser-remote/rpc-schemas";
import { createFixedBrowserViewport, useBrowserStore } from "@/desktop/browser/store";
import { usePreviewRunningServersStore } from "@/stores/preview-running-servers-store";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { findSplitRightTarget } from "@/workspace-tabs/split-right-target";

interface Input {
  client: DaemonClient | null;
  serverId: string;
  workspaceId: string;
  workspaceKey: string | null;
  /** False where panes cannot split; a preview tab then joins the tab strip. */
  canSplitPanes: boolean;
  enabled: boolean;
}

// A desktop tab switching to its own webview is still present on the host
// until close settles. Ignore any in-flight list response for that old ID.
const convertingToNative = new Set<string>();

export function ignoreHostedBrowserTab(browserId: string): void {
  convertingToNative.add(browserId);
}

export function allowHostedBrowserTab(browserId: string): void {
  convertingToNative.delete(browserId);
}

function removeClosedHostedTab(workspaceKey: string, browserId: string): void {
  // A host list without the old ID confirms the conversion's close settled.
  // Keep the replacement tab and release the marker for future polls.
  if (convertingToNative.delete(browserId)) return;
  if (useBrowserStore.getState().browsersById[browserId]?.renderMode !== "hosted") return;
  const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey];
  if (layout) {
    for (const tab of collectAllTabs(layout.root)) {
      if (tab.target.kind === "browser" && tab.target.browserId === browserId)
        useWorkspaceLayoutStore.getState().closeTab(workspaceKey, tab.tabId);
    }
  }
  useBrowserStore.getState().removeBrowser(browserId);
}

interface Adoption {
  serverId: string;
  workspaceKey: string;
  canSplitPanes: boolean;
}

function adoptHostedTab(
  tab: RemoteBrowserTab,
  { serverId, workspaceKey, canSplitPanes }: Adoption,
): void {
  const browsers = useBrowserStore.getState();
  browsers.ensureBrowser(tab.browserId);
  browsers.updateBrowser(tab.browserId, {
    renderMode: "hosted",
    url: tab.url,
    title: tab.title,
    isLoading: tab.isLoading ?? tab.state === "starting",
    lastError: tab.error,
    viewport:
      tab.viewport.mode === "fixed"
        ? createFixedBrowserViewport(tab.viewport.width, tab.viewport.height)
        : { mode: "responsive" },
    ...(tab.preview
      ? {
          isPreview: true,
          previewServerId: tab.preview.serverId,
          previewServerName: tab.preview.serverName,
          previewCwd: tab.preview.cwd,
          previewStatus: "ready" as const,
        }
      : {}),
  });
  const layoutStore = useWorkspaceLayoutStore.getState();
  const layout = layoutStore.layoutByWorkspace[workspaceKey];
  const alreadyOpen =
    layout &&
    collectAllTabs(layout.root).some(
      (item) => item.target.kind === "browser" && item.target.browserId === tab.browserId,
    );
  if (!alreadyOpen) {
    const splitTarget =
      canSplitPanes && tab.layout === "split-right" ? findSplitRightTarget(workspaceKey) : null;
    const tabId = layoutStore.openTabInBackground(workspaceKey, {
      kind: "browser",
      browserId: tab.browserId,
    });
    if (tabId && splitTarget) {
      layoutStore.splitPane(workspaceKey, {
        tabId,
        targetPaneId: splitTarget,
        position: "right",
      });
      // Reveal the preview without moving keyboard ownership to it.
      layoutStore.focusPane(workspaceKey, splitTarget);
    }
    if (tab.preview)
      usePreviewRunningServersStore
        .getState()
        .markRunning(serverId, tab.preview.cwd, tab.preview.serverId);
  }
}

/** Projects daemon-owned tabs into this client's ordinary workspace tab strip. */
export function useHostedBrowserTabs({
  client,
  serverId,
  workspaceId,
  workspaceKey,
  canSplitPanes,
  enabled,
}: Input): void {
  useEffect(() => {
    if (!client || !workspaceId || !workspaceKey || !enabled) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let knownIds: Set<string> | null = null;
    const seenFocusRequests = new Map<string, string>();
    let failures = 0;

    const poll = async () => {
      try {
        const response = await client.remoteBrowserExecute(workspaceId, { kind: "list" });
        if (!live) return;
        const nextIds = new Set<string>();
        for (const tab of response.tabs ?? []) {
          nextIds.add(tab.browserId);
          if (convertingToNative.has(tab.browserId)) continue;
          adoptHostedTab(tab, { serverId, workspaceKey, canSplitPanes });
          const layoutStore = useWorkspaceLayoutStore.getState();

          if (tab.focusRequestId && tab.focusRequestId !== seenFocusRequests.get(tab.browserId)) {
            const currentLayout =
              useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey];
            const localTab =
              currentLayout &&
              collectAllTabs(currentLayout.root).find(
                (item) => item.target.kind === "browser" && item.target.browserId === tab.browserId,
              );
            if (localTab) layoutStore.focusTab(workspaceKey, localTab.tabId);
          }
          if (tab.focusRequestId) seenFocusRequests.set(tab.browserId, tab.focusRequestId);
        }

        // A disappearance while this socket stayed live means the host closed
        // the tab. A fresh connection starts without an absence baseline so
        // local tabs can reattach after a daemon restart.
        if (knownIds) {
          for (const browserId of knownIds) {
            if (nextIds.has(browserId)) continue;
            removeClosedHostedTab(workspaceKey, browserId);
            seenFocusRequests.delete(browserId);
          }
        }
        knownIds = nextIds;
        failures = 0;
      } catch {
        failures++;
      } finally {
        if (live)
          timer = setTimeout(poll, failures ? Math.min(15_000, 1_000 * 2 ** failures) : 3_000);
      }
    };
    void poll();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [client, serverId, workspaceId, workspaceKey, canSplitPanes, enabled]);
}
