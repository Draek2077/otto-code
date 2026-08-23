import { Fragment, useMemo, type ReactElement, type ReactNode } from "react";
import { withUnistyles } from "react-native-unistyles";
import {
  Copy,
  CopyPlus,
  Download,
  FilePlus,
  FileText,
  FolderOpen,
  FolderPlus,
  ListChevronsDownUp,
  MessageSquarePlus,
  Pencil,
  SquarePen,
  Trash2,
} from "@/components/icons/material-icons";
import { useTranslation } from "react-i18next";
import type { Theme } from "@/styles/theme";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import type { IconComponent } from "@/components/icons/icon-size";

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const destructiveColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });
interface FileAction {
  key: string;
  label: string;
  icon: IconComponent;
  onSelect: () => void;
  destructive?: boolean;
  section?: "open" | "create" | "edit" | "path" | "sharing" | "destructive";
  separatorBefore?: boolean;
  testID?: string;
}

interface FileActionsContextMenuContentProps {
  fileKind: "file" | "directory";
  fileExists?: boolean;
  onOpenFile?: () => void;
  /** Opens the file's tab in editor view - the same action the Changes menu offers. */
  onEditFile?: () => void;
  onCopyPath?: () => void;
  onCopyRelativePath?: () => void;
  onReveal?: () => void;
  revealTargetName?: string;
  onDownload?: () => void;
  onAddToChat?: () => void;
  onNewFile?: () => void;
  onNewFolder?: () => void;
  onCollapseFolder?: () => void;
  onRename?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  /** Optional metadata block rendered above the actions (e.g. size/modified). */
  header?: ReactNode;
  testIDPrefix?: string;
}

/**
 * Shared context-menu content for per-file actions. The file explorer tree and git diff pane
 * own their row triggers while sharing action availability, ordering, and chrome here.
 */
export function FileActionsContextMenuContent({
  fileKind,
  fileExists = true,
  onOpenFile,
  onEditFile,
  onCopyPath,
  onCopyRelativePath,
  onReveal,
  revealTargetName,
  onDownload,
  onAddToChat,
  onNewFile,
  onNewFolder,
  onCollapseFolder,
  onRename,
  onDuplicate,
  onDelete,
  header,
  testIDPrefix,
}: FileActionsContextMenuContentProps): ReactElement | null {
  const { t } = useTranslation();
  const actions = useMemo<FileAction[]>(() => {
    const availableFile = fileKind === "file" && fileExists;
    const specs: Array<FileAction | null> = [
      availableFile && onOpenFile
        ? {
            key: "open-file",
            label: t("workspace.fileActions.openFile"),
            icon: FileText,
            onSelect: onOpenFile,
            section: "open",
          }
        : null,
      onNewFile
        ? {
            key: "new-file",
            label: t("workspace.fileActions.newFile"),
            icon: FilePlus,
            onSelect: onNewFile,
            section: "create",
          }
        : null,
      onNewFolder
        ? {
            key: "new-folder",
            label: t("workspace.fileActions.newFolder"),
            icon: FolderPlus,
            onSelect: onNewFolder,
            section: "create",
          }
        : null,
      onCollapseFolder
        ? {
            key: "collapse-folder",
            label: t("workspace.fileActions.collapseFolder"),
            icon: ListChevronsDownUp,
            onSelect: onCollapseFolder,
            section: "create",
          }
        : null,
      availableFile && onEditFile
        ? {
            key: "edit-file",
            label: t("workspace.fileActions.editFile"),
            icon: SquarePen,
            onSelect: onEditFile,
            section: "edit",
          }
        : null,
      onRename
        ? {
            key: "rename",
            label: t("workspace.fileActions.rename"),
            icon: Pencil,
            onSelect: onRename,
            section: "edit",
          }
        : null,
      onDuplicate
        ? {
            key: "duplicate",
            label: t("workspace.fileActions.duplicate"),
            icon: CopyPlus,
            onSelect: onDuplicate,
            section: "edit",
          }
        : null,
      onCopyPath
        ? {
            key: "copy-path",
            label: t("workspace.fileActions.copyPath"),
            icon: Copy,
            onSelect: onCopyPath,
            section: "path",
          }
        : null,
      onCopyRelativePath
        ? {
            key: "copy-relative-path",
            label: t("workspace.fileActions.copyRelativePath"),
            icon: Copy,
            onSelect: onCopyRelativePath,
            section: "path",
          }
        : null,
      onReveal && revealTargetName
        ? {
            key: "reveal",
            label: t("workspace.fileActions.revealIn", { target: revealTargetName }),
            icon: FolderOpen,
            onSelect: onReveal,
            section: "path",
          }
        : null,
      availableFile && onDownload
        ? {
            key: "download",
            label: t("workspace.fileActions.download"),
            icon: Download,
            onSelect: onDownload,
            section: "sharing",
          }
        : null,
      availableFile && onAddToChat
        ? {
            key: "add-to-chat",
            label: t("workspace.fileActions.addToChat"),
            icon: MessageSquarePlus,
            onSelect: onAddToChat,
            section: "sharing",
          }
        : null,
      onDelete
        ? {
            key: "delete",
            label: t("workspace.fileActions.delete"),
            icon: Trash2,
            onSelect: onDelete,
            destructive: true,
            section: "destructive",
          }
        : null,
    ];
    const availableActions = specs.filter((action): action is FileAction => action !== null);
    return availableActions.map((action, index) =>
      Object.assign(action, {
        separatorBefore: Boolean(
          index > 0 && action.section !== availableActions[index - 1].section,
        ),
        testID: testIDPrefix ? `${testIDPrefix}-${action.key}` : undefined,
      }),
    );
  }, [
    fileExists,
    fileKind,
    onAddToChat,
    onCollapseFolder,
    onCopyPath,
    onCopyRelativePath,
    onDelete,
    onDownload,
    onDuplicate,
    onEditFile,
    onNewFile,
    onNewFolder,
    onOpenFile,
    onRename,
    onReveal,
    revealTargetName,
    t,
    testIDPrefix,
  ]);

  if (actions.length === 0) {
    return null;
  }
  return (
    <ContextMenuContent
      align="start"
      width={220}
      testID={testIDPrefix ? `${testIDPrefix}-context-menu` : undefined}
    >
      {header ? (
        <>
          {header}
          <ContextMenuSeparator />
        </>
      ) : null}
      {actions.map((action) => (
        <Fragment key={action.key}>
          {action.separatorBefore ? <ContextMenuSeparator /> : null}
          <FileActionMenuItem action={action} />
        </Fragment>
      ))}
    </ContextMenuContent>
  );
}

function FileActionMenuItem({ action }: { action: FileAction }): ReactElement {
  const leading = useMemo(() => {
    const ThemedIcon = withUnistyles(action.icon);
    return (
      <ThemedIcon
        size="sm"
        uniProps={action.destructive ? destructiveColorMapping : foregroundMutedColorMapping}
      />
    );
  }, [action.destructive, action.icon]);
  return (
    <ContextMenuItem
      leading={leading}
      onSelect={action.onSelect}
      destructive={action.destructive}
      testID={action.testID}
    >
      {action.label}
    </ContextMenuItem>
  );
}
