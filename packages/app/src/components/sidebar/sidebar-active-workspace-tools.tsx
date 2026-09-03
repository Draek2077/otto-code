import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getIsElectron } from "@/constants/platform";
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
import { createWorkspaceBrowser } from "@/desktop/browser/store";
import { markScriptTerminalPending } from "@/stores/script-terminal-pending-store";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { resolveWorkspaceDirectory } from "@/utils/workspace-directory";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  getWorkspaceToolsLabelVisibility,
  shouldFillWorkspaceTool,
  type WorkspaceTool,
} from "./sidebar-active-workspace-tools-layout";

const EMPTY_TERMINAL_IDS: string[] = [];
const WORKSPACE_TOOL_ORDER: readonly WorkspaceTool[] = ["scripts", "git", "openInEditor"];

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
  const [availableTools, setAvailableTools] = useState<readonly WorkspaceTool[]>([]);
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
      // lags the start response - awaiting a refetch here was still a race,
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

  const reportToolAvailability = useCallback((tool: WorkspaceTool, available: boolean) => {
    setAvailableTools((current) => {
      const isCurrentlyAvailable = current.includes(tool);
      if (isCurrentlyAvailable === available) return current;
      if (!available) return current.filter((candidate) => candidate !== tool);
      return WORKSPACE_TOOL_ORDER.filter(
        (candidate) => candidate === tool || current.includes(candidate),
      );
    });
  }, []);
  const reportScriptsAvailability = useCallback(
    (available: boolean) => reportToolAvailability("scripts", available),
    [reportToolAvailability],
  );
  const reportOpenInEditorAvailability = useCallback(
    (available: boolean) => reportToolAvailability("openInEditor", available),
    [reportToolAvailability],
  );
  const reportGitAvailability = useCallback(
    (available: boolean) => reportToolAvailability("git", available),
    [reportToolAvailability],
  );

  // Controls report after resolving their own runtime policy. The layout must
  // budget only for controls that actually render; editor targets and Git
  // actions can legitimately be absent for the active workspace.
  const labelVisibility = getWorkspaceToolsLabelVisibility({
    width: containerWidth,
    availableTools,
  });
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
        <WorkspaceToolTooltip
          enabled={!labelVisibility.scripts}
          fill={shouldFillWorkspaceTool(labelVisibility, "scripts")}
          label={t("workspace.scripts.title")}
        >
          <WorkspaceScriptsButton
            serverId={workspaceEntry.serverId}
            workspaceId={workspaceEntry.workspaceId}
            scripts={workspaceEntry.scripts}
            liveTerminalIds={liveTerminalIds}
            onScriptTerminalStarted={handleScriptTerminalStarted}
            onViewTerminal={handleViewScriptTerminal}
            onOpenUrlInBrowserTab={handleOpenUrlInBrowserTab}
            onAvailabilityChange={reportScriptsAvailability}
            hideLabels={!labelVisibility.scripts}
            fill={shouldFillWorkspaceTool(labelVisibility, "scripts")}
          />
        </WorkspaceToolTooltip>
        <WorkspaceOpenInEditorButton
          serverId={workspaceEntry.serverId}
          cwd={workspaceDirectory}
          onAvailabilityChange={reportOpenInEditorAvailability}
          hideLabels={!labelVisibility.openInEditor}
          fill={shouldFillWorkspaceTool(labelVisibility, "openInEditor")}
          tooltipSide="top"
        />
        <WorkspaceActions
          serverId={workspaceEntry.serverId}
          cwd={workspaceDirectory}
          onAvailabilityChange={reportGitAvailability}
          hideLabels={!labelVisibility.git}
          fill={shouldFillWorkspaceTool(labelVisibility, "git")}
          tooltipSide="top"
        />
      </View>
    </View>
  );
}

function WorkspaceToolTooltip({
  children,
  enabled,
  fill,
  label,
}: {
  children: ReactNode;
  enabled: boolean;
  fill: boolean;
  label: string;
}) {
  if (!enabled) return children;
  return (
    <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>
        {/* The trigger View is a flex child of the tools row. It has to carry
            the fill flags itself, or it caps the wrapped button at natural
            width and the siblings absorb the whole remainder between them. */}
        <View collapsable={false} style={fill ? styles.tooltipFill : undefined}>
          {children}
        </View>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    width: "100%",
    alignSelf: "stretch",
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
  tooltipFill: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  tooltipText: { color: theme.colors.popoverForeground, fontSize: theme.fontSize.sm },
}));
