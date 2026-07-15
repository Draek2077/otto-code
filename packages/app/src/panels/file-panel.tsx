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
import { useWorkspaceDirectory, useWorkspaceProjectId } from "@/stores/session-store-hooks";
import { useProjectLinkSet } from "@/projects/project-links";
import { resolveEditGate } from "@/projects/cross-project-open";
import { confirmDialog } from "@/utils/confirm-dialog";

const CENTERED_PADDED_STYLE = {
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
} as const;

function useFilePanelDescriptor(
  target: { kind: "file"; path: string; origin?: { workspaceId: string } },
  context: PanelDescriptorContext,
) {
  const fileName = target.path.split("/").findLast(Boolean) ?? target.path;
  // Out-of-project tabs key their buffer by the OWNING workspace, not the host
  // pane's, so the dirty indicator must read the same key (gated-multi-root).
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
  const paneWorkspaceDirectory = useWorkspaceDirectory(serverId, workspaceId);
  const paneProjectId = useWorkspaceProjectId(serverId, workspaceId);
  const { linkSet } = useProjectLinkSet(serverId);
  invariant(target.kind === "file", "FilePanel requires file target");
  // An out-of-project file (gated-multi-root) is served from its OWNING
  // workspace: cwd, workspaceId, and editor buffer all resolve against origin,
  // so the same daemon file RPCs work unchanged for a linked project's files.
  const origin = target.origin;
  const effectiveWorkspaceId = origin?.workspaceId ?? workspaceId;
  const effectiveRoot = origin?.cwd ?? paneWorkspaceDirectory;
  // Computed against the LIVE link set so linking/unlinking projects while the
  // tab is open updates whether editing warns.
  const editGate = resolveEditGate({ origin, currentProjectId: paneProjectId, linkSet });
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
      editGate={editGate}
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
      // Match the origin-aware buffer key used by the pane (gated-multi-root).
      workspaceId: target.origin?.workspaceId ?? context.workspaceId,
      path: target.path,
    });
  },
};
