import { Text, View } from "react-native";
import type { WorkspaceFileTabTarget } from "@/workspace/file-open";
import { FileText } from "@/components/icons/material-icons";
import invariant from "tiny-invariant";
import { useTranslation } from "react-i18next";
import { FileTabPane } from "@/components/file-tab-pane";
import {
  buildEditorBufferKey,
  isEditorBufferDirty,
  removeEditorBuffer,
  useEditorBufferStore,
} from "@/editor/editor-buffer-store";
import { i18n } from "@/i18n/i18next";
import { usePaneContext } from "@/panels/pane-context";
import type { PanelDescriptorContext, PanelRegistration } from "@/panels/panel-registry";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import { confirmDialog } from "@/utils/confirm-dialog";
import { hasActiveExternalFileEditor } from "@/editor/external-file-editor";

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

interface EditorBufferId {
  serverId: string;
  workspaceId: string;
  path: string;
}

/**
 * Closing the tab drops the file's editor buffer; unsaved changes require an
 * explicit discard first. Mode switches inside the tab never discard.
 */
async function confirmDiscardEditorBuffer(bufferId: EditorBufferId): Promise<boolean> {
  if (hasActiveExternalFileEditor(bufferId)) {
    const confirmed = await confirmDialog({
      title: i18n.t("editor.externalEditorDialog.title"),
      message: i18n.t("editor.externalEditorDialog.message"),
      confirmLabel: i18n.t("editor.externalEditorDialog.confirm"),
      cancelLabel: i18n.t("editor.cancel"),
      destructive: true,
    });
    if (!confirmed) {
      return false;
    }
  }
  if (!isEditorBufferDirty(bufferId)) {
    removeEditorBuffer(bufferId);
    return true;
  }
  const confirmed = await confirmDialog({
    title: i18n.t("editor.discardDialog.title"),
    message: i18n.t("editor.discardDialog.message"),
    confirmLabel: i18n.t("editor.discardDialog.confirm"),
    cancelLabel: i18n.t("editor.cancel"),
    destructive: true,
  });
  if (confirmed) {
    removeEditorBuffer(bufferId);
  }
  return confirmed;
}

function FilePanel() {
  const { t } = useTranslation();
  const { serverId, workspaceId, target } = usePaneContext();
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
      workspaceActionsEnabled={origin?.outsideAnyProject !== true}
    />
  );
}

export const filePanelRegistration: PanelRegistration<"file"> = {
  kind: "file",
  component: FilePanel,
  useDescriptor: useFilePanelDescriptor,
  confirmClose(target, context) {
    return confirmDiscardEditorBuffer({
      serverId: context.serverId,
      // Match the origin-aware buffer key used by the pane.
      workspaceId: target.origin?.workspaceId ?? context.workspaceId,
      path: target.path,
    });
  },
};
