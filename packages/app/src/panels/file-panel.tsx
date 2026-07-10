import { Text, View } from "react-native";
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

const CENTERED_PADDED_STYLE = {
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
} as const;

function useFilePanelDescriptor(
  target: { kind: "file"; path: string },
  context: PanelDescriptorContext,
) {
  const fileName = target.path.split("/").findLast(Boolean) ?? target.path;
  const dirty = useEditorBufferStore(
    (state) =>
      state.buffers[
        buildEditorBufferKey({
          serverId: context.serverId,
          workspaceId: context.workspaceId,
          path: target.path,
        })
      ]?.dirty ?? false,
  );
  return {
    label: dirty ? `● ${fileName}` : fileName,
    subtitle: target.path,
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
  const workspaceDirectory = useWorkspaceDirectory(serverId, workspaceId);
  invariant(target.kind === "file", "FilePanel requires file target");
  if (!workspaceDirectory) {
    return (
      <View style={CENTERED_PADDED_STYLE}>
        <Text>{t("panels.file.directoryMissing")}</Text>
      </View>
    );
  }
  return (
    <FileTabPane
      serverId={serverId}
      workspaceId={workspaceId}
      workspaceRoot={workspaceDirectory}
      location={target}
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
      workspaceId: context.workspaceId,
      path: target.path,
    });
  },
};
