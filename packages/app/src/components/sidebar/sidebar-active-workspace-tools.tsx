import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { DiffStat } from "@/components/diff-stat";
import { WorkspaceGitActions } from "@/git/workspace-actions";
import { useSidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useAppSettings } from "@/hooks/use-settings";
import { WorkspaceOpenInEditorButton } from "@/screens/workspace/workspace-open-in-editor-button";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { resolveWorkspaceDirectory } from "@/utils/workspace-directory";

/**
 * Shows the open-in-editor / Git actions / diff-count controls for whichever
 * workspace is currently active, when the user has opted (Settings ->
 * Appearance -> Layout) to move them out of the workspace header and into
 * the sidebar instead. Renders between the workspace list and the sidebar
 * footer/callout area, not inside any individual workspace row.
 */
export function SidebarActiveWorkspaceTools() {
  const { settings } = useAppSettings();
  const activeWorkspaceSelection = useActiveWorkspaceSelection();
  const workspaceEntry = useSidebarWorkspaceEntry(
    activeWorkspaceSelection?.serverId ?? null,
    activeWorkspaceSelection?.workspaceId ?? null,
  );
  const workspaceDirectory = resolveWorkspaceDirectory({
    workspaceDirectory: workspaceEntry?.workspaceDirectory ?? null,
  });

  if (
    settings.workspaceToolsPlacement !== "workspaceList" ||
    !workspaceEntry ||
    !workspaceDirectory
  ) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.toolsRow}>
        <WorkspaceOpenInEditorButton
          serverId={workspaceEntry.serverId}
          cwd={workspaceDirectory}
          hideLabels
        />
        <WorkspaceGitActions
          serverId={workspaceEntry.serverId}
          cwd={workspaceDirectory}
          hideLabels
        />
      </View>
      {workspaceEntry.diffStat ? (
        <DiffStat
          additions={workspaceEntry.diffStat.additions}
          deletions={workspaceEntry.diffStat.deletions}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
    gap: theme.spacing[2],
  },
  toolsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 1,
  },
}));
