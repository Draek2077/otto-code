import { Text, View } from "react-native";
import type { WorkspaceFileTabTarget } from "@/workspace/file-open";
import { FileText } from "@/components/icons/material-icons";
import invariant from "tiny-invariant";
import { useTranslation } from "react-i18next";
import { FileTabPane } from "@/components/file-tab-pane";
import { buildEditorBufferKey, useEditorBufferStore } from "@/editor/editor-buffer-store";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel } from "@/panels/panel-registry";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import { PanelDescriptorContext } from "@/panels/panel-registry";

const CENTERED_PADDED_STYLE = {
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
} as const;

function useFilePanelDescriptor(target: WorkspaceFileTabTarget, context: PanelDescriptorContext) {
  const fileName = target.path.split("/").findLast(Boolean) ?? target.path;
  // External tabs key their buffer by the workspace serving the file, not the
  // host pane's, so the dirty indicator must read the same key.
  const bufferWorkspaceId = target.origin?.workspaceId ?? context.workspaceId;
  const dirty = useEditorBufferStore(
    (state) =>
      state.buffers[
        buildEditorBufferKey({
          serverId: context.serverId,
          workspaceId: bufferWorkspaceId,
          path: target.path,
        })
      ]?.dirty ?? false,
  );
  return {
    label: dirty ? `● ${fileName}` : fileName,
    subtitle: target.path,
    tooltip: target.path,
    titleState: "ready" as const,
    icon: FileText,
    statusBucket: null,
  };
}

function FilePanel() {
  const { t } = useTranslation();
  const { serverId, workspaceId, target, fileNavigationRevision } = usePaneContext();
  const paneWorkspaceDirectory = useWorkspaceDirectory(serverId, workspaceId);
  invariant(target.kind === "file", "FilePanel requires file target");
  // An external file is served from its owning workspace, or from its own
  // directory when it is outside every registered workspace.
  const origin = target.origin;
  const effectiveWorkspaceId = origin?.workspaceId ?? workspaceId;
  const effectiveRoot = origin?.cwd ?? paneWorkspaceDirectory;
  if (!effectiveRoot) {
    return (
      <View style={CENTERED_PADDED_STYLE}>
        <Text>{t("panels.file.directoryMissing")}</Text>
      </View>
    );
  }
  return (
    <FileTabPane
      serverId={serverId}
      workspaceId={effectiveWorkspaceId}
      workspaceRoot={effectiveRoot}
      location={target}
      navigationRevision={fileNavigationRevision}
      workspaceActionsEnabled={origin?.outsideAnyProject !== true}
    />
  );
}

export const filePanelRegistration = definePanel("file", {
  component: FilePanel,
  useDescriptor: useFilePanelDescriptor,
});
