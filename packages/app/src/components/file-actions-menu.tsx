import { Fragment, type ReactElement, type ReactNode, useMemo } from "react";
import { withUnistyles } from "react-native-unistyles";
import {
  ArrowRightToLine,
  Copy,
  CopyPlus,
  Download,
  FilePlus,
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
import { Undo2 } from "@/components/icons/material-icons";

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const destructiveColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });
type FileActionGroup = "create" | "open" | "reference" | "manage" | "destructive";

interface FileAction {
  key: string;
  group: FileActionGroup;
  label: string;
  icon: IconComponent;
  onSelect: () => void;
  destructive?: boolean;
  separatorBefore?: boolean;
  testID?: string;
}

function optionalFileAction(
  available: boolean,
  onSelect: (() => void) | undefined,
  action: Omit<FileAction, "onSelect">,
): FileAction | null {
  return available && onSelect ? { ...action, onSelect } : null;
}

interface FileActionsContextMenuContentProps {
  fileKind: "file" | "directory";
  fileExists?: boolean;
  /** Opens the file according to its source's preferred main/side placement. */
  onEditFile?: () => void;
  onOpenToSide?: () => void;
  /** Rendered above the actions, separated: the explorer shows file size and
   *  modified time here. */
  header?: ReactNode;
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
  /** Discard this file's working-tree changes. Destructive, so it sits with
   *  delete rather than with the edit actions. */
  onRevert?: () => void;
  onDelete?: () => void;
  /** Additive owner-specific actions after the shared destructive group. */
  afterActions?: ReactNode;
  testIDPrefix?: string;
}

/**
 * Shared context-menu content for per-file actions. The file explorer tree and git diff pane
 * own their row triggers while sharing action availability, ordering, and chrome here.
 */
export function FileActionsContextMenuContent({
  fileKind,
  fileExists = true,
  onEditFile,
  onOpenToSide,
  header,
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
  onRevert,
  onDelete,
  afterActions,
  testIDPrefix,
}: FileActionsContextMenuContentProps): ReactElement | null {
  const { t } = useTranslation();
  const actions = useMemo<FileAction[]>(() => {
    const availableFile = fileKind === "file" && fileExists;
    const specs: Array<FileAction | null> = [
      availableFile && onEditFile
        ? {
            key: "edit-file",
            label: t("workspace.fileActions.editFile"),
            icon: SquarePen,
            onSelect: onEditFile,
            group: "open",
          }
        : null,
      optionalFileAction(availableFile, onOpenToSide, {
        key: "open-to-side",
        group: "open",
        label: t("workspace.fileActions.openToSide"),
        icon: ArrowRightToLine,
      }),
      onNewFile
        ? {
            key: "new-file",
            group: "create",
            label: t("workspace.fileActions.newFile"),
            icon: FilePlus,
            onSelect: onNewFile,
          }
        : null,
      onNewFolder
        ? {
            key: "new-folder",
            group: "create",
            label: t("workspace.fileActions.newFolder"),
            icon: FolderPlus,
            onSelect: onNewFolder,
          }
        : null,
      onCollapseFolder
        ? {
            key: "collapse-folder",
            group: "open",
            label: t("workspace.fileActions.collapseFolder"),
            icon: ListChevronsDownUp,
            onSelect: onCollapseFolder,
          }
        : null,
      onRename
        ? {
            key: "rename",
            label: t("workspace.fileActions.rename"),
            icon: Pencil,
            onSelect: onRename,
            group: "manage",
          }
        : null,
      onDuplicate
        ? {
            key: "duplicate",
            label: t("workspace.fileActions.duplicate"),
            icon: CopyPlus,
            onSelect: onDuplicate,
            group: "manage",
          }
        : null,
      onCopyPath
        ? {
            key: "copy-path",
            group: "reference",
            label: t("workspace.fileActions.copyPath"),
            icon: Copy,
            onSelect: onCopyPath,
          }
        : null,
      onCopyRelativePath
        ? {
            key: "copy-relative-path",
            group: "reference",
            label: t("workspace.fileActions.copyRelativePath"),
            icon: Copy,
            onSelect: onCopyRelativePath,
          }
        : null,
      optionalFileAction(Boolean(revealTargetName), onReveal, {
        key: "reveal",
        group: "reference",
        label: t("workspace.fileActions.revealIn", { target: revealTargetName }),
        icon: FolderOpen,
      }),
      optionalFileAction(availableFile, onDownload, {
        key: "download",
        group: "reference",
        label: t("workspace.fileActions.download"),
        icon: Download,
      }),
      optionalFileAction(availableFile, onAddToChat, {
        key: "add-to-chat",
        group: "reference",
        label: t("workspace.fileActions.addToChat"),
        icon: MessageSquarePlus,
      }),
      onRevert
        ? {
            key: "revert",
            group: "destructive",
            label: t("workspace.fileActions.revert"),
            icon: Undo2,
            onSelect: onRevert,
            destructive: true,
          }
        : null,
      onDelete
        ? {
            key: "delete",
            group: "destructive",
            label: t("workspace.fileActions.delete"),
            icon: Trash2,
            onSelect: onDelete,
            destructive: true,
          }
        : null,
    ];
    const availableActions = specs.filter((action): action is FileAction => action !== null);
    return availableActions.map((action, index) =>
      Object.assign(action, {
        separatorBefore: Boolean(index > 0 && action.group !== availableActions[index - 1].group),
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
    onRevert,
    onDelete,
    onDownload,
    onDuplicate,
    onEditFile,
    onNewFile,
    onNewFolder,
    onOpenToSide,
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
      {afterActions}
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
