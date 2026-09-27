import { useMemo } from "react";
import { getIsElectron } from "@/constants/platform";
import { useBrowserStore } from "@/desktop/browser/store";
import { useHostFeature } from "@/runtime/host-features";
import type { WorkspaceDesktopTabRowItem } from "@/screens/workspace/workspace-desktop-tabs-row";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { useSessionStore } from "@/stores/session-store";

/**
 * Facts about a pane's tabs that gate the tools strip - shared by the row and
 * the vertical rail so both feed WorkspaceTabRowExtras identical inputs.
 * Preview works by prompting a parent agent, so only attended agents count:
 * observed subagent tabs are read-only and can't be prompted (an agent
 * missing from the store is treated as attended, mirroring session-store's
 * absent-attend default).
 */
export function usePaneTabAgentFacts({
  tabs,
  focusedTab,
  normalizedServerId,
}: {
  tabs: WorkspaceDesktopTabRowItem[];
  focusedTab: WorkspaceTabDescriptor | null;
  normalizedServerId: string;
}) {
  const focusedTabAgentId = focusedTab?.target.kind === "agent" ? focusedTab.target.agentId : null;
  const focusedAgentId = useSessionStore((state) =>
    focusedTabAgentId &&
    state.sessions[normalizedServerId]?.agents.get(focusedTabAgentId)?.attend !== "observed"
      ? focusedTabAgentId
      : null,
  );
  const paneHasEditableAgentTab = useSessionStore((state) => {
    const agents = state.sessions[normalizedServerId]?.agents;
    return tabs.some(
      (item) =>
        item.tab.target.kind === "agent" &&
        agents?.get(item.tab.target.agentId)?.attend !== "observed",
    );
  });
  const browsersById = useBrowserStore((state) => state.browsersById);
  const focusedPreviewCwd =
    focusedTab?.target.kind === "browser" &&
    browsersById[focusedTab.target.browserId]?.isPreview === true
      ? (browsersById[focusedTab.target.browserId]?.previewCwd ?? null)
      : null;
  const paneHasPreviewTab = useMemo(
    () =>
      tabs.some(
        (item) =>
          item.tab.target.kind === "browser" &&
          browsersById[item.tab.target.browserId]?.isPreview === true,
      ),
    [browsersById, tabs],
  );
  // A hosted tab carries the preview where there is no native webview.
  const supportsRemoteBrowser = useHostFeature(normalizedServerId, "remoteBrowser");
  const showPreviewButton =
    (getIsElectron() || supportsRemoteBrowser) && (paneHasEditableAgentTab || paneHasPreviewTab);
  return { focusedAgentId, focusedPreviewCwd, showPreviewButton };
}
