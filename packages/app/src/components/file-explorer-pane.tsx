import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  FlatList,
  ListRenderItemInfo,
  Pressable,
  Text,
  View,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { WORKSPACE_SECONDARY_HEADER_HEIGHT } from "@/constants/layout";
import * as Clipboard from "expo-clipboard";
import { SvgXml } from "react-native-svg";
import {
  ChevronDown,
  Copy,
  Download,
  Eye,
  EyeOff,
  FilePlus,
  Folder,
  FolderPlus,
  History,
  MoreVertical,
  Paperclip,
  RotateCw,
  Search,
  SquarePen,
} from "@/components/icons/material-icons";
import { SourceControlPanelIcon } from "@/components/icons/source-control-panel-icon";
import { getFileIconSvg } from "@/components/material-file-icons";
import { compactUp, useIconSize } from "@/styles/theme";
import { TreeChevron, TreeIndentGuides, TREE_INDENT_PER_LEVEL } from "@/components/tree-primitives";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AgentFileExplorerState, ExplorerEntry } from "@/stores/session-store";
import { useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useTextEditorFeature } from "@/editor/use-text-editor-feature";
import { useCodeIndexFeature } from "@/editor/use-code-index-feature";
import { FileFinderOverlay } from "@/components/file-finder-overlay";
import {
  useWorkspaceAttachments,
  useWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import { useDownloadStore } from "@/stores/download-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { contextMenuAnchorFromEvent } from "@/components/ui/context-menu";
import { useFileExplorerActions } from "@/hooks/use-file-explorer-actions";
import { buildWorkspaceExplorerStateKey } from "@/hooks/use-file-explorer-actions";
import {
  resolveExplorerViewMode,
  usePanelStore,
  type ExplorerViewMode,
  type SortOption,
} from "@/stores/panel-store";
import type { SolutionRef } from "@otto-code/client/internal/daemon-client";
import { SolutionTreePane } from "@/solution/solution-tree-pane";
import { useSolutionsQuery } from "@/solution/use-solution-queries";
import { buildAbsoluteExplorerPath, explorerParentPath } from "@/utils/explorer-paths";
import { useFileMutationsFeature } from "@/file-explorer/use-file-mutations-feature";
import { useFileMutations } from "@/file-explorer/use-file-mutations";
import { FileNameSheet } from "@/file-explorer/file-name-sheet";
import { isHiddenExplorerPath } from "@/file-explorer/visibility";
import { planExpandedPathSync } from "@/file-explorer/expanded-paths";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { useCheckoutStatusQuery } from "@/git/use-status-query";
import { revealFileInChanges, revealFileInFiles, useChangedFilePaths } from "@/git/changes-reveal";
import { openFileHistoryTab } from "@/git/file-history/open-file-history-tab";
import { isNative, isWeb } from "@/constants/platform";

import {
  EntryContextMenu,
  EntryContextMenuRequest,
  EntryMetaBlock,
  EntryMutationMenuItems,
  ExplorerLensSwitcher,
  FileTreeBody,
  NameSheetRequest,
  RequestDirectoryListing,
  TREE_PANE_CONTAINER_STYLE,
  TreeRow,
  collectRevealParentDirectories,
  downloadExplorerEntry,
  hasEntryBottomActions,
  menuButtonStyle,
  resolveSelectedSolutionPath,
  resolveTreeRows,
  stopPressInPropagation,
} from "@/components/file-explorer-entries";

const SORT_OPTIONS: { value: SortOption }[] = [
  { value: "name" },
  { value: "modified" },
  { value: "size" },
];

interface TreeRowItemProps {
  entry: ExplorerEntry;
  depth: number;
  ancestorMask: number;
  isExpanded: boolean;
  isSelected: boolean;
  loading: boolean;
  onEntryPress: (entry: ExplorerEntry) => void;
  onCopyPath: (path: string) => void;
  onCopyRelativePath: (path: string) => void;
  onDownloadEntry: (entry: ExplorerEntry) => void;
  onEditEntry?: (entry: ExplorerEntry) => void;
  onToggleContextEntry?: (entry: ExplorerEntry) => void;
  /** Undefined outside a git repo, or on a host that cannot answer. */
  onShowHistory?: (entry: ExplorerEntry) => void;
  onViewChanges?: (entry: ExplorerEntry) => void;
  onShowContextMenu?: (request: EntryContextMenuRequest) => void;
  /** Both are undefined on a host without `features.fileMutations`. */
  onRename?: (entry: ExplorerEntry) => void;
  onDelete?: (entry: ExplorerEntry) => void;
  isInContext: boolean;
  /** This file is in the workspace's current diff, so it has changes to view. */
  isChanged: boolean;
}

function sortTriggerStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.sortTrigger, (Boolean(hovered) || pressed) && styles.sortTriggerHovered];
}

function iconButtonStyle({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.iconButton, (Boolean(hovered) || pressed) && styles.iconButtonHovered];
}

function TreeRowItem({
  entry,
  depth,
  ancestorMask,
  isExpanded,
  isSelected,
  loading,
  onEntryPress,
  onCopyPath,
  onCopyRelativePath,
  onDownloadEntry,
  onEditEntry,
  onToggleContextEntry,
  onShowHistory,
  onViewChanges,
  onShowContextMenu,
  onRename,
  onDelete,
  isInContext,
  isChanged,
}: TreeRowItemProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const iconSize = useIconSize();
  const isDirectory = entry.kind === "directory";
  // Hover lives on a plain outer View (see docs/hover.md) so the kebab can
  // collapse without the nested-Pressable hover fight; the menu stays mounted
  // while open so the dropdown keeps its anchor.
  const [isHovered, setIsHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const showMenu = isHovered || menuOpen || isNative || isCompact;

  const handlePointerEnter = useCallback(() => {
    setIsHovered(true);
  }, []);

  const handlePointerLeave = useCallback(() => {
    setIsHovered(false);
  }, []);

  const handlePress = useCallback(() => {
    onEntryPress(entry);
  }, [onEntryPress, entry]);

  const handleContextMenu = useCallback(
    (event: unknown) => {
      if (!onShowContextMenu) {
        return;
      }
      const anchor = contextMenuAnchorFromEvent(event);
      if (!anchor) {
        return;
      }
      onShowContextMenu({ entry, x: anchor.x, y: anchor.y });
    },
    [entry, onShowContextMenu],
  );

  const pressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.entryRow,
      { paddingLeft: theme.spacing[2] + depth * TREE_INDENT_PER_LEVEL },
      (isHovered || pressed || isSelected) && styles.entryRowActive,
    ],
    [depth, isHovered, isSelected, theme.spacing],
  );

  const handleCopy = useCallback(() => {
    onCopyPath(entry.path);
  }, [onCopyPath, entry.path]);
  const handleCopyRelative = useCallback(() => {
    onCopyRelativePath(entry.path);
  }, [onCopyRelativePath, entry.path]);

  const handleDownload = useCallback(() => {
    onDownloadEntry(entry);
  }, [onDownloadEntry, entry]);

  const handleEdit = useCallback(() => {
    onEditEntry?.(entry);
  }, [onEditEntry, entry]);

  const handleToggleContext = useCallback(() => {
    onToggleContextEntry?.(entry);
  }, [onToggleContextEntry, entry]);

  const handleShowHistory = useCallback(() => {
    onShowHistory?.(entry);
  }, [onShowHistory, entry]);

  const handleViewChanges = useCallback(() => {
    onViewChanges?.(entry);
  }, [onViewChanges, entry]);

  const copyLeading = useMemo(
    () => <Copy size={iconSize.sm} color={theme.colors.foregroundMuted} />,
    [iconSize.sm, theme.colors.foregroundMuted],
  );
  const downloadLeading = useMemo(
    () => <Download size={iconSize.sm} color={theme.colors.foregroundMuted} />,
    [iconSize.sm, theme.colors.foregroundMuted],
  );
  const editLeading = useMemo(
    () => <SquarePen size={iconSize.sm} color={theme.colors.foregroundMuted} />,
    [iconSize.sm, theme.colors.foregroundMuted],
  );
  const contextLeading = useMemo(
    () => <Paperclip size={iconSize.sm} color={theme.colors.foregroundMuted} />,
    [iconSize.sm, theme.colors.foregroundMuted],
  );
  const historyLeading = useMemo(
    () => <History size={iconSize.sm} color={theme.colors.foregroundMuted} />,
    [iconSize.sm, theme.colors.foregroundMuted],
  );
  // The Changes tab's own +/- glyph - the destination named by its icon.
  const changesLeading = useMemo(
    () => <SourceControlPanelIcon size={iconSize.sm} color={theme.colors.foregroundMuted} />,
    [iconSize.sm, theme.colors.foregroundMuted],
  );

  return (
    <View
      style={styles.entryRowContainer}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <Pressable
        onPress={handlePress}
        // @ts-ignore - onContextMenu is web-only and not in RN types.
        onContextMenu={isWeb && onShowContextMenu ? handleContextMenu : undefined}
        style={pressableStyle}
      >
        <TreeIndentGuides depth={depth} ancestorMask={ancestorMask} />
        <View style={styles.entryInfo}>
          <View style={styles.entryIcon}>
            {(() => {
              if (!isDirectory) {
                return (
                  <SvgXml
                    xml={getFileIconSvg(entry.name)}
                    width={iconSize.md}
                    height={iconSize.md}
                  />
                );
              }
              if (loading) {
                return (
                  <View style={styles.treeLoadingIcon}>
                    <LoadingSpinner size={iconSize.md} />
                  </View>
                );
              }
              return <TreeChevron expanded={isExpanded} />;
            })()}
          </View>
          {isDirectory ? (
            <View style={styles.directoryName}>
              <Folder size={iconSize.md} color={theme.colors.foregroundMuted} />
              <Text style={[styles.entryName, styles.directoryEntryName]} numberOfLines={1}>
                {entry.name}
              </Text>
            </View>
          ) : (
            <Text style={styles.entryName} numberOfLines={1}>
              {entry.name}
            </Text>
          )}
        </View>
        {showMenu ? (
          <DropdownMenu onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger
              hitSlop={8}
              onPressIn={stopPressInPropagation}
              style={menuButtonStyle}
            >
              <MoreVertical size={iconSize.md} color={theme.colors.foregroundMuted} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" width={220}>
              <EntryMetaBlock entry={entry} showSize={entry.kind === "file"} />
              <DropdownMenuSeparator />
              {onToggleContextEntry ? (
                <DropdownMenuItem
                  leading={contextLeading}
                  onSelect={handleToggleContext}
                  testID={
                    isInContext
                      ? "file-explorer-remove-from-context"
                      : "file-explorer-add-to-context"
                  }
                >
                  {isInContext
                    ? t("workspace.fileExplorer.context.removeFromContext")
                    : t("workspace.fileExplorer.context.addToContext")}
                </DropdownMenuItem>
              ) : null}
              {entry.kind === "file" && isChanged && onViewChanges ? (
                <DropdownMenuItem
                  leading={changesLeading}
                  onSelect={handleViewChanges}
                  testID="file-explorer-view-changes"
                >
                  {t("workspace.git.diff.viewChanges")}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem leading={copyLeading} onSelect={handleCopy}>
                {t("workspace.fileExplorer.context.copyPath")}
              </DropdownMenuItem>
              <DropdownMenuItem leading={copyLeading} onSelect={handleCopyRelative}>
                {t("workspace.fileExplorer.context.copyRelativePath")}
              </DropdownMenuItem>
              {entry.kind === "file" ? (
                <DropdownMenuItem leading={downloadLeading} onSelect={handleDownload}>
                  {t("workspace.fileExplorer.context.download")}
                </DropdownMenuItem>
              ) : null}
              {hasEntryBottomActions(entry, onEditEntry, onShowHistory, onRename, onDelete) ? (
                <DropdownMenuSeparator />
              ) : null}
              {entry.kind === "file" && onEditEntry ? (
                <DropdownMenuItem leading={editLeading} onSelect={handleEdit}>
                  {t("workspace.fileExplorer.context.edit")}
                </DropdownMenuItem>
              ) : null}
              {entry.kind === "file" && onShowHistory ? (
                <DropdownMenuItem
                  leading={historyLeading}
                  onSelect={handleShowHistory}
                  testID="file-explorer-git-history"
                >
                  {t("gitFileHistory.open")}
                </DropdownMenuItem>
              ) : null}
              <EntryMutationMenuItems entry={entry} onRename={onRename} onDelete={onDelete} />
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </Pressable>
    </View>
  );
}

interface FileExplorerPaneProps {
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
  onOpenFile?: (filePath: string, options?: { edit?: boolean; lineStart?: number }) => void;
}

export function FileExplorerPane({
  serverId,
  workspaceId,
  workspaceRoot,
  onOpenFile,
}: FileExplorerPaneProps) {
  const { t } = useTranslation();
  // Ungated on compact: the app's overlay bar is wanted on mobile web too,
  // where the platform otherwise draws its dated one. No-ops off web.
  const showWebScrollbar = isWeb;

  const daemons = useHosts();
  const daemonProfile = useMemo(
    () => daemons.find((daemon) => daemon.serverId === serverId),
    [daemons, serverId],
  );
  const normalizedWorkspaceRoot = useMemo(() => workspaceRoot.trim(), [workspaceRoot]);
  // The root has no relative path to show, so the name sheet's "In …" hint names
  // the workspace folder instead of printing a bare ".".
  const workspaceLabel = useMemo(() => {
    const segments = normalizedWorkspaceRoot.split(/[\\/]+/).filter(Boolean);
    return segments[segments.length - 1] ?? normalizedWorkspaceRoot;
  }, [normalizedWorkspaceRoot]);
  const workspaceStateKey = useMemo(
    () =>
      buildWorkspaceExplorerStateKey({
        workspaceId,
        workspaceRoot: normalizedWorkspaceRoot,
      }),
    [normalizedWorkspaceRoot, workspaceId],
  );
  const workspaceScopeId = useMemo(
    () => workspaceId?.trim() || normalizedWorkspaceRoot,
    [normalizedWorkspaceRoot, workspaceId],
  );
  const hasWorkspaceScope = Boolean(workspaceStateKey && normalizedWorkspaceRoot);
  const explorerState = useSessionStore((state) =>
    workspaceStateKey && state.sessions[serverId]
      ? state.sessions[serverId]?.fileExplorer.get(workspaceStateKey)
      : undefined,
  );

  const { requestDirectoryListing, requestFileDownloadToken, selectExplorerEntry } =
    useFileExplorerActions({
      serverId,
      workspaceId,
      workspaceRoot: normalizedWorkspaceRoot,
    });
  const sortOption = usePanelStore((state) => state.explorerSortOption);
  const showHiddenFiles = usePanelStore((state) => state.explorerShowHiddenFiles);
  const setSortOption = usePanelStore((state) => state.setExplorerSortOption);
  const toggleExplorerShowHiddenFiles = usePanelStore(
    (state) => state.toggleExplorerShowHiddenFiles,
  );
  const expandedPathsArray = usePanelStore((state) =>
    workspaceStateKey ? state.expandedPathsByWorkspace[workspaceStateKey] : undefined,
  );
  const setExpandedPathsForWorkspace = usePanelStore((state) => state.setExpandedPathsForWorkspace);
  const expandedPaths = useMemo(
    () => new Set(expandedPathsArray && expandedPathsArray.length > 0 ? expandedPathsArray : ["."]),
    [expandedPathsArray],
  );

  const explorerDerived = useMemo(() => deriveExplorerFields(explorerState), [explorerState]);
  const { directories, pendingRequest, isExplorerLoading, error, selectedEntryPath } =
    explorerDerived;

  const isDirectoryLoading = useCallback(
    (path: string) => isPendingListForPath({ isExplorerLoading, pendingRequest, path }),
    [isExplorerLoading, pendingRequest],
  );

  const treeListRef = useRef<FlatList<TreeRow>>(null);
  const scrollbar = useWebScrollViewScrollbar(treeListRef, {
    enabled: showWebScrollbar,
  });

  const hasInitializedRef = useRef(false);
  // Listings this pane has already asked for while restoring expansion, so a
  // cascade pass triggered by an arriving sibling does not ask twice. Failures
  // stay in the set: the user re-expands the folder, or refreshes, to retry.
  const attemptedExpandedPathsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    hasInitializedRef.current = false;
    attemptedExpandedPathsRef.current = new Set();
  }, [workspaceStateKey]);

  useEffect(() => {
    void initializeExplorer({
      hasWorkspaceScope,
      hasInitializedRef,
      requestDirectoryListing,
    });
  }, [hasWorkspaceScope, requestDirectoryListing, workspaceStateKey]);

  // Persisted expansion is restored from the listings themselves, one level at a
  // time, and forgotten where the listing says the folder is gone. See
  // `planExpandedPathSync` for why replaying it blind was the bug.
  useEffect(() => {
    if (!hasWorkspaceScope || !workspaceStateKey) {
      return;
    }
    const plan = planExpandedPathSync({
      directories,
      expandedPaths,
      showHiddenFiles,
      inFlightPaths: attemptedExpandedPathsRef.current,
    });
    if (plan.prune.length > 0) {
      const prunedPaths = new Set(plan.prune);
      setExpandedPathsForWorkspace(
        workspaceStateKey,
        Array.from(expandedPaths).filter((path) => !prunedPaths.has(path)),
      );
    }
    for (const path of plan.request) {
      attemptedExpandedPathsRef.current.add(path);
      void requestDirectoryListing(path, {
        recordHistory: false,
        setCurrentPath: false,
        surfaceErrors: false,
      });
    }
  }, [
    directories,
    expandedPaths,
    hasWorkspaceScope,
    requestDirectoryListing,
    setExpandedPathsForWorkspace,
    showHiddenFiles,
    workspaceStateKey,
  ]);

  const handleToggleDirectory = useCallback(
    (entry: ExplorerEntry) =>
      toggleDirectory({
        entry,
        workspaceStateKey,
        expandedPaths,
        directories,
        requestDirectoryListing,
        setExpandedPathsForWorkspace,
      }),
    [
      workspaceStateKey,
      expandedPaths,
      directories,
      requestDirectoryListing,
      setExpandedPathsForWorkspace,
    ],
  );

  const handleOpenFile = useCallback(
    (entry: ExplorerEntry) => {
      if (!hasWorkspaceScope) {
        return;
      }
      selectExplorerEntry(entry.path);
      onOpenFile?.(entry.path);
    },
    [hasWorkspaceScope, onOpenFile, selectExplorerEntry],
  );

  const canEditFiles = useTextEditorFeature(serverId);
  const handleEditEntry = useMemo(() => {
    if (!canEditFiles || !onOpenFile) {
      return undefined;
    }
    return (entry: ExplorerEntry) => {
      if (!hasWorkspaceScope) {
        return;
      }
      selectExplorerEntry(entry.path);
      onOpenFile(entry.path, { edit: true });
    };
  }, [canEditFiles, hasWorkspaceScope, onOpenFile, selectExplorerEntry]);

  // Git history is offered only where the question has an answer: a host that
  // can serve it, a workspace to open the tab in, and - unlike the Changes view,
  // where every row is by definition tracked - an actual git repository. The
  // explorer happily browses folders that are not repos at all.
  const fileHistorySupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.checkoutGitFileHistory === true,
  );
  const { status: checkoutStatus } = useCheckoutStatusQuery({
    serverId,
    cwd: normalizedWorkspaceRoot,
  });
  const handleShowHistoryEntry = useMemo(() => {
    if (!fileHistorySupported || !checkoutStatus || !workspaceId) {
      return undefined;
    }
    return (entry: ExplorerEntry) => {
      openFileHistoryTab({ serverId, workspaceId, path: entry.path });
    };
  }, [checkoutStatus, fileHistorySupported, serverId, workspaceId]);

  // "View changes" is offered per row, only for files the Changes tab actually
  // lists - an entry that would land on an empty tab is a broken promise, so the
  // item is absent rather than disabled. `workspaceRoot` (untrimmed) is passed
  // through so this shares the Changes pane's diff subscription.
  const changedPaths = useChangedFilePaths({
    serverId,
    workspaceId,
    cwd: workspaceRoot,
    enabled: hasWorkspaceScope,
  });
  const handleViewChangesEntry = useCallback(
    (entry: ExplorerEntry) => {
      revealFileInChanges({ serverId, cwd: workspaceRoot, path: entry.path });
    },
    [serverId, workspaceRoot],
  );

  // Create / rename / delete. Gated on `features.fileMutations`: the client
  // never touches the filesystem, so there is nothing to degrade to - an old
  // host simply has no such menu items and no header buttons.
  const canMutateFiles = useFileMutationsFeature(serverId);
  const refreshDirectory = useCallback(
    (path: string) => {
      void requestDirectoryListing(path, { recordHistory: false, setCurrentPath: false });
    },
    [requestDirectoryListing],
  );
  const { createEntry, renameEntry, deleteEntry } = useFileMutations({
    serverId,
    workspaceRoot: normalizedWorkspaceRoot,
    refreshDirectory,
  });

  const [nameSheet, setNameSheet] = useState<NameSheetRequest | null>(null);
  const closeNameSheet = useCallback(() => setNameSheet(null), []);

  const openNameSheet = useCallback((request: NameSheetRequest) => {
    setNameSheet(request);
  }, []);

  const handleRenameEntry = useMemo(() => {
    if (!canMutateFiles) {
      return undefined;
    }
    return (entry: ExplorerEntry) =>
      openNameSheet({
        mode: "rename",
        parentPath: explorerParentPath(entry.path),
        targetPath: entry.path,
        initialValue: entry.name,
      });
  }, [canMutateFiles, openNameSheet]);

  const handleDeleteEntry = useMemo(() => {
    if (!canMutateFiles) {
      return undefined;
    }
    return (entry: ExplorerEntry) => {
      void deleteEntry({ path: entry.path, name: entry.name, kind: entry.kind });
    };
  }, [canMutateFiles, deleteEntry]);

  // Root-level create. Without these the only way to make the first file in an
  // empty workspace would be a row menu on a row that does not exist yet.
  const handleNewRootFile = useMemo(() => {
    if (!canMutateFiles) {
      return undefined;
    }
    return () => openNameSheet({ mode: "create-file", parentPath: "." });
  }, [canMutateFiles, openNameSheet]);
  const handleNewRootFolder = useMemo(() => {
    if (!canMutateFiles) {
      return undefined;
    }
    return () => openNameSheet({ mode: "create-folder", parentPath: "." });
  }, [canMutateFiles, openNameSheet]);

  const handleNameSheetSubmit = useCallback(
    async (name: string): Promise<string | null> => {
      if (!nameSheet) {
        return null;
      }
      if (nameSheet.mode === "rename" && nameSheet.targetPath) {
        return renameEntry({ path: nameSheet.targetPath, newName: name });
      }
      const failure = await createEntry({
        parentPath: nameSheet.parentPath,
        name,
        kind: nameSheet.mode === "create-folder" ? "directory" : "file",
      });
      // Creating into a collapsed folder that then stays collapsed reads as
      // nothing having happened - expand it so the new entry is on screen.
      if (!failure && workspaceStateKey && !expandedPaths.has(nameSheet.parentPath)) {
        setExpandedPathsForWorkspace(workspaceStateKey, [
          ...Array.from(expandedPaths),
          nameSheet.parentPath,
        ]);
      }
      return failure;
    },
    [
      createEntry,
      expandedPaths,
      nameSheet,
      renameEntry,
      setExpandedPathsForWorkspace,
      workspaceStateKey,
    ],
  );

  // "Add to chat" mirrors the diff pane's review comments: the file lands
  // in the workspace-scoped attachment store, shows as a composer pill, and
  // can be removed from either side. Offered only while an agent tab is the
  // focused pane, so the attachment has a visible destination.
  const focusedAgentId = useSessionStore(
    (state) => state.sessions[serverId]?.focusedAgentId ?? null,
  );
  const attachmentScopeKey = useWorkspaceAttachmentScopeKey({
    serverId,
    workspaceId,
    cwd: normalizedWorkspaceRoot,
  });
  const workspaceAttachments = useWorkspaceAttachments(attachmentScopeKey);
  const contextFilePaths = useMemo(() => {
    const paths = new Set<string>();
    for (const attachment of workspaceAttachments) {
      if (attachment.kind === "file_context") {
        paths.add(attachment.path);
      }
    }
    return paths;
  }, [workspaceAttachments]);
  const handleToggleContextEntry = useMemo(() => {
    if (!focusedAgentId) {
      return undefined;
    }
    return (entry: ExplorerEntry) => {
      const { attachmentsByScope, setWorkspaceAttachments, addWorkspaceAttachment } =
        useWorkspaceAttachmentsStore.getState();
      const current = attachmentsByScope[attachmentScopeKey] ?? [];
      const remaining = current.filter(
        (attachment) => !(attachment.kind === "file_context" && attachment.path === entry.path),
      );
      if (remaining.length !== current.length) {
        setWorkspaceAttachments({ scopeKey: attachmentScopeKey, attachments: remaining });
        return;
      }
      addWorkspaceAttachment({
        scopeKey: attachmentScopeKey,
        attachment: {
          kind: "file_context",
          id: entry.path,
          path: entry.path,
          entryKind: entry.kind,
        },
      });
    };
  }, [attachmentScopeKey, focusedAgentId]);

  const [contextMenuRequest, setContextMenuRequest] = useState<EntryContextMenuRequest | null>(
    null,
  );
  const handleShowContextMenu = useCallback((request: EntryContextMenuRequest) => {
    setContextMenuRequest(request);
  }, []);
  const handleContextMenuOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setContextMenuRequest(null);
    }
  }, []);

  const handleEntryPress = useCallback(
    (entry: ExplorerEntry) => {
      if (entry.kind === "directory") {
        handleToggleDirectory(entry);
        return;
      }
      handleOpenFile(entry);
    },
    [handleOpenFile, handleToggleDirectory],
  );

  const handleCopyPath = useCallback(
    async (path: string) => {
      await Clipboard.setStringAsync(
        buildAbsoluteExplorerPath({
          workspaceRoot: normalizedWorkspaceRoot,
          entryPath: path,
        }),
      );
    },
    [normalizedWorkspaceRoot],
  );

  // `entry.path` is already workspace-relative - copy it as-is (forward slashes,
  // repo-relative), the VS Code "Copy Relative Path" idiom. The absolute variant
  // above joins it onto the workspace root.
  const handleCopyRelativePath = useCallback(async (path: string) => {
    await Clipboard.setStringAsync(path);
  }, []);

  const startDownload = useDownloadStore((state) => state.startDownload);
  const handleDownloadEntry = useCallback(
    (entry: ExplorerEntry) =>
      downloadExplorerEntry({
        entry,
        workspaceScopeId,
        serverId,
        daemonProfile,
        startDownload,
        requestFileDownloadToken,
      }),
    [daemonProfile, requestFileDownloadToken, serverId, startDownload, workspaceScopeId],
  );

  const handleSortCycle = useCallback(() => {
    const currentIndex = SORT_OPTIONS.findIndex((opt) => opt.value === sortOption);
    const nextIndex = (currentIndex + 1) % SORT_OPTIONS.length;
    setSortOption(SORT_OPTIONS[nextIndex].value);
  }, [sortOption, setSortOption]);

  // Revealing hidden files re-runs the cascade effect through `showHiddenFiles`,
  // which lists the hidden folders that were remembered but held back.
  const handleToggleHiddenFiles = useCallback(() => {
    toggleExplorerShowHiddenFiles();
  }, [toggleExplorerShowHiddenFiles]);

  const refreshExplorer = useCallback(
    () =>
      refreshExplorerDirectories({
        hasWorkspaceScope,
        directories,
        expandedPaths,
        attemptedExpandedPathsRef,
        requestDirectoryListing,
      }),
    [directories, expandedPaths, hasWorkspaceScope, requestDirectoryListing],
  );
  const { refetch: refetchExplorer, isFetching: isRefreshFetching } = useQuery({
    queryKey: ["fileExplorerRefresh", serverId, workspaceStateKey],
    queryFn: refreshExplorer,
    enabled: false,
  });

  const handleRefresh = useCallback(() => {
    void refetchExplorer();
  }, [refetchExplorer]);

  const sortLabels = useMemo(
    () => ({
      name: t("workspace.fileExplorer.sort.name"),
      modified: t("workspace.fileExplorer.sort.modified"),
      size: t("workspace.fileExplorer.sort.size"),
    }),
    [t],
  );
  const currentSortLabel = resolveCurrentSortLabel(sortOption, sortLabels);

  const treeRows = useMemo(
    () => resolveTreeRows({ directories, expandedPaths, sortOption, showHiddenFiles }),
    [directories, expandedPaths, showHiddenFiles, sortOption],
  );

  const showInitialLoading = resolveShowInitialLoading({
    directories,
    isExplorerLoading,
    pendingRequest,
  });
  const showBackFromError = Boolean(error && selectedEntryPath);
  const errorRecoveryPath = useMemo(() => getErrorRecoveryPath(explorerState), [explorerState]);

  const renderTreeRow = useCallback(
    (info: ListRenderItemInfo<TreeRow>) => (
      <TreeRowDispatcher
        info={info}
        expandedPaths={expandedPaths}
        selectedEntryPath={selectedEntryPath}
        isDirectoryLoading={isDirectoryLoading}
        onEntryPress={handleEntryPress}
        onCopyPath={handleCopyPath}
        onCopyRelativePath={handleCopyRelativePath}
        onDownloadEntry={handleDownloadEntry}
        onEditEntry={handleEditEntry}
        onToggleContextEntry={handleToggleContextEntry}
        onShowHistory={handleShowHistoryEntry}
        onViewChanges={handleViewChangesEntry}
        onShowContextMenu={handleShowContextMenu}
        onRename={handleRenameEntry}
        onDelete={handleDeleteEntry}
        contextFilePaths={contextFilePaths}
        changedPaths={changedPaths}
      />
    ),
    [
      changedPaths,
      contextFilePaths,
      expandedPaths,
      handleEntryPress,
      handleCopyPath,
      handleCopyRelativePath,
      handleDownloadEntry,
      handleEditEntry,
      handleToggleContextEntry,
      handleShowHistoryEntry,
      handleViewChangesEntry,
      handleShowContextMenu,
      handleRenameEntry,
      handleDeleteEntry,
      isDirectoryLoading,
      selectedEntryPath,
    ],
  );

  const handleBackFromError = useCallback(() => {
    if (!hasWorkspaceScope) {
      return;
    }
    selectExplorerEntry(null);
    void requestDirectoryListing(errorRecoveryPath, {
      recordHistory: false,
      setCurrentPath: true,
    });
  }, [errorRecoveryPath, hasWorkspaceScope, requestDirectoryListing, selectExplorerEntry]);

  const handleRetry = useCallback(() => {
    void requestDirectoryListing(".", {
      recordHistory: false,
      setCurrentPath: false,
    });
  }, [requestDirectoryListing]);

  // "Find in files" from the Changes view: consume the reveal request by
  // expanding the target's parent folders (fetching any missing listings),
  // then scroll the row into view once the tree contains it.
  const filesRevealRequest = usePanelStore((state) => state.filesRevealRequest);
  const [pendingRevealPath, setPendingRevealPath] = useState<string | null>(null);
  useEffect(() => {
    setPendingRevealPath(null);
  }, [workspaceStateKey]);
  useEffect(() => {
    if (!filesRevealRequest || !hasWorkspaceScope || !workspaceStateKey) {
      return;
    }
    usePanelStore.getState().clearFilesRevealRequest();
    const revealPath = filesRevealRequest.path;
    if (!usePanelStore.getState().explorerShowHiddenFiles && isHiddenExplorerPath(revealPath)) {
      handleToggleHiddenFiles();
    }
    const parents = collectRevealParentDirectories(revealPath);
    const isDirectoryReveal = filesRevealRequest.kind === "directory";
    if (isDirectoryReveal) {
      parents.push(revealPath);
    }
    const missingExpanded = parents.filter((parent) => !expandedPaths.has(parent));
    if (missingExpanded.length > 0) {
      setExpandedPathsForWorkspace(workspaceStateKey, [
        ...Array.from(expandedPaths),
        ...missingExpanded,
      ]);
    }
    for (const parent of parents) {
      if (!directories.has(parent)) {
        void requestDirectoryListing(parent, { recordHistory: false, setCurrentPath: false });
      }
    }
    if (isDirectoryReveal) {
      setExpandedPathsForWorkspace(workspaceStateKey, [...Array.from(expandedPaths), ...parents]);
    }
    selectExplorerEntry(revealPath);
    setPendingRevealPath(revealPath);
  }, [
    directories,
    expandedPaths,
    filesRevealRequest,
    handleToggleHiddenFiles,
    hasWorkspaceScope,
    requestDirectoryListing,
    selectExplorerEntry,
    setExpandedPathsForWorkspace,
    workspaceStateKey,
  ]);

  const treeRowCountRef = useRef(0);
  treeRowCountRef.current = treeRows.length;
  useEffect(() => {
    if (!pendingRevealPath) {
      return;
    }
    const index = treeRows.findIndex((row) => row.entry.path === pendingRevealPath);
    if (index < 0) {
      return;
    }
    setPendingRevealPath(null);
    treeListRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false });
  }, [pendingRevealPath, treeRows]);

  // Reveal targets are usually outside the rendered window; estimate the
  // offset, let the list render there, then land on the exact row.
  const handleScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      treeListRef.current?.scrollToOffset({
        offset: info.averageItemLength * info.index,
        animated: false,
      });
      setTimeout(() => {
        if (info.index < treeRowCountRef.current) {
          treeListRef.current?.scrollToIndex({
            index: info.index,
            viewPosition: 0.5,
            animated: false,
          });
        }
      }, 100);
    },
    [],
  );

  // The Solution lens. Discovery runs for every workspace whose host can serve it and is the
  // whole cost when the answer is "none" - no solutions means no switcher, no probe, and a Files
  // tab that behaves exactly as it does today.
  const { solutions } = useSolutionsQuery({
    serverId,
    cwd: normalizedWorkspaceRoot,
    enabled: hasWorkspaceScope,
  });
  const explorerViewModeByCheckout = usePanelStore((state) => state.explorerViewModeByCheckout);
  const explorerSolutionByCheckout = usePanelStore((state) => state.explorerSolutionByCheckout);
  const setExplorerViewModeForCheckout = usePanelStore(
    (state) => state.setExplorerViewModeForCheckout,
  );
  const setExplorerSolutionForCheckout = usePanelStore(
    (state) => state.setExplorerSolutionForCheckout,
  );
  const viewMode = resolveExplorerViewMode({
    serverId,
    cwd: normalizedWorkspaceRoot,
    hasSolutions: solutions.length > 0,
    explorerViewModeByCheckout,
  });
  const selectedSolutionPath = useMemo(
    () =>
      resolveSelectedSolutionPath({
        serverId,
        cwd: normalizedWorkspaceRoot,
        solutions,
        explorerSolutionByCheckout,
      }),
    [explorerSolutionByCheckout, normalizedWorkspaceRoot, serverId, solutions],
  );
  const handleSelectViewMode = useCallback(
    (mode: ExplorerViewMode) => {
      setExplorerViewModeForCheckout({ serverId, cwd: normalizedWorkspaceRoot, mode });
    },
    [normalizedWorkspaceRoot, serverId, setExplorerViewModeForCheckout],
  );
  const handleSelectSolution = useCallback(
    (solutionPath: string) => {
      setExplorerSolutionForCheckout({ serverId, cwd: normalizedWorkspaceRoot, solutionPath });
      setExplorerViewModeForCheckout({ serverId, cwd: normalizedWorkspaceRoot, mode: "solution" });
    },
    [
      normalizedWorkspaceRoot,
      serverId,
      setExplorerSolutionForCheckout,
      setExplorerViewModeForCheckout,
    ],
  );
  // Opening a file from the Solution lens goes through the SAME path the Files lens uses. No new
  // tab machinery: the wire carries a workspace-relative path precisely so this can be verbatim.
  const handleOpenSolutionFile = useCallback(
    (path: string) => {
      selectExplorerEntry(path);
      onOpenFile?.(path);
    },
    [onOpenFile, selectExplorerEntry],
  );
  // A render callback rather than an element prop, so the lens is constructed where it is used and
  // nothing builds it on a render that will not show it.
  const renderSolutionPane = useCallback(
    () => (
      <SolutionTreePane
        serverId={serverId}
        cwd={normalizedWorkspaceRoot}
        solutionPath={selectedSolutionPath}
        onOpenFile={handleOpenSolutionFile}
        selectedPath={selectedEntryPath}
      />
    ),
    [
      handleOpenSolutionFile,
      normalizedWorkspaceRoot,
      selectedEntryPath,
      selectedSolutionPath,
      serverId,
    ],
  );

  // The fuzzy finder is `code.list_files`, so it rides the code-index gate -
  // not the project-search one. Today's daemon ships both together; they are
  // separate flags precisely so a future one need not.
  const canIndexCode = useCodeIndexFeature(serverId);
  const [finderOpen, setFinderOpen] = useState(false);
  const openFinder = useCallback(() => setFinderOpen(true), []);
  const closeFinder = useCallback(() => setFinderOpen(false), []);
  // Mod+F outside an editor opens this tab and asks for the finder in one go
  // (see the sidebar.open.files action). The token is consumed here rather than
  // read as a boolean so repeat presses re-open it after a dismiss.
  const finderOpenToken = usePanelStore((state) => state.fileFinderOpenToken);
  const clearFinderOpenRequest = usePanelStore((state) => state.clearFileFinderOpenRequest);
  useEffect(() => {
    if (finderOpenToken === 0) {
      return;
    }
    clearFinderOpenRequest();
    if (canIndexCode) {
      setFinderOpen(true);
    }
  }, [canIndexCode, clearFinderOpenRequest, finderOpenToken]);
  const handleFinderOpenFile = useCallback(
    (path: string) => {
      revealFileInFiles({
        serverId,
        cwd: normalizedWorkspaceRoot,
        path,
        isGit: Boolean(checkoutStatus?.isGit),
      });
      onOpenFile?.(path);
    },
    [checkoutStatus?.isGit, normalizedWorkspaceRoot, onOpenFile, serverId],
  );

  if (!hasWorkspaceScope) {
    return (
      <View style={styles.centerState}>
        <Text style={styles.errorText}>{t("workspace.fileExplorer.states.unavailable")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FileExplorerPaneContent
        error={error}
        showInitialLoading={showInitialLoading}
        showBackFromError={showBackFromError}
        treeRows={treeRows}
        currentSortLabel={currentSortLabel}
        isRefreshFetching={isRefreshFetching}
        showWebScrollbar={showWebScrollbar}
        treeListRef={treeListRef}
        scrollbar={scrollbar}
        renderTreeRow={renderTreeRow}
        handleSortCycle={handleSortCycle}
        handleToggleHiddenFiles={handleToggleHiddenFiles}
        handleRefresh={handleRefresh}
        handleBackFromError={handleBackFromError}
        handleRetry={handleRetry}
        handleScrollToIndexFailed={handleScrollToIndexFailed}
        onOpenFinder={canIndexCode ? openFinder : undefined}
        onNewRootFile={handleNewRootFile}
        onNewRootFolder={handleNewRootFolder}
        sortTriggerStyle={sortTriggerStyle}
        iconButtonStyle={iconButtonStyle}
        solutions={solutions}
        viewMode={viewMode}
        selectedSolutionPath={selectedSolutionPath}
        onSelectViewMode={handleSelectViewMode}
        onSelectSolution={handleSelectSolution}
        renderSolutionPane={renderSolutionPane}
      />
      {canIndexCode ? (
        <FileFinderOverlay
          serverId={serverId}
          workspaceRoot={normalizedWorkspaceRoot}
          visible={finderOpen}
          onClose={closeFinder}
          onOpenFile={handleFinderOpenFile}
        />
      ) : null}
      <EntryContextMenu
        request={contextMenuRequest}
        onOpenChange={handleContextMenuOpenChange}
        onCopyPath={handleCopyPath}
        onCopyRelativePath={handleCopyRelativePath}
        onDownloadEntry={handleDownloadEntry}
        onEditEntry={handleEditEntry}
        onToggleContextEntry={handleToggleContextEntry}
        onShowHistory={handleShowHistoryEntry}
        onViewChanges={handleViewChangesEntry}
        onRename={handleRenameEntry}
        onDelete={handleDeleteEntry}
        isInContext={Boolean(
          contextMenuRequest && contextFilePaths.has(contextMenuRequest.entry.path),
        )}
        isChanged={Boolean(contextMenuRequest && changedPaths.has(contextMenuRequest.entry.path))}
      />
      {nameSheet ? (
        <FileNameSheet
          visible
          onClose={closeNameSheet}
          mode={nameSheet.mode}
          initialValue={nameSheet.initialValue}
          parentLabel={nameSheet.parentPath === "." ? workspaceLabel : nameSheet.parentPath}
          onSubmit={handleNameSheetSubmit}
        />
      ) : null}
    </View>
  );
}

interface FileExplorerPaneContentProps {
  error: string | null;
  showInitialLoading: boolean;
  showBackFromError: boolean;
  treeRows: TreeRow[];
  currentSortLabel: string;
  isRefreshFetching: boolean;
  showWebScrollbar: boolean;
  treeListRef: RefObject<FlatList<TreeRow> | null>;
  scrollbar: ReturnType<typeof useWebScrollViewScrollbar>;
  renderTreeRow: (info: ListRenderItemInfo<TreeRow>) => ReactElement;
  handleSortCycle: () => void;
  handleToggleHiddenFiles: () => void;
  handleRefresh: () => void;
  handleBackFromError: () => void;
  handleRetry: () => void;
  handleScrollToIndexFailed: (info: { index: number; averageItemLength: number }) => void;
  onOpenFinder?: () => void;
  /** Both undefined on a host without `features.fileMutations`. */
  onNewRootFile?: () => void;
  onNewRootFolder?: () => void;
  sortTriggerStyle: (state: PressableStateCallbackType) => StyleProp<ViewStyle>;
  iconButtonStyle: (state: PressableStateCallbackType) => StyleProp<ViewStyle>;
  /** Empty ⇒ no switcher, and this pane is exactly what it was before the feature existed. */
  solutions: readonly SolutionRef[];
  viewMode: ExplorerViewMode;
  selectedSolutionPath: string | null;
  onSelectViewMode: (mode: ExplorerViewMode) => void;
  onSelectSolution: (solutionPath: string) => void;
  /** Rendered in place of the file tree while the Solution lens is active. */
  renderSolutionPane: () => ReactElement;
}

function FileExplorerPaneContent(props: FileExplorerPaneContentProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  // useIconSize (not theme.iconSize props) - the runtime theme patch doesn't
  // reliably reach icon size props here; the hook scales with the breakpoint.
  const iconSize = useIconSize();
  const {
    error,
    showInitialLoading,
    showBackFromError,
    treeRows,
    currentSortLabel,
    isRefreshFetching,
    showWebScrollbar,
    treeListRef,
    scrollbar,
    renderTreeRow,
    handleSortCycle,
    handleToggleHiddenFiles,
    handleRefresh,
    handleBackFromError,
    handleRetry,
    handleScrollToIndexFailed,
    onOpenFinder,
    onNewRootFile,
    onNewRootFolder,
    sortTriggerStyle: sortTriggerStyleProp,
    iconButtonStyle: iconButtonStyleProp,
    solutions,
    viewMode,
    selectedSolutionPath,
    onSelectViewMode,
    onSelectSolution,
    renderSolutionPane,
  } = props;

  const showHiddenFiles = usePanelStore((state) => state.explorerShowHiddenFiles);

  const hiddenFilesToggleAccessibilityLabel = showHiddenFiles
    ? t("workspace.fileExplorer.actions.hideHiddenFiles")
    : t("workspace.fileExplorer.actions.showHiddenFiles");
  const emptyLabel = showHiddenFiles
    ? t("workspace.fileExplorer.empty.noFiles")
    : t("workspace.fileExplorer.empty.noVisibleFiles");
  const hiddenFilesToggleStyle = useCallback(
    (state: PressableStateCallbackType) => [
      iconButtonStyleProp(state),
      !showHiddenFiles && styles.iconButtonActive,
    ],
    [showHiddenFiles, iconButtonStyleProp],
  );
  const hiddenFilesToggleAccessibilityState = useMemo(
    () => ({ selected: !showHiddenFiles }),
    [showHiddenFiles],
  );

  const isSolutionLens = viewMode === "solution";

  // The Files tree's own error and loading states are about the filesystem listing, which the
  // Solution lens does not use - showing them there would report a failure the user is not
  // looking at.
  if (error && !isSolutionLens) {
    return (
      <View style={styles.centerState}>
        <Text style={styles.errorText}>{error}</Text>
        <View style={styles.errorActions}>
          {showBackFromError ? (
            <Pressable style={styles.retryButton} onPress={handleBackFromError}>
              <Text style={styles.retryButtonText}>{t("workspace.fileExplorer.actions.back")}</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.retryButton} onPress={handleRetry}>
            <Text style={styles.retryButtonText}>{t("workspace.fileExplorer.actions.retry")}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (showInitialLoading && !isSolutionLens) {
    return (
      <View style={styles.centerState}>
        <LoadingSpinner size="small" />
        <Text style={styles.loadingText}>{t("workspace.fileExplorer.states.loading")}</Text>
      </View>
    );
  }

  return (
    <View style={TREE_PANE_CONTAINER_STYLE}>
      <View style={styles.paneHeader} testID="files-pane-header">
        <View style={styles.headerLeading}>
          <ExplorerLensSwitcher
            solutions={solutions}
            viewMode={viewMode}
            selectedSolutionPath={selectedSolutionPath}
            onSelectViewMode={onSelectViewMode}
            onSelectSolution={onSelectSolution}
            triggerStyle={sortTriggerStyleProp}
          />
          {/* Sorting is a property of the filesystem listing. The Solution lens is ordered by the
              solution's own folders, which is the point of it, so the control is absent rather
              than present and inert. */}
          {isSolutionLens ? null : (
            <Pressable onPress={handleSortCycle} style={sortTriggerStyleProp}>
              <Text style={styles.sortTriggerText}>{currentSortLabel}</Text>
              <ChevronDown size={iconSize.xs} color={theme.colors.foregroundMuted} />
            </Pressable>
          )}
        </View>
        <View style={styles.headerActions}>
          {/* Root-level create. The Solution lens is a build-system view, where
              "add a file to this folder" has no meaning - membership is the
              project file's business, not the filesystem's. */}
          {!isSolutionLens && onNewRootFile ? (
            <Tooltip delayDuration={300}>
              <TooltipTrigger
                onPress={onNewRootFile}
                hitSlop={8}
                style={iconButtonStyleProp}
                accessibilityRole="button"
                accessibilityLabel={t("workspace.fileExplorer.actions.newFile")}
                testID="file-explorer-new-root-file"
              >
                <FilePlus size={iconSize.sm} color={theme.colors.foregroundMuted} />
              </TooltipTrigger>
              <TooltipContent side="bottom" align="center" offset={8}>
                <Text style={styles.tooltipText}>
                  {t("workspace.fileExplorer.actions.newFile")}
                </Text>
              </TooltipContent>
            </Tooltip>
          ) : null}
          {!isSolutionLens && onNewRootFolder ? (
            <Tooltip delayDuration={300}>
              <TooltipTrigger
                onPress={onNewRootFolder}
                hitSlop={8}
                style={iconButtonStyleProp}
                accessibilityRole="button"
                accessibilityLabel={t("workspace.fileExplorer.actions.newFolder")}
                testID="file-explorer-new-root-folder"
              >
                <FolderPlus size={iconSize.sm} color={theme.colors.foregroundMuted} />
              </TooltipTrigger>
              <TooltipContent side="bottom" align="center" offset={8}>
                <Text style={styles.tooltipText}>
                  {t("workspace.fileExplorer.actions.newFolder")}
                </Text>
              </TooltipContent>
            </Tooltip>
          ) : null}
          {onOpenFinder ? (
            <Tooltip delayDuration={300}>
              <TooltipTrigger
                onPress={onOpenFinder}
                hitSlop={8}
                style={iconButtonStyleProp}
                accessibilityRole="button"
                accessibilityLabel={t("fileFinder.open")}
                testID="file-explorer-open-finder"
              >
                <Search size={iconSize.sm} color={theme.colors.foregroundMuted} />
              </TooltipTrigger>
              <TooltipContent side="bottom" align="center" offset={8}>
                <Text style={styles.tooltipText}>{t("fileFinder.open")}</Text>
              </TooltipContent>
            </Tooltip>
          ) : null}
          {/* Hidden files are a filesystem idea. The Solution lens shows what the build system
              says is in the project, where "hidden" has no meaning at all. */}
          {isSolutionLens ? null : (
            <Tooltip delayDuration={300}>
              <TooltipTrigger
                onPress={handleToggleHiddenFiles}
                hitSlop={8}
                style={hiddenFilesToggleStyle}
                accessibilityRole="button"
                accessibilityLabel={hiddenFilesToggleAccessibilityLabel}
                accessibilityState={hiddenFilesToggleAccessibilityState}
              >
                {showHiddenFiles ? (
                  <Eye size={iconSize.sm} color={theme.colors.foregroundMuted} />
                ) : (
                  <EyeOff size={iconSize.sm} color={theme.colors.foregroundMuted} />
                )}
              </TooltipTrigger>
              <TooltipContent side="bottom" align="center" offset={8}>
                <Text style={styles.tooltipText}>{hiddenFilesToggleAccessibilityLabel}</Text>
              </TooltipContent>
            </Tooltip>
          )}
          <Tooltip delayDuration={300}>
            <TooltipTrigger
              onPress={handleRefresh}
              disabled={isRefreshFetching}
              hitSlop={8}
              style={iconButtonStyleProp}
              accessibilityRole="button"
              accessibilityLabel={
                isRefreshFetching
                  ? t("workspace.fileExplorer.actions.refreshing")
                  : t("workspace.fileExplorer.actions.refresh")
              }
            >
              <View style={styles.refreshIcon}>
                {isRefreshFetching ? (
                  <LoadingSpinner size={iconSize.sm} color={theme.colors.foregroundMuted} />
                ) : (
                  <RotateCw size={iconSize.sm} color={theme.colors.foregroundMuted} />
                )}
              </View>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="center" offset={8}>
              <Text style={styles.tooltipText}>{t("workspace.fileExplorer.actions.refresh")}</Text>
            </TooltipContent>
          </Tooltip>
        </View>
      </View>
      {isSolutionLens ? (
        renderSolutionPane()
      ) : (
        <FileTreeBody
          treeRows={treeRows}
          emptyLabel={emptyLabel}
          treeListRef={treeListRef}
          renderTreeRow={renderTreeRow}
          scrollbar={scrollbar}
          showWebScrollbar={showWebScrollbar}
          handleScrollToIndexFailed={handleScrollToIndexFailed}
        />
      )}
    </View>
  );
}

function deriveExplorerFields(state: AgentFileExplorerState | undefined) {
  return {
    directories:
      state?.directories ?? new Map<string, { path: string; entries: ExplorerEntry[] }>(),
    pendingRequest: state?.pendingRequest ?? null,
    isExplorerLoading: state?.isLoading ?? false,
    error: state?.lastError ?? null,
    selectedEntryPath: state?.selectedEntryPath ?? null,
  };
}

function isPendingListForPath({
  isExplorerLoading,
  pendingRequest,
  path,
}: {
  isExplorerLoading: boolean;
  pendingRequest: AgentFileExplorerState["pendingRequest"] | null;
  path: string;
}): boolean {
  return Boolean(
    isExplorerLoading && pendingRequest?.mode === "list" && pendingRequest?.path === path,
  );
}

function resolveShowInitialLoading({
  directories,
  isExplorerLoading,
  pendingRequest,
}: {
  directories: Map<string, unknown>;
  isExplorerLoading: boolean;
  pendingRequest: AgentFileExplorerState["pendingRequest"] | null;
}): boolean {
  if (directories.has(".")) {
    return false;
  }
  return Boolean(
    isExplorerLoading && pendingRequest?.mode === "list" && pendingRequest?.path === ".",
  );
}

function resolveCurrentSortLabel(
  sortOption: SortOption,
  labels: Record<SortOption, string>,
): string {
  return labels[sortOption] ?? labels.name;
}

function toggleDirectory({
  entry,
  workspaceStateKey,
  expandedPaths,
  directories,
  requestDirectoryListing,
  setExpandedPathsForWorkspace,
}: {
  entry: ExplorerEntry;
  workspaceStateKey: string | null;
  expandedPaths: Set<string>;
  directories: Map<string, { path: string; entries: ExplorerEntry[] }>;
  requestDirectoryListing: (
    path: string,
    opts?: { recordHistory?: boolean; setCurrentPath?: boolean },
  ) => Promise<boolean>;
  setExpandedPathsForWorkspace: (workspaceStateKey: string, paths: string[]) => void;
}): void {
  if (!workspaceStateKey) {
    return;
  }
  const isExpanded = expandedPaths.has(entry.path);
  if (isExpanded) {
    setExpandedPathsForWorkspace(
      workspaceStateKey,
      Array.from(expandedPaths).filter((path) => path !== entry.path),
    );
    return;
  }
  setExpandedPathsForWorkspace(workspaceStateKey, [...Array.from(expandedPaths), entry.path]);
  if (!directories.has(entry.path)) {
    void requestDirectoryListing(entry.path, {
      recordHistory: false,
      setCurrentPath: false,
    });
  }
}

function TreeRowDispatcher({
  info,
  expandedPaths,
  selectedEntryPath,
  isDirectoryLoading,
  onEntryPress,
  onCopyPath,
  onCopyRelativePath,
  onDownloadEntry,
  onEditEntry,
  onToggleContextEntry,
  onShowHistory,
  onViewChanges,
  onShowContextMenu,
  onRename,
  onDelete,
  contextFilePaths,
  changedPaths,
}: {
  info: ListRenderItemInfo<TreeRow>;
  expandedPaths: Set<string>;
  selectedEntryPath: string | null;
  isDirectoryLoading: (path: string) => boolean;
  onEntryPress: (entry: ExplorerEntry) => void;
  onCopyPath: (path: string) => void | Promise<void>;
  onCopyRelativePath: (path: string) => void | Promise<void>;
  onDownloadEntry: (entry: ExplorerEntry) => void;
  onEditEntry?: (entry: ExplorerEntry) => void;
  onToggleContextEntry?: (entry: ExplorerEntry) => void;
  onShowHistory?: (entry: ExplorerEntry) => void;
  onViewChanges?: (entry: ExplorerEntry) => void;
  onShowContextMenu?: (request: EntryContextMenuRequest) => void;
  onRename?: (entry: ExplorerEntry) => void;
  onDelete?: (entry: ExplorerEntry) => void;
  contextFilePaths: ReadonlySet<string>;
  changedPaths: ReadonlySet<string>;
}) {
  const entry = info.item.entry;
  const depth = info.item.depth;
  const isDirectory = entry.kind === "directory";
  const isExpanded = isDirectory && expandedPaths.has(entry.path);
  const isSelected = selectedEntryPath === entry.path;
  const loading = isDirectory && isDirectoryLoading(entry.path);

  return (
    <TreeRowItem
      entry={entry}
      depth={depth}
      ancestorMask={info.item.ancestorMask}
      isExpanded={isExpanded}
      isSelected={isSelected}
      loading={loading}
      onEntryPress={onEntryPress}
      onCopyPath={onCopyPath}
      onCopyRelativePath={onCopyRelativePath}
      onDownloadEntry={onDownloadEntry}
      onEditEntry={onEditEntry}
      onToggleContextEntry={onToggleContextEntry}
      onShowHistory={onShowHistory}
      onViewChanges={onViewChanges}
      onShowContextMenu={onShowContextMenu}
      onRename={onRename}
      onDelete={onDelete}
      isInContext={contextFilePaths.has(entry.path)}
      isChanged={changedPaths.has(entry.path)}
    />
  );
}

async function initializeExplorer({
  hasWorkspaceScope,
  hasInitializedRef,
  requestDirectoryListing,
}: {
  hasWorkspaceScope: boolean;
  hasInitializedRef: RefObject<boolean>;
  requestDirectoryListing: RequestDirectoryListing;
}): Promise<void> {
  if (!hasWorkspaceScope || hasInitializedRef.current) {
    return;
  }
  hasInitializedRef.current = true;
  const succeeded = await requestDirectoryListing(".", {
    recordHistory: false,
    setCurrentPath: false,
  });
  if (!succeeded) {
    hasInitializedRef.current = false;
  }
  // Expansion below the root is restored by the cascade effect in the pane, off
  // the listings as they arrive - nothing is requested from memory alone.
}

async function refreshExplorerDirectories({
  hasWorkspaceScope,
  directories,
  expandedPaths,
  attemptedExpandedPathsRef,
  requestDirectoryListing,
}: {
  hasWorkspaceScope: boolean;
  directories: Map<string, { path: string; entries: ExplorerEntry[] }>;
  expandedPaths: Set<string>;
  attemptedExpandedPathsRef: RefObject<Set<string>>;
  requestDirectoryListing: RequestDirectoryListing;
}): Promise<null> {
  if (!hasWorkspaceScope) {
    return null;
  }
  // Only listings we actually hold are re-fetched. A remembered path with no
  // listing behind it is either not restored yet or gone from disk, and the
  // cascade decides which - refreshing it here is how a deleted folder used to
  // turn the whole pane into an ENOENT banner.
  const showHiddenFiles = usePanelStore.getState().explorerShowHiddenFiles;
  const directoryPaths = Array.from(expandedPaths).filter(
    (path) =>
      path !== "." && directories.has(path) && (showHiddenFiles || !isHiddenExplorerPath(path)),
  );
  // A refresh is the user asking again, so previously failed subtrees get
  // another attempt through the cascade.
  attemptedExpandedPathsRef.current = new Set();
  await Promise.all([
    requestDirectoryListing(".", { recordHistory: false, setCurrentPath: false }),
    ...directoryPaths.map((path) =>
      requestDirectoryListing(path, {
        recordHistory: false,
        setCurrentPath: false,
        surfaceErrors: false,
      }),
    ),
  ]);
  return null;
}

function getErrorRecoveryPath(state: AgentFileExplorerState | undefined): string {
  if (!state) {
    return ".";
  }

  const currentHistoryPath =
    state.history.length > 0 ? state.history[state.history.length - 1] : null;
  const candidate = currentHistoryPath ?? state.lastVisitedPath ?? state.currentPath;

  if (!candidate || candidate.length === 0) {
    return ".";
  }
  return candidate;
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  desktopSplit: {
    flex: 1,
    flexDirection: "row",
    minHeight: 0,
  },
  treePaneWithPreview: {
    flex: 0,
    flexGrow: 0,
    flexShrink: 0,
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
  },
  splitResizeHandle: {
    position: "absolute",
    left: -5,
    top: 0,
    bottom: 0,
    width: 10,
    zIndex: 20,
  },
  previewPane: {
    flex: 1,
    minWidth: 0,
  },
  paneHeader: {
    height: WORKSPACE_SECONDARY_HEADER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  // The lens switcher sits beside the sort cycle, both left-aligned, so the header keeps its
  // corner-pinned space-between at every breakpoint.
  headerLeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 1,
    minWidth: 0,
  },
  sortTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    marginLeft: theme.spacing[3] - theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
    height: {
      xs: 28,
      sm: 28,
      md: 24,
    },
    borderRadius: theme.borderRadius.base,
  },
  sortTriggerHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  sortTriggerText: {
    // Explicit compact bump matching the Changes pane's mode trigger.
    fontSize: {
      xs: theme.fontSize.xs + 2,
      md: theme.fontSize.xs,
    },
    color: theme.colors.foregroundMuted,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[4],
  },
  loadingText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  retryButton: {
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
  },
  retryButtonText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  errorActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  binaryMetaText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  entryRowContainer: {
    position: "relative",
  },
  entryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    // Pin the height the 30px kebab button would give the row, so rows don't
    // shrink (and hover-flicker) when the kebab collapses. 1.5x on compact to
    // wrap the icons' compact upscale.
    minHeight: compactUp(34, 1.5),
    paddingVertical: 2,
    paddingRight: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  entryRowActive: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  entryInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  entryIcon: {
    flexShrink: 0,
  },
  treeLoadingIcon: {
    width: compactUp(16),
    height: compactUp(16),
    alignItems: "center",
    justifyContent: "center",
  },
  directoryName: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    // The disclosure chevron occupies the same 16px column that a child
    // file's icon gains through indentation. Pull the folder glyph back one
    // row gap so both glyphs share that column.
    marginLeft: -theme.spacing[2],
    minWidth: 0,
  },
  entryName: {
    flex: 1,
    color: theme.colors.foreground,
    // Explicit compact bump matching the explorer tab labels.
    fontSize: {
      xs: theme.fontSize.sm + 2,
      md: theme.fontSize.sm,
    },
  },
  directoryEntryName: {
    marginLeft: 2,
  },
  previewHeaderText: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  iconButton: {
    // 1.5x on compact to wrap the header icons' compact upscale.
    width: compactUp(22, 1.5),
    height: compactUp(22, 1.5),
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  iconButtonActive: {
    backgroundColor: theme.colors.surface2,
  },
  refreshIcon: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  previewContent: {
    flex: 1,
  },
  previewScrollContainer: {
    flex: 1,
    minHeight: 0,
    position: "relative",
  },
  previewCodeScrollContent: {
    paddingTop: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[3] + theme.spacing[2],
  },
  codeText: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    flexShrink: 0,
  },
  previewImageScrollContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[3],
  },
  previewImage: {
    width: "100%",
    aspectRatio: 1,
  },
  sheetBackground: {
    backgroundColor: theme.colors.surface2,
  },
  handleIndicator: {
    backgroundColor: theme.colors.palette.zinc[600],
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  sheetTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    flex: 1,
  },
  sheetCloseButton: {
    padding: theme.spacing[2],
  },
  sheetCenterState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[4],
  },
}));
