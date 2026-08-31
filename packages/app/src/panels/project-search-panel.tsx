import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";
import { DocumentSearch } from "@/components/icons/material-icons";
import { ProjectSearchPane } from "@/components/project-search-pane";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";
import { setFileViewModeFor } from "@/stores/file-view-store";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

const ThemedDocumentSearch = withUnistyles(DocumentSearch);
const projectSearchPanelPresentation = {
  label: (t) => t("panels.search.label"),
  subtitle: (t) => t("panels.search.subtitle"),
  tooltip: (t) => t("panels.search.tooltip"),
  icon: ThemedDocumentSearch,
} satisfies PanelPresentation;

function ProjectSearchPanel() {
  const { t } = useTranslation();
  const { serverId, workspaceId, target, openPreferredTarget } = usePaneContext();
  const workspaceRoot = useWorkspaceDirectory(serverId, workspaceId);
  invariant(target.kind === "project_search", "ProjectSearchPanel requires project_search target");
  const onOpenFile = useCallback(
    (filePath: string, options?: { edit?: boolean; lineStart?: number }) => {
      if (options?.edit) {
        // One tab per file: "Edit" opens the same file tab in editor view.
        const persistenceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
        if (persistenceKey) {
          setFileViewModeFor({ persistenceKey, path: filePath, mode: "editor" });
        }
      }
      openPreferredTarget(
        {
          kind: "file",
          path: filePath,
          ...(options?.lineStart ? { lineStart: options.lineStart } : {}),
        },
        "explorerFiles",
      );
    },
    [openPreferredTarget, serverId, workspaceId],
  );
  if (!workspaceRoot) {
    return (
      <View style={styles.centerState}>
        <Text>{t("panels.file.directoryMissing")}</Text>
      </View>
    );
  }
  return (
    <ProjectSearchPane
      serverId={serverId}
      workspaceId={workspaceId}
      workspaceRoot={workspaceRoot}
      onOpenFile={onOpenFile}
    />
  );
}

export const projectSearchPanelRegistration = definePanel("project_search", {
  component: ProjectSearchPanel,
  presentation: projectSearchPanelPresentation,
});

const styles = StyleSheet.create((theme) => ({
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
}));
