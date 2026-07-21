import { useCallback, useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getIsElectron, isWeb } from "@/constants/platform";
import { WorkspaceActions } from "@/git/workspace-actions";
import { useContainerWidth } from "@/hooks/use-container-width";
import { useSidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useAppSettings } from "@/hooks/use-settings";
import { useIsDeveloperMode } from "@/hooks/use-interface-mode";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import {
  buildTerminalsQueryKey,
  TERMINALS_QUERY_STALE_TIME,
} from "@/screens/workspace/terminals/state";
import { WorkspaceOpenInEditorButton } from "@/screens/workspace/workspace-open-in-editor-button";
import { WorkspaceScriptsButton } from "@/screens/workspace/workspace-scripts-button";
import { createWorkspaceBrowser } from "@/stores/browser-store";
import { markScriptTerminalPending } from "@/stores/script-terminal-pending-store";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import {
  buildWorkspaceTabPersistenceKey,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { resolveWorkspaceDirectory } from "@/utils/workspace-directory";

const EMPTY_TERMINAL_IDS: string[] = [];

// Width budget for a single labeled split button, plus the row's fixed chrome
// (container padding + inter-button gaps). The threshold is derived from how
// many buttons will actually render rather than assuming all three: a
// workspace with no scripts (or a native build, where open-in-editor never
// renders) otherwise stayed icon-only until the sidebar was far wider than the
// remaining buttons needed. Three buttons still resolve to the previous 380.
const LABELED_TOOL_WIDTH = 120;
const TOOLS_ROW_CHROME_WIDTH = 20;

/**
 * Shows the scripts / open-in-editor / Git actions controls for whichever
 * workspace is currently active, when the user has opted (Settings ->
 * Appearance -> Layout) to move them out of the workspace header and into
 * the sidebar instead. Renders between the workspace list and the sidebar
 * footer/callout area, not inside any individual workspace row.
 */
export function SidebarActiveWorkspaceTools() {
  const { t } = useTranslation();
  const { settings } = useAppSettings();
  // These are all developer tools (scripts, open-in-editor, git commit/pull/push);
  // User mode hides the cluster entirely.
  const isDeveloperMode = useIsDeveloperMode();
  const { onLayout: onContainerLayout, width: containerWidth } = useContainerWidth();
  const activeWorkspaceSelection = useActiveWorkspaceSelection();
  const serverId = activeWorkspaceSelection?.serverId ?? "";
  const workspaceId = activeWorkspaceSelection?.workspaceId ?? "";
  const workspaceEntry = useSidebarWorkspaceEntry(serverId || null, workspaceId || null);
  const workspaceDirectory = resolveWorkspaceDirectory({
    workspaceDirectory: workspaceEntry?.workspaceDirectory ?? null,
  });

  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const queryClient = useQueryClient();
  const openWorkspaceTabFocused = useWorkspaceLayoutStore((state) => state.openTabFocused);
  const persistenceKey = useMemo(
    () => buildWorkspaceTabPersistenceKey({ serverId, workspaceId }),
    [serverId, workspaceId],
  );

  // Mirrors the workspace screen's terminals query (same key, same staleTime)
  // so the scripts menu knows which script terminals are live. When the active
  // workspace's screen is mounted this shares its cache entry rather than
  // fetching separately.
  const terminalsQueryKey = useMemo(
    () => buildTerminalsQueryKey(serverId, workspaceDirectory, workspaceId || null),
    [serverId, workspaceDirectory, workspaceId],
  );
  const terminalsQuery = useQuery({
    queryKey: terminalsQueryKey,
    enabled: Boolean(client && isConnected && workspaceDirectory),
    queryFn: async () => {
      if (!client || !workspaceDirectory) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      return await client.listTerminals(workspaceDirectory, undefined, {
        workspaceId: workspaceId || undefined,
      });
    },
    staleTime: TERMINALS_QUERY_STALE_TIME,
  });
  const liveTerminalIds = useMemo(
    () => terminalsQuery.data?.terminals.map((terminal) => terminal.id) ?? EMPTY_TERMINAL_IDS,
    [terminalsQuery.data],
  );

  const handleViewScriptTerminal = useCallback(
    (terminalId: string) => {
      if (!persistenceKey) {
        return;
      }
      openWorkspaceTabFocused(persistenceKey, { kind: "terminal", terminalId });
    },
    [openWorkspaceTabFocused, persistenceKey],
  );

  const handleScriptTerminalStarted = useCallback(
    (terminalId: string) => {
      if (!persistenceKey) {
        return;
      }
      // Claim the terminal before opening its tab. The workspace screen prunes
      // terminal tabs it doesn't know about, and the daemon's terminals list
      // lags the start response — awaiting a refetch here was still a race,
      // because the screen owns its own query instance and may not even be
      // mounted yet. The shared pending set is what keeps the tab alive until
      // the list catches up.
      markScriptTerminalPending({
        serverId,
        workspaceId,
        terminalId,
        listedAt: terminalsQuery.dataUpdatedAt,
      });
      openWorkspaceTabFocused(persistenceKey, { kind: "terminal", terminalId });
      void queryClient.invalidateQueries({ queryKey: terminalsQueryKey });
    },
    [
      openWorkspaceTabFocused,
      persistenceKey,
      queryClient,
      serverId,
      terminalsQuery.dataUpdatedAt,
      terminalsQueryKey,
      workspaceId,
    ],
  );

  // WorkspaceScriptsButton renders nothing without scripts, and
  // WorkspaceOpenInEditorButton is web-only, so budget width for the buttons
  // that will actually appear. WorkspaceActions always renders. Width 0 means
  // "not measured yet" and stays compact, so a narrow sidebar never flashes
  // ellipsized labels on the first frame.
  const labeledToolCount =
    1 + ((workspaceEntry?.scripts.length ?? 0) > 0 ? 1 : 0) + (isWeb ? 1 : 0);
  const isCompact = containerWidth < labeledToolCount * LABELED_TOOL_WIDTH + TOOLS_ROW_CHROME_WIDTH;

  const handleOpenUrlInBrowserTab = useCallback(
    (url: string) => {
      if (!persistenceKey || !getIsElectron()) {
        return;
      }
      const { browserId } = createWorkspaceBrowser({ initialUrl: url });
      openWorkspaceTabFocused(persistenceKey, { kind: "browser", browserId });
    },
    [openWorkspaceTabFocused, persistenceKey],
  );

  if (
    !isDeveloperMode ||
    settings.workspaceToolsPlacement !== "workspaceList" ||
    !workspaceEntry ||
    !workspaceDirectory
  ) {
    return null;
  }

  return (
    <View style={styles.container} onLayout={onContainerLayout}>
      <View style={styles.toolsRow}>
        <WorkspaceScriptsButton
          serverId={workspaceEntry.serverId}
          workspaceId={workspaceEntry.workspaceId}
          scripts={workspaceEntry.scripts}
          liveTerminalIds={liveTerminalIds}
          onScriptTerminalStarted={handleScriptTerminalStarted}
          onViewTerminal={handleViewScriptTerminal}
          onOpenUrlInBrowserTab={handleOpenUrlInBrowserTab}
          hideLabels={isCompact}
          fill={!isCompact}
        />
        <WorkspaceOpenInEditorButton
          serverId={workspaceEntry.serverId}
          cwd={workspaceDirectory}
          hideLabels={isCompact}
          fill={!isCompact}
        />
        <WorkspaceActions
          serverId={workspaceEntry.serverId}
          cwd={workspaceDirectory}
          hideLabels={isCompact}
          fill={!isCompact}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  toolsRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
  },
}));
