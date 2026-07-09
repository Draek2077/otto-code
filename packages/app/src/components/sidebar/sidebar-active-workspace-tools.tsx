import { useCallback, useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getIsElectron } from "@/constants/platform";
import { WorkspaceGitActions } from "@/git/workspace-actions";
import { useContainerWidthBelow } from "@/hooks/use-container-width";
import { useSidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useAppSettings } from "@/hooks/use-settings";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import {
  buildTerminalsQueryKey,
  TERMINALS_QUERY_STALE_TIME,
} from "@/screens/workspace/terminals/state";
import { WorkspaceOpenInEditorButton } from "@/screens/workspace/workspace-open-in-editor-button";
import { WorkspaceScriptsButton } from "@/screens/workspace/workspace-scripts-button";
import { createWorkspaceBrowser } from "@/stores/browser-store";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import {
  buildWorkspaceTabPersistenceKey,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { resolveWorkspaceDirectory } from "@/utils/workspace-directory";

const EMPTY_TERMINAL_IDS: string[] = [];

// Below this container width the three labeled split buttons would start
// ellipsizing, so the row falls back to compact icon-only buttons instead.
const LABELED_TOOLS_MIN_WIDTH = 380;

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
  // Start compact so a narrow sidebar never flashes ellipsized labels on the
  // first frame; the first layout pass promotes to labels when there's room.
  const { onLayout: onContainerLayout, isBelow: isCompact } = useContainerWidthBelow(
    LABELED_TOOLS_MIN_WIDTH,
    { initialIsBelow: true },
  );
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
      // Refetch before opening the tab: the workspace screen prunes terminal
      // tabs it doesn't know about, so the terminal must be in the query data
      // before its tab appears.
      void (async () => {
        await queryClient.invalidateQueries({ queryKey: terminalsQueryKey });
        if (!persistenceKey) {
          return;
        }
        openWorkspaceTabFocused(persistenceKey, { kind: "terminal", terminalId });
      })();
    },
    [openWorkspaceTabFocused, persistenceKey, queryClient, terminalsQueryKey],
  );

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
        <WorkspaceGitActions
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
