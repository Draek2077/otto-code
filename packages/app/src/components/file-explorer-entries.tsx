// Otto's file-explorer entry layer: the entry context menu with its
// mutation items and handlers, the meta block, the tree body with its
// row building and sorting, the lens switcher, and entry download.
// Extracted from file-explorer-pane.tsx, which keeps one registration
// point per surface. formatFileSize and treeRowKeyExtractor relocated
// here: their only callers moved.
import { useCallback, useMemo, type ReactElement, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  FlatList,
  ListRenderItemInfo,
  Text,
  View,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import {
  ChevronDown,
  Copy,
  Download,
  History,
  Paperclip,
  Pencil,
  SquarePen,
  Trash2,
} from "@/components/icons/material-icons";
import { SourceControlPanelIcon } from "@/components/icons/source-control-panel-icon";
import { compactUp } from "@/styles/theme";
import { TREE_RAILS_ALL_CONTINUE, withTreeRail } from "@/components/tree-rail-mask";
import { ExplorerEntry } from "@/stores/session-store";
import { useDownloadStore } from "@/stores/download-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  buildExplorerCheckoutKey,
  type ExplorerViewMode,
  type SortOption,
} from "@/stores/panel-store";
import type { SolutionRef } from "@otto-code/client/internal/daemon-client";
import { formatFileSize } from "@/utils/format-file-size";
import { formatTimeAgo } from "@/utils/time";
import { type FileNameSheetMode } from "@/file-explorer/file-name-sheet";
import { filterVisibleExplorerEntries } from "@/file-explorer/visibility";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";

export type RequestDirectoryListing = (
  path: string,
  opts?: { recordHistory?: boolean; setCurrentPath?: boolean; surfaceErrors?: boolean },
) => Promise<boolean>;

/** Right-click target for the pane-level context menu (web only). */
export interface EntryContextMenuRequest {
  entry: ExplorerEntry;
  x: number;
  y: number;
}

export function stopPressInPropagation(event: { stopPropagation?: () => void }) {
  event.stopPropagation?.();
}

export function menuButtonStyle({
  hovered,
  pressed,
  open,
}: PressableStateCallbackType & { hovered?: boolean; open?: boolean }) {
  return [
    styles.menuButton,
    (Boolean(hovered) || pressed || Boolean(open)) && styles.menuButtonActive,
  ];
}

function treeRowKeyExtractor(row: TreeRow) {
  return row.entry.path;
}

interface EntryMutationItemsProps {
  entry: ExplorerEntry;
  onRename?: (entry: ExplorerEntry) => void;
  onDelete?: (entry: ExplorerEntry) => void;
}

export function hasEntryBottomActions(
  entry: ExplorerEntry,
  onEditEntry?: (entry: ExplorerEntry) => void,
  onShowHistory?: (entry: ExplorerEntry) => void,
  onRename?: (entry: ExplorerEntry) => void,
  onDelete?: (entry: ExplorerEntry) => void,
) {
  return (entry.kind === "file" && (onEditEntry || onShowHistory)) || onRename || onDelete;
}

/**
 * The two things that change what is on disk, shared in spirit by the row's
 * "..." dropdown and the pane's right-click menu (the two menu primitives have
 * different item components, so each gets a thin wrapper below).
 *
 * They sit below a separator, after everything that only reads, and Delete is
 * last and destructive-styled - the pointer never crosses it on the way to a
 * harmless item. Both are absent, not disabled, when the host cannot serve
 * them: an item that exists but refuses is a worse answer than no item.
 */
function useEntryMutationHandlers({ entry, onRename, onDelete }: EntryMutationItemsProps) {
  const { theme } = useUnistyles();
  const handleRename = useCallback(() => onRename?.(entry), [entry, onRename]);
  const handleDelete = useCallback(() => onDelete?.(entry), [entry, onDelete]);
  const renameLeading = useMemo(
    () => <Pencil size="sm" color={theme.colors.foregroundMuted} />,
    [theme.colors.foregroundMuted],
  );
  const deleteLeading = useMemo(
    () => <Trash2 size="sm" color={theme.colors.destructive} />,
    [theme.colors.destructive],
  );
  return {
    handleRename,
    handleDelete,
    renameLeading,
    deleteLeading,
  };
}

export function EntryMutationMenuItems(props: EntryMutationItemsProps) {
  const { t } = useTranslation();
  const handlers = useEntryMutationHandlers(props);
  const { onRename, onDelete } = props;

  if (!onRename && !onDelete) {
    return null;
  }

  return (
    <>
      {onRename ? (
        <DropdownMenuItem
          leading={handlers.renameLeading}
          onSelect={handlers.handleRename}
          testID="file-explorer-rename"
        >
          {t("workspace.fileExplorer.context.rename")}
        </DropdownMenuItem>
      ) : null}
      {onDelete ? (
        <DropdownMenuItem
          leading={handlers.deleteLeading}
          onSelect={handlers.handleDelete}
          destructive
          testID="file-explorer-delete"
        >
          {t("workspace.fileExplorer.context.delete")}
        </DropdownMenuItem>
      ) : null}
    </>
  );
}

function EntryMutationContextItems(props: EntryMutationItemsProps) {
  const { t } = useTranslation();
  const handlers = useEntryMutationHandlers(props);
  const { onRename, onDelete } = props;

  if (!onRename && !onDelete) {
    return null;
  }

  return (
    <>
      {onRename ? (
        <ContextMenuItem
          leading={handlers.renameLeading}
          onSelect={handlers.handleRename}
          testID="file-explorer-context-menu-rename"
        >
          {t("workspace.fileExplorer.context.rename")}
        </ContextMenuItem>
      ) : null}
      {onDelete ? (
        <ContextMenuItem
          leading={handlers.deleteLeading}
          onSelect={handlers.handleDelete}
          destructive
          testID="file-explorer-context-menu-delete"
        >
          {t("workspace.fileExplorer.context.delete")}
        </ContextMenuItem>
      ) : null}
    </>
  );
}

export function EntryMetaBlock({
  entry,
  showSize = true,
}: {
  entry: ExplorerEntry;
  showSize?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.contextMetaBlock}>
      {showSize ? (
        <View style={styles.contextMetaRow}>
          <Text style={styles.contextMetaLabel} numberOfLines={1}>
            {t("workspace.fileExplorer.context.size")}
          </Text>
          <Text style={styles.contextMetaValue} numberOfLines={1} ellipsizeMode="tail">
            {formatFileSize({ size: entry.size })}
          </Text>
        </View>
      ) : null}
      <View style={styles.contextMetaRow}>
        <Text style={styles.contextMetaLabel} numberOfLines={1}>
          {t("workspace.fileExplorer.context.modified")}
        </Text>
        <Text style={styles.contextMetaValue} numberOfLines={1} ellipsizeMode="tail">
          {formatTimeAgo(new Date(entry.modifiedAt))}
        </Text>
      </View>
    </View>
  );
}

/**
 * Pane-level right-click menu (web only) - one shared instance serving every
 * tree row, mirroring the row's "..." dropdown actions.
 */
export function EntryContextMenu({
  request,
  onOpenChange,
  onCopyPath,
  onCopyRelativePath,
  onDownloadEntry,
  onEditEntry,
  onToggleContextEntry,
  onShowHistory,
  onViewChanges,
  onRename,
  onDelete,
  isInContext,
  isChanged,
}: {
  request: EntryContextMenuRequest | null;
  onOpenChange: (open: boolean) => void;
  onCopyPath: (path: string) => void;
  onCopyRelativePath: (path: string) => void;
  onDownloadEntry: (entry: ExplorerEntry) => void;
  onEditEntry?: (entry: ExplorerEntry) => void;
  onToggleContextEntry?: (entry: ExplorerEntry) => void;
  onShowHistory?: (entry: ExplorerEntry) => void;
  onViewChanges?: (entry: ExplorerEntry) => void;
  onRename?: (entry: ExplorerEntry) => void;
  onDelete?: (entry: ExplorerEntry) => void;
  isInContext: boolean;
  isChanged: boolean;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const entry = request?.entry ?? null;

  const handleToggleContext = useCallback(() => {
    if (entry) onToggleContextEntry?.(entry);
  }, [entry, onToggleContextEntry]);
  const handleEdit = useCallback(() => {
    if (entry) onEditEntry?.(entry);
  }, [entry, onEditEntry]);
  const handleShowHistory = useCallback(() => {
    if (entry) onShowHistory?.(entry);
  }, [entry, onShowHistory]);
  const handleViewChanges = useCallback(() => {
    if (entry) onViewChanges?.(entry);
  }, [entry, onViewChanges]);
  const handleCopy = useCallback(() => {
    if (entry) onCopyPath(entry.path);
  }, [entry, onCopyPath]);
  const handleCopyRelative = useCallback(() => {
    if (entry) onCopyRelativePath(entry.path);
  }, [entry, onCopyRelativePath]);
  const handleDownload = useCallback(() => {
    if (entry) onDownloadEntry(entry);
  }, [entry, onDownloadEntry]);
  const contextLeading = useMemo(
    () => <Paperclip size="sm" color={theme.colors.foregroundMuted} />,
    [theme.colors.foregroundMuted],
  );
  const editLeading = useMemo(
    () => <SquarePen size="sm" color={theme.colors.foregroundMuted} />,
    [theme.colors.foregroundMuted],
  );
  const copyLeading = useMemo(
    () => <Copy size="sm" color={theme.colors.foregroundMuted} />,
    [theme.colors.foregroundMuted],
  );
  const downloadLeading = useMemo(
    () => <Download size="sm" color={theme.colors.foregroundMuted} />,
    [theme.colors.foregroundMuted],
  );
  const historyLeading = useMemo(
    () => <History size="sm" color={theme.colors.foregroundMuted} />,
    [theme.colors.foregroundMuted],
  );
  const changesLeading = useMemo(
    () => <SourceControlPanelIcon size="sm" color={theme.colors.foregroundMuted} />,
    [theme.colors.foregroundMuted],
  );

  return (
    <ContextMenu open={request !== null} onOpenChange={onOpenChange} anchor={request}>
      <ContextMenuContent width={220} testID="file-explorer-context-menu">
        {entry ? (
          <>
            <EntryMetaBlock entry={entry} showSize={entry.kind === "file"} />
            <ContextMenuSeparator />
            {onToggleContextEntry ? (
              <ContextMenuItem
                leading={contextLeading}
                onSelect={handleToggleContext}
                testID={
                  isInContext
                    ? "file-explorer-context-menu-remove-from-context"
                    : "file-explorer-context-menu-add-to-context"
                }
              >
                {isInContext
                  ? t("workspace.fileExplorer.context.removeFromContext")
                  : t("workspace.fileExplorer.context.addToContext")}
              </ContextMenuItem>
            ) : null}
            {entry.kind === "file" && isChanged && onViewChanges ? (
              <ContextMenuItem
                leading={changesLeading}
                onSelect={handleViewChanges}
                testID="file-explorer-context-menu-view-changes"
              >
                {t("workspace.git.diff.viewChanges")}
              </ContextMenuItem>
            ) : null}
            {onToggleContextEntry || (entry.kind === "file" && isChanged && onViewChanges) ? (
              <ContextMenuSeparator />
            ) : null}
            <ContextMenuItem leading={copyLeading} onSelect={handleCopy}>
              {t("workspace.fileExplorer.context.copyPath")}
            </ContextMenuItem>
            <ContextMenuItem leading={copyLeading} onSelect={handleCopyRelative}>
              {t("workspace.fileExplorer.context.copyRelativePath")}
            </ContextMenuItem>
            {entry.kind === "file" ? (
              <ContextMenuItem leading={downloadLeading} onSelect={handleDownload}>
                {t("workspace.fileExplorer.context.download")}
              </ContextMenuItem>
            ) : null}
            {hasEntryBottomActions(entry, onEditEntry, onShowHistory, onRename, onDelete) ? (
              <ContextMenuSeparator />
            ) : null}
            {entry.kind === "file" && onEditEntry ? (
              <ContextMenuItem leading={editLeading} onSelect={handleEdit}>
                {t("workspace.fileActions.editFile")}
              </ContextMenuItem>
            ) : null}
            {entry.kind === "file" && onShowHistory ? (
              <ContextMenuItem
                leading={historyLeading}
                onSelect={handleShowHistory}
                testID="file-explorer-context-menu-git-history"
              >
                {t("gitFileHistory.open")}
              </ContextMenuItem>
            ) : null}
            <EntryMutationContextItems entry={entry} onRename={onRename} onDelete={onDelete} />
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

export interface TreeRow {
  entry: ExplorerEntry;
  depth: number;
  /** which indent rails keep running below this row - see tree-rail-mask.ts */
  ancestorMask: number;
}

export interface NameSheetRequest {
  mode: FileNameSheetMode;
  /** Directory the entry lands in - for rename, the target's existing parent. */
  parentPath: string;
  /** Rename only: the entry being renamed. */
  targetPath?: string;
  initialValue?: string;
}

/** The filesystem lens's list, extracted so the lens branch above reads as one choice. */
export function FileTreeBody({
  treeRows,
  emptyLabel,
  treeListRef,
  renderTreeRow,
  scrollbar,
  showWebScrollbar,
  handleScrollToIndexFailed,
}: {
  treeRows: TreeRow[];
  emptyLabel: string;
  treeListRef: RefObject<FlatList<TreeRow> | null>;
  renderTreeRow: (info: ListRenderItemInfo<TreeRow>) => ReactElement;
  scrollbar: ReturnType<typeof useWebScrollViewScrollbar>;
  showWebScrollbar: boolean;
  handleScrollToIndexFailed: (info: { index: number; averageItemLength: number }) => void;
}) {
  if (treeRows.length === 0) {
    return (
      <View style={styles.centerState}>
        <Text style={styles.emptyText}>{emptyLabel}</Text>
      </View>
    );
  }

  return (
    <>
      <FlatList
        ref={treeListRef}
        style={styles.treeList}
        data={treeRows}
        renderItem={renderTreeRow}
        keyExtractor={treeRowKeyExtractor}
        testID="file-explorer-tree-scroll"
        contentContainerStyle={styles.entriesContent}
        onLayout={scrollbar.onLayout}
        onScroll={scrollbar.onScroll}
        onContentSizeChange={scrollbar.onContentSizeChange}
        onScrollToIndexFailed={handleScrollToIndexFailed}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={!showWebScrollbar}
        initialNumToRender={24}
        maxToRenderPerBatch={40}
        windowSize={12}
      />
      {scrollbar.overlay}
    </>
  );
}

/**
 * Files vs Solution, and - when a repository has more than one - which solution.
 *
 * One control rather than two: a lens toggle beside a solution picker would make the common case
 * (one solution) show a picker with a single entry, and the two choices are really one question.
 * **Absent entirely when there are no solutions**, which is what makes the feature transparent: a
 * workspace that is not a .NET repository looks exactly as it did before this shipped.
 */
export function ExplorerLensSwitcher({
  solutions,
  viewMode,
  selectedSolutionPath,
  onSelectViewMode,
  onSelectSolution,
  triggerStyle,
}: {
  solutions: readonly SolutionRef[];
  viewMode: ExplorerViewMode;
  selectedSolutionPath: string | null;
  onSelectViewMode: (mode: ExplorerViewMode) => void;
  onSelectSolution: (solutionPath: string) => void;
  triggerStyle: (state: PressableStateCallbackType) => StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();

  const selectFiles = useCallback(() => onSelectViewMode("files"), [onSelectViewMode]);

  if (solutions.length === 0) {
    return null;
  }

  const activeSolution = solutions.find((solution) => solution.path === selectedSolutionPath);
  const label =
    viewMode === "solution" && activeSolution !== undefined
      ? activeSolution.name
      : t("workspace.solution.lens.files");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger style={triggerStyle} testID="explorer-lens-switcher">
        <Text style={styles.sortTriggerText} numberOfLines={1}>
          {label}
        </Text>
        <ChevronDown size="xs" color={theme.colors.foregroundMuted} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" width={240}>
        <DropdownMenuItem onSelect={selectFiles} testID="explorer-lens-files">
          {t("workspace.solution.lens.files")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {solutions.map((solution) => (
          <SolutionPickerItem key={solution.path} solution={solution} onSelect={onSelectSolution} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SolutionPickerItem({
  solution,
  onSelect,
}: {
  solution: SolutionRef;
  onSelect: (solutionPath: string) => void;
}) {
  const handleSelect = useCallback(() => onSelect(solution.path), [onSelect, solution.path]);
  return (
    <DropdownMenuItem onSelect={handleSelect} testID={`explorer-lens-solution-${solution.path}`}>
      {solution.name}
    </DropdownMenuItem>
  );
}

/**
 * Which solution the lens is showing. The remembered choice wins while it still exists; otherwise
 * the first one, so a repository that renames or drops a solution opens on something real instead
 * of on nothing.
 */
export function resolveSelectedSolutionPath({
  serverId,
  cwd,
  solutions,
  explorerSolutionByCheckout,
}: {
  serverId: string;
  cwd: string;
  solutions: readonly SolutionRef[];
  explorerSolutionByCheckout: Record<string, string>;
}): string | null {
  if (solutions.length === 0) {
    return null;
  }
  const key = buildExplorerCheckoutKey(serverId, cwd);
  const remembered = key === null ? undefined : explorerSolutionByCheckout[key];
  if (remembered !== undefined && solutions.some((solution) => solution.path === remembered)) {
    return remembered;
  }
  return solutions[0].path;
}

function sortEntries(entries: ExplorerEntry[], sortOption: SortOption): ExplorerEntry[] {
  const sorted = [...entries];
  sorted.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "directory" ? -1 : 1;
    }
    switch (sortOption) {
      case "name":
        return a.name.localeCompare(b.name);
      case "modified":
        return new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
      case "size":
        return b.size - a.size;
      default:
        return 0;
    }
  });
  return sorted;
}

function buildTreeRows({
  directories,
  expandedPaths,
  sortOption,
  showHiddenFiles,
  path,
  depth,
  parentMask,
}: {
  directories: Map<string, { path: string; entries: ExplorerEntry[] }>;
  expandedPaths: Set<string>;
  sortOption: SortOption;
  showHiddenFiles: boolean;
  path: string;
  depth: number;
  parentMask: number;
}): TreeRow[] {
  const directory = directories.get(path);
  if (!directory) {
    return [];
  }

  const rows: TreeRow[] = [];
  const entries = sortEntries(
    filterVisibleExplorerEntries(directory.entries, showHiddenFiles),
    sortOption,
  );

  // Sibling position is decided on the SORTED, hidden-file-filtered list above, so
  // the rails follow what is actually on screen rather than the raw listing.
  const lastIndex = entries.length - 1;
  entries.forEach((entry, index) => {
    const ancestorMask = withTreeRail(parentMask, depth, index !== lastIndex);
    rows.push({ entry, depth, ancestorMask });
    if (entry.kind === "directory" && expandedPaths.has(entry.path)) {
      rows.push(
        ...buildTreeRows({
          directories,
          expandedPaths,
          sortOption,
          showHiddenFiles,
          path: entry.path,
          depth: depth + 1,
          parentMask: ancestorMask,
        }),
      );
    }
  });

  return rows;
}

export function resolveTreeRows({
  directories,
  expandedPaths,
  sortOption,
  showHiddenFiles,
}: {
  directories: Map<string, { path: string; entries: ExplorerEntry[] }>;
  expandedPaths: Set<string>;
  sortOption: SortOption;
  showHiddenFiles: boolean;
}): TreeRow[] {
  if (!directories.get(".")) {
    return [];
  }
  return buildTreeRows({
    directories,
    expandedPaths,
    sortOption,
    showHiddenFiles,
    path: ".",
    depth: 0,
    parentMask: TREE_RAILS_ALL_CONTINUE,
  });
}

type StartDownloadFn = ReturnType<typeof useDownloadStore.getState>["startDownload"];

type StartDownloadParams = Parameters<StartDownloadFn>[0];

export function downloadExplorerEntry({
  entry,
  workspaceScopeId,
  serverId,
  daemonProfile,
  startDownload,
  requestFileDownloadToken,
}: {
  entry: ExplorerEntry;
  workspaceScopeId: string | undefined;
  serverId: string;
  daemonProfile: StartDownloadParams["daemonProfile"];
  startDownload: StartDownloadFn;
  requestFileDownloadToken: (
    targetPath: string,
  ) => ReturnType<StartDownloadParams["requestFileDownloadToken"]>;
}): void {
  if (!workspaceScopeId || entry.kind !== "file") {
    return;
  }
  startDownload({
    serverId,
    scopeId: workspaceScopeId,
    fileName: entry.name,
    path: entry.path,
    daemonProfile,
    requestFileDownloadToken: (targetPath) => requestFileDownloadToken(targetPath),
  });
}

/** Parent directory paths for a workspace-relative entry path, shallowest first. */
export function collectRevealParentDirectories(path: string): string[] {
  const segments = path.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  const parents: string[] = [];
  for (let index = 1; index < segments.length; index++) {
    parents.push(segments.slice(0, index).join("/"));
  }
  return parents;
}

const styles = StyleSheet.create((theme) => ({
  // Duplicated from file-explorer-pane.tsx styles (keep in sync).
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[4],
  },
  sortTriggerText: {
    // Explicit compact bump matching the Changes pane's mode trigger.
    fontSize: {
      xs: theme.fontSize.xs + 2,
      md: theme.fontSize.xs,
    },
    color: theme.colors.foregroundMuted,
  },
  treePane: {
    minWidth: 0,
    position: "relative",
  },
  treePaneFill: {
    flex: 1,
  },
  treeList: {
    flex: 1,
    minHeight: 0,
  },
  entriesContent: {
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[4],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  menuButton: {
    // 1.5x on compact to wrap the kebab icon's compact upscale.
    width: compactUp(30, 1.5),
    height: compactUp(30, 1.5),
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  menuButtonActive: {
    backgroundColor: theme.colors.surface2,
  },
  contextMetaBlock: {
    paddingVertical: theme.spacing[1],
  },
  contextMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 32,
    paddingHorizontal: theme.spacing[3],
  },
  contextMetaLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    flexShrink: 0,
  },
  contextMetaValue: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
    flex: 1,
    minWidth: 0,
    textAlign: "right",
  },
}));

export const TREE_PANE_CONTAINER_STYLE = [styles.treePane, styles.treePaneFill];
