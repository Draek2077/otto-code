// Browser-tab wiring for the workspace screen: the user-driven launch paths,
// the hosted-tab projection, and the hosted entries of the header menu.
// Extracted from workspace-screen.tsx, which keeps one call site per control.
import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { PlayFilled } from "@/components/icons/material-icons";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useIsCompactFormFactor } from "@/constants/layout";
import { getIsElectron } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";
import {
  createWorkspaceBrowser,
  useBrowserStore,
  useBrowserStoreHydrated,
} from "@/desktop/browser/store";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useIsDeveloperMode } from "@/hooks/use-interface-mode";
import { useAppSettingValue } from "@/hooks/use-settings";
import { useHostFeature } from "@/runtime/host-features";
import { useHostedBrowserTabs } from "@/screens/workspace/use-hosted-browser-tabs";
import {
  useWorkspacePreviewController,
  WorkspacePreviewCollapsedAnchor,
} from "@/screens/workspace/workspace-preview-controller";
import { collectAllTabs, findPaneById } from "@/stores/workspace-layout-actions";
import { useSessionStore } from "@/stores/session-store";
import {
  useWorkspaceLayoutStore,
  type WorkspaceTabPlacement,
} from "@/stores/workspace-layout-store";
import type { WorkspaceTabTarget } from "@/stores/workspace-tabs-store";
import {
  confirmBrowserToolsOffBeforeOpening,
  useBrowserToolsWarningCopy,
  useOpenBrowserToolsSettings,
} from "@/utils/browser-tools-warning";
import type { WorkspaceTabLaunchDestination } from "@/workspace-tabs/launcher";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import type { Theme } from "@/styles/theme";
import { withUnistyles } from "react-native-unistyles";

const ThemedPlayFilled = withUnistyles(PlayFilled);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const MENU_PREVIEW_ICON = <ThemedPlayFilled size={14} uniProps={mutedColorMapping} />;

type BrowserRenderMode = "native" | "hosted";

export function closeHostedBrowserTab(
  client: DaemonClient | null,
  workspaceId: string,
  browserId: string,
  browserRecord: { renderMode: BrowserRenderMode } | undefined,
): void {
  if (getIsElectron() && browserRecord?.renderMode !== "hosted") return;
  // Closing the workspace tab releases its host page. If the socket is gone,
  // the daemon's idle reaper remains the cleanup path for that page.
  void client
    ?.remoteBrowserExecute(workspaceId, { kind: "close", browserId })
    .catch(() => undefined);
}

interface HeaderBrowserMenuInput {
  serverId: string;
  workspaceId: string;
  icon: ReactElement;
  onCreateHosted: () => void;
}

/** The focused tab as a primitive, so the selector stays stable across renders. */
function useFocusedTabKey(workspaceKey: string | null): string | null {
  return useWorkspaceLayoutStore((state) => {
    const layout = workspaceKey ? state.layoutByWorkspace[workspaceKey] : undefined;
    if (!layout) return null;
    const tabId = findPaneById(layout.root, layout.focusedPaneId)?.focusedTabId;
    const target = collectAllTabs(layout.root).find((tab) => tab.tabId === tabId)?.target;
    if (target?.kind === "agent") return `agent:${target.agentId}`;
    if (target?.kind === "browser") return `browser:${target.browserId}`;
    return null;
  });
}

/**
 * The hosted entries of the header menu. The phone layout has no tab row, so
 * this menu is where Preview lives there; its server picker opens from
 * `anchor` after the menu dismisses.
 */
export function useHeaderBrowserMenu({
  serverId,
  workspaceId,
  icon,
  onCreateHosted,
}: HeaderBrowserMenuInput): { items: ReactElement; anchor: ReactElement | null } {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const isDeveloperMode = useIsDeveloperMode();
  const supportsRemoteBrowser = useHostFeature(serverId, "remoteBrowser");
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const focused = useFocusedTabKey(workspaceKey);
  const focusedAgentId = useSessionStore((state) => {
    const agentId = focused?.startsWith("agent:") ? focused.slice("agent:".length) : null;
    // Preview prompts the chat, so a read-only observed subagent does not count.
    return agentId && state.sessions[serverId]?.agents.get(agentId)?.attend !== "observed"
      ? agentId
      : null;
  });
  const focusedPreviewCwd = useBrowserStore((state) => {
    const record = focused?.startsWith("browser:")
      ? state.browsersById[focused.slice("browser:".length)]
      : undefined;
    return record?.isPreview ? record.previewCwd : null;
  });
  const offerPreview = isCompact && isDeveloperMode && (getIsElectron() || supportsRemoteBrowser);
  const preview = useWorkspacePreviewController({
    normalizedServerId: serverId,
    normalizedWorkspaceId: workspaceId,
    focusedAgentId,
    focusedPreviewCwd,
    enabled: offerPreview,
  });
  const openPreview = useCallback(() => void preview.runPreviewFlow(), [preview]);

  return {
    items: (
      <>
        {getIsElectron() && supportsRemoteBrowser ? (
          <DropdownMenuItem
            testID="workspace-header-new-hosted-browser"
            leading={icon}
            onSelect={onCreateHosted}
          >
            {t("workspace.header.actions.newHostedBrowser")}
          </DropdownMenuItem>
        ) : null}
        {offerPreview ? (
          <DropdownMenuItem
            testID="workspace-header-preview"
            leading={MENU_PREVIEW_ICON}
            disabled={preview.disabled}
            onSelect={preview.disabled ? undefined : openPreview}
          >
            {t("workspace.tabs.actions.preview")}
          </DropdownMenuItem>
        ) : null}
      </>
    ),
    anchor: offerPreview ? <WorkspacePreviewCollapsedAnchor controller={preview} /> : null,
  };
}

interface WorkspaceBrowserTabsInput {
  serverId: string;
  workspaceId: string;
  persistenceKey: string | null;
  client: DaemonClient | null;
  /** The workspace is focused, connected, and its layout store is hydrated. */
  projectionEnabled: boolean;
  /** Preview tabs open beside the focused pane where panes can split. */
  canSplitPanes: boolean;
  openWorkspaceTabFocused: (
    workspaceKey: string,
    target: WorkspaceTabTarget,
    placement?: WorkspaceTabPlacement,
  ) => unknown;
  replaceWorkspaceTabTarget: (
    workspaceKey: string,
    tabId: string,
    target: WorkspaceTabTarget,
  ) => unknown;
  placementForPane: (paneId: string | null | undefined) => WorkspaceTabPlacement;
}

export interface WorkspaceBrowserTabs {
  supportsRemoteBrowser: boolean;
  launchBrowserTab: (
    destination: WorkspaceTabLaunchDestination,
    requestedMode?: BrowserRenderMode,
  ) => void;
  handleCreateBrowserTab: (input?: { paneId?: string }) => void;
  handleCreateHostedBrowserTab: () => void;
  handleOpenUrlInBrowserTab: (url: string) => void;
}

export function useWorkspaceBrowserTabs({
  serverId,
  workspaceId,
  persistenceKey,
  client,
  projectionEnabled,
  canSplitPanes,
  openWorkspaceTabFocused,
  replaceWorkspaceTabTarget,
  placementForPane,
}: WorkspaceBrowserTabsInput): WorkspaceBrowserTabs {
  const { t } = useTranslation();
  const toast = useToast();
  // Browser-tools-off heads-up wiring for launchBrowserTab below.
  const { config: browserToolsConfig } = useDaemonConfig(serverId);
  const browserToolsCopy = useBrowserToolsWarningCopy();
  const openBrowserToolsSettings = useOpenBrowserToolsSettings(serverId);
  const suppressBrowserToolsWarning = useAppSettingValue(
    (settings) => settings.suppressBrowserToolsWarning,
  );
  const supportsRemoteBrowser = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.remoteBrowser === true,
  );
  const hasHydratedBrowserStore = useBrowserStoreHydrated();
  useHostedBrowserTabs({
    client,
    serverId,
    workspaceId,
    workspaceKey: persistenceKey,
    canSplitPanes,
    enabled: projectionEnabled && supportsRemoteBrowser && hasHydratedBrowserStore,
  });

  // Every user-driven "new browser tab" path funnels through here, so this is
  // the one place the Browser-tools-off heads-up has to live. Informational
  // only - the tab is still useful to the human - so it proceeds on "Not now"
  // and can be silenced for good. Agent-driven tab creation
  // (browser-automation/handler.ts) never reaches this and must not warn.
  const launchBrowserTab = useCallback(
    (destination: WorkspaceTabLaunchDestination, requestedMode?: BrowserRenderMode) => {
      if (!persistenceKey) {
        return;
      }
      const renderMode = requestedMode ?? (getIsElectron() ? "native" : "hosted");
      if (renderMode === "hosted" && !supportsRemoteBrowser) {
        toast.error(t("workspace.browser.updateHost"));
        return;
      }
      void (async () => {
        const proceed = await confirmBrowserToolsOffBeforeOpening({
          config: browserToolsConfig,
          copy: browserToolsCopy,
          suppressed: suppressBrowserToolsWarning,
          onOpenSettings: openBrowserToolsSettings,
        });
        if (!proceed) {
          return;
        }
        const { browserId } = createWorkspaceBrowser({ renderMode });
        if (destination.kind === "replace") {
          replaceWorkspaceTabTarget(persistenceKey, destination.tabId, {
            kind: "browser",
            browserId,
          });
          return;
        }
        openWorkspaceTabFocused(
          persistenceKey,
          { kind: "browser", browserId },
          placementForPane(destination.paneId),
        );
      })();
    },
    [
      browserToolsConfig,
      browserToolsCopy,
      openBrowserToolsSettings,
      openWorkspaceTabFocused,
      persistenceKey,
      placementForPane,
      replaceWorkspaceTabTarget,
      suppressBrowserToolsWarning,
      supportsRemoteBrowser,
      t,
      toast,
    ],
  );

  const handleCreateBrowserTab = useCallback(
    (input?: { paneId?: string }) => {
      launchBrowserTab(input?.paneId ? { kind: "open", paneId: input.paneId } : { kind: "open" });
    },
    [launchBrowserTab],
  );

  const handleCreateHostedBrowserTab = useCallback(() => {
    launchBrowserTab({ kind: "open" }, "hosted");
  }, [launchBrowserTab]);

  const handleOpenUrlInBrowserTab = useCallback(
    (url: string) => {
      if (!persistenceKey || (!getIsElectron() && !supportsRemoteBrowser)) {
        return;
      }
      const { browserId } = createWorkspaceBrowser({
        initialUrl: url,
        renderMode: getIsElectron() ? "native" : "hosted",
      });
      openWorkspaceTabFocused(persistenceKey, { kind: "browser", browserId });
    },
    [openWorkspaceTabFocused, persistenceKey, supportsRemoteBrowser],
  );

  return useMemo(
    () => ({
      supportsRemoteBrowser,
      launchBrowserTab,
      handleCreateBrowserTab,
      handleCreateHostedBrowserTab,
      handleOpenUrlInBrowserTab,
    }),
    [
      supportsRemoteBrowser,
      launchBrowserTab,
      handleCreateBrowserTab,
      handleCreateHostedBrowserTab,
      handleOpenUrlInBrowserTab,
    ],
  );
}
