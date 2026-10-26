import { useMemo } from "react";
import invariant from "tiny-invariant";
import { BrowserPane } from "@/desktop/browser/pane";
import { usePaneContext, usePaneFocus } from "@/panels/pane-context";
import { definePanel, type PanelDescriptor } from "@/panels/panel-registry";
import { createOttoBrowserTabIcon } from "@/otto/browser/tab-icon"; // OTTO(browser-favicon)
import { useBrowserStore } from "@/desktop/browser/store";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";

function getBrowserLabel(input: { title: string; url: string }): string {
  const title = input.title.trim();
  if (title) {
    return title;
  }

  try {
    const parsed = new URL(input.url);
    return parsed.hostname || input.url;
  } catch {
    return input.url;
  }
}

function useBrowserPanelDescriptor(target: {
  kind: "browser";
  browserId: string;
}): PanelDescriptor {
  const browser = useBrowserStore((state) => state.browsersById[target.browserId] ?? null);
  const url = browser?.url ?? "https://example.com";
  const faviconUrl = browser?.faviconUrl ?? null;
  const pageUrl = browser?.url ?? null;
  // OTTO(browser-favicon): preserve Paseo descriptor ownership; icon fetching/decoding lives in Otto files.
  const icon = useMemo(
    () =>
      createOttoBrowserTabIcon(
        pageUrl ? { browserId: target.browserId, faviconUrl, pageUrl } : null,
      ),
    [target.browserId, faviconUrl, pageUrl],
  );
  const label = getBrowserLabel({ title: browser?.title ?? "", url });

  return {
    label,
    subtitle: url,
    tooltip: url || label,
    titleState: "ready",
    icon,
    statusBucket: browser?.isLoading ? "running" : null,
  };
}

function BrowserPanel() {
  const { serverId, workspaceId, target } = usePaneContext();
  const { focusPane, isInteractive } = usePaneFocus();
  const cwd = useWorkspaceDirectory(serverId, workspaceId);
  invariant(target.kind === "browser", "BrowserPanel requires browser target");
  return (
    <BrowserPane
      browserId={target.browserId}
      serverId={serverId}
      workspaceId={workspaceId}
      cwd={cwd}
      isInteractive={isInteractive}
      onFocusPane={focusPane}
    />
  );
}

export const browserPanelRegistration = definePanel("browser", {
  component: BrowserPanel,
  useDescriptor: useBrowserPanelDescriptor,
});
