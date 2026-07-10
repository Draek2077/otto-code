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
  ActivityIndicator,
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
  MoreVertical,
  Paperclip,
  RotateCw,
  Search,
  SquarePen,
} from "@/components/icons/material-icons";
import { getFileIconSvg } from "@/components/material-file-icons";
import { TreeChevron, TreeIndentGuides, TREE_INDENT_PER_LEVEL } from "@/components/tree-primitives";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AgentFileExplorerState, ExplorerEntry } from "@/stores/session-store";
import { useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useTextEditorFeature } from "@/editor/use-text-editor-feature";
import { useProjectSearchFeature } from "@/editor/use-project-search-feature";
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  contextMenuAnchorFromEvent,
} from "@/components/ui/context-menu";
import { useFileExplorerActions } from "@/hooks/use-file-explorer-actions";
import { buildWorkspaceExplorerStateKey } from "@/hooks/use-file-explorer-actions";
import { usePanelStore, type SortOption } from "@/stores/panel-store";
import { formatTimeAgo } from "@/utils/time";
import { buildAbsoluteExplorerPath } from "@/utils/explorer-paths";
import { filterVisibleExplorerEntries, isHiddenExplorerPath } from "@/file-explorer/visibility";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { isWeb } from "@/constants/platform";

const SORT_OPTIONS: { value: SortOption }[] = [
  { value: "name" },
  { value: "modified" },
  { value: "size" },
];

function formatFileSize({ size }: { size: number }): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

interface TreeRowItemProps {
  entry: ExplorerEntry;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
  loading: boolean;
  onEntryPress: (entry: ExplorerEntry) => void;
  onCopyPath: (path: string) => void;
  onDownloadEntry: (entry: ExplorerEntry) => void;
  onEditEntry?: (entry: ExplorerEntry) => void;
  onToggleContextEntry?: (entry: ExplorerEntry) => void;
  onShowContextMenu?: (request: EntryContextMenuRequest) => void;
  isInContext: boolean;
}

/** Right-click target for the pane-level context menu (web only). */
interface EntryContextMenuRequest {
  entry: ExplorerEntry;
  x: number;
  y: number;
}

function stopPressInPropagation(event: { stopPropagation?: () => void }) {
  event.stopPropagation?.();
}

function menuButtonStyle({
  hovered,
  pressed,
  open,
}: PressableStateCallbackType & { hovered?: boolean; open?: boolean }) {
  return [
    styles.menuButton,
    (Boolean(hovered) || pressed || Boolean(open)) && styles.menuButtonActive,
  ];
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

function treeRowKeyExtractor(row: TreeRow) {
  return row.entry.path;
}

function TreeRowItem({
  entry,
  depth,
  isExpanded,
  isSelected,
  loading,
  onEntryPress,
  onCopyPath,
  onDownloadEntry,
  onEditEntry,
  onToggleContextEntry,
  onShowContextMenu,
  isInContext,
}: TreeRowItemProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const isDirectory = entry.kind === "directory";

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
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.entryRow,
      { paddingLeft: theme.spacing[2] + depth * TREE_INDENT_PER_LEVEL },
      (Boolean(hovered) || pressed || isSelected) && styles.entryRowActive,
    ],
    [depth, isSelected, theme.spacing],
  );

  const handleCopy = useCallback(() => {
    onCopyPath(entry.path);
  }, [onCopyPath, entry.path]);

  const handleDownload = useCallback(() => {
    onDownloadEntry(entry);
  }, [onDownloadEntry, entry]);

  const handleEdit = useCallback(() => {
    onEditEntry?.(entry);
  }, [onEditEntry, entry]);

  const handleToggleContext = useCallback(() => {
    onToggleContextEntry?.(entry);
  }, [onToggleContextEntry, entry]);

  const copyLeading = useMemo(
    () => <Copy size={14} color={theme.colors.foregroundMuted} />,
    [theme.colors.foregroundMuted],
  );
  const downloadLeading = useMemo(
    () => <Download size={14} color={theme.colors.foregroundMuted} />,
    [theme.colors.foregroundMuted],
  );
  const editLeading = useMemo(
    () => <SquarePen size={14} color={theme.colors.foregroundMuted} />,
    [theme.colors.foregroundMuted],
  );
  const contextLeading = useMemo(
    () => <Paperclip size={14} color={theme.colors.foregroundMuted} />,
    [theme.colors.foregroundMuted],
  );

  return (
    <Pressable
      onPress={handlePress}
      // @ts-ignore - onContextMenu is web-only and not in RN types.
      onContextMenu={isWeb && onShowContextMenu ? handleContextMenu : undefined}
      style={pressableStyle}
    >
      <TreeIndentGuides depth={depth} />
      <View style={styles.entryInfo}>
        <View style={styles.entryIcon}>
          {(() => {
            if (!isDirectory) {
              return <SvgXml xml={getFileIconSvg(entry.name)} width={16} height={16} />;
            }
            if (loading) return <ActivityIndicator size="small" />;
            return <TreeChevron expanded={isExpanded} />;
          })()}
        </View>
        <Text style={styles.entryName} numberOfLines={1}>
          {entry.name}
        </Text>
      </View>
      <DropdownMenu>
        <DropdownMenuTrigger hitSlop={8} onPressIn={stopPressInPropagation} style={menuButtonStyle}>
          <MoreVertical size={16} color={theme.colors.foregroundMuted} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" width={220}>
          <EntryMetaBlock entry={entry} />
          <DropdownMenuSeparator />
          {onToggleContextEntry ? (
            <DropdownMenuItem
              leading={contextLeading}
              onSelect={handleToggleContext}
              testID={
                isInContext ? "file-explorer-remove-from-context" : "file-explorer-add-to-context"
              }
            >
              {isInContext
                ? t("workspace.fileExplorer.context.removeFromContext")
                : t("workspace.fileExplorer.context.addToContext")}
            </DropdownMenuItem>
          ) : null}
          {entry.kind === "file" && onEditEntry ? (
            <DropdownMenuItem leading={editLeading} onSelect={handleEdit}>
              {t("workspace.fileExplorer.context.edit")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem leading={copyLeading} onSelect={handleCopy}>
            {t("workspace.fileExplorer.context.copyPath")}
          </DropdownMenuItem>
          {entry.kind === "file" ? (
            <DropdownMenuItem leading={downloadLeading} onSelect={handleDownload}>
              {t("workspace.fileExplorer.context.download")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </Pressable>
  );
}

function EntryMetaBlock({ entry }: { entry: ExplorerEntry }) {
  const { t } = useTranslation();
  return (
    <View style={styles.contextMetaBlock}>
      <View style={styles.contextMetaRow}>
        <Text style={styles.contextMetaLabel} numberOfLines={1}>
          {t("workspace.fileExplorer.context.size")}
        </Text>
        <Text style={styles.contextMetaValue} numberOfLines={1} ellipsizeMode="tail">
          {formatFileSize({ size: entry.size })}
        </Text>
      </View>
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
 * Pane-level right-click menu (web only) — one shared instance serving every
 * tree row, mirroring the row's "..." dropdown actions.
 */
function EntryContextMenu({
  request,
  onOpenChange,
  onCopyPath,
  onDownloadEntry,
  onEditEntry,
  onToggleContextEntry,
  isInContext,
}: {
  request: EntryContextMenuRequest | null;
  onOpenChange: (open: boolean) => void;
  onCopyPath: (path: string) => void;
  onDownloadEntry: (entry: ExplorerEntry) => void;
  onEditEntry?: (entry: ExplorerEntry) => void;
  onToggleContextEntry?: (entry: ExplorerEntry) => void;
  isInContext: boolean;
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
  const handleCopy = useCallback(() => {
    if (entry) onCopyPath(entry.path);
  }, [entry, onCopyPath]);
  const handleDownload = useCallback(() => {
    if (entry) onDownloadEntry(entry);
  }, [entry, onDownloadEntry]);

  const contextLeading = useMemo(
    () => <Paperclip size={14} color={theme.colors.foregroundMuted} />,
    [theme.colors.foregroundMuted],
  );
  const editLeading = useMemo(
    () => <SquarePen size={14} color={theme.colors.foregroundMuted} />,
    [theme.colors.foregroundMuted],
  );
  const copyLeading = useMemo(
    () => <Copy size={14} color={theme.colors.foregroundMuted} />,
    [theme.colors.foregroundMuted],
  );
  const downloadLeading = useMemo(
    () => <Download size={14} color={theme.colors.foregroundMuted} />,
    [theme.colors.foregroundMuted],
  );

  return (
    <ContextMenu open={request !== null} onOpenChange={onOpenChange} anchor={request}>
      <ContextMenuContent width={220} testID="file-explorer-context-menu">
        {entry ? (
          <>
            <EntryMetaBlock entry={entry} />
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
            {entry.kind === "file" && onEditEntry ? (
              <ContextMenuItem leading={editLeading} onSelect={handleEdit}>
                {t("workspace.fileExplorer.context.edit")}
              </ContextMenuItem>
            ) : null}
            <ContextMenuItem leading={copyLeading} onSelect={handleCopy}>
              {t("workspace.fileExplorer.context.copyPath")}
            </ContextMenuItem>
            {entry.kind === "file" ? (
              <ContextMenuItem leading={downloadLeading} onSelect={handleDownload}>
                {t("workspace.fileExplorer.context.download")}
              </ContextMenuItem>
            ) : null}
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

interface FileExplorerPaneProps {
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
  onOpenFile?: (filePath: string, options?: { edit?: boolean; lineStart?: number }) => void;
}

interface TreeRow {
  entry: ExplorerEntry;
  depth: number;
}

export function FileExplorerPane({
  serverId,
  workspaceId,
  workspaceRoot,
  onOpenFile,
}: FileExplorerPaneProps) {
  const { t } = useTranslation();
  const isMobile = useIsCompactFormFactor();
  const showDesktopWebScrollbar = isWeb && !isMobile;

  const daemons = useHosts();
  const daemonProfile = useMemo(
    () => daemons.find((daemon) => daemon.serverId === serverId),
    [daemons, serverId],
  );
  const normalizedWorkspaceRoot = useMemo(() => workspaceRoot.trim(), [workspaceRoot]);
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
    enabled: showDesktopWebScrollbar,
  });

  const hasInitializedRef = useRef(false);

  useEffect(() => {
    hasInitializedRef.current = false;
  }, [workspaceStateKey]);

  useEffect(() => {
    void initializeExplorer({
      hasWorkspaceScope,
      hasInitializedRef,
      workspaceStateKey,
      requestDirectoryListing,
    });
  }, [hasWorkspaceScope, requestDirectoryListing, workspaceStateKey]);

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

  // "Add to context" mirrors the diff pane's review comments: the file lands
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

  const handleToggleHiddenFiles = useCallback(() => {
    const willShow = !usePanelStore.getState().explorerShowHiddenFiles;
    toggleExplorerShowHiddenFiles();
    if (willShow) {
      requestPersistedExpandedPaths({ workspaceStateKey, requestDirectoryListing });
    }
  }, [requestDirectoryListing, toggleExplorerShowHiddenFiles, workspaceStateKey]);

  const refreshExplorer = useCallback(
    () =>
      refreshExplorerDirectories({
        hasWorkspaceScope,
        expandedPaths,
        requestDirectoryListing,
      }),
    [expandedPaths, hasWorkspaceScope, requestDirectoryListing],
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
        onDownloadEntry={handleDownloadEntry}
        onEditEntry={handleEditEntry}
        onToggleContextEntry={handleToggleContextEntry}
        onShowContextMenu={handleShowContextMenu}
        contextFilePaths={contextFilePaths}
      />
    ),
    [
      contextFilePaths,
      expandedPaths,
      handleEntryPress,
      handleCopyPath,
      handleDownloadEntry,
      handleEditEntry,
      handleToggleContextEntry,
      handleShowContextMenu,
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

  const canIndexCode = useProjectSearchFeature(serverId);
  const [finderOpen, setFinderOpen] = useState(false);
  const openFinder = useCallback(() => setFinderOpen(true), []);
  const closeFinder = useCallback(() => setFinderOpen(false), []);
  const handleFinderOpenFile = useCallback(
    (path: string) => {
      selectExplorerEntry(path);
      onOpenFile?.(path);
    },
    [onOpenFile, selectExplorerEntry],
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
        showDesktopWebScrollbar={showDesktopWebScrollbar}
        treeListRef={treeListRef}
        scrollbar={scrollbar}
        renderTreeRow={renderTreeRow}
        handleSortCycle={handleSortCycle}
        handleToggleHiddenFiles={handleToggleHiddenFiles}
        handleRefresh={handleRefresh}
        handleBackFromError={handleBackFromError}
        handleRetry={handleRetry}
        onOpenFinder={canIndexCode ? openFinder : undefined}
        sortTriggerStyle={sortTriggerStyle}
        iconButtonStyle={iconButtonStyle}
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
        onDownloadEntry={handleDownloadEntry}
        onEditEntry={handleEditEntry}
        onToggleContextEntry={handleToggleContextEntry}
        isInContext={Boolean(
          contextMenuRequest && contextFilePaths.has(contextMenuRequest.entry.path),
        )}
      />
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
  showDesktopWebScrollbar: boolean;
  treeListRef: RefObject<FlatList<TreeRow> | null>;
  scrollbar: ReturnType<typeof useWebScrollViewScrollbar>;
  renderTreeRow: (info: ListRenderItemInfo<TreeRow>) => ReactElement;
  handleSortCycle: () => void;
  handleToggleHiddenFiles: () => void;
  handleRefresh: () => void;
  handleBackFromError: () => void;
  handleRetry: () => void;
  onOpenFinder?: () => void;
  sortTriggerStyle: (state: PressableStateCallbackType) => StyleProp<ViewStyle>;
  iconButtonStyle: (state: PressableStateCallbackType) => StyleProp<ViewStyle>;
}

function FileExplorerPaneContent(props: FileExplorerPaneContentProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const {
    error,
    showInitialLoading,
    showBackFromError,
    treeRows,
    currentSortLabel,
    isRefreshFetching,
    showDesktopWebScrollbar,
    treeListRef,
    scrollbar,
    renderTreeRow,
    handleSortCycle,
    handleToggleHiddenFiles,
    handleRefresh,
    handleBackFromError,
    handleRetry,
    onOpenFinder,
    sortTriggerStyle: sortTriggerStyleProp,
    iconButtonStyle: iconButtonStyleProp,
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

  if (error) {
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

  if (showInitialLoading) {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator size="small" />
        <Text style={styles.loadingText}>{t("workspace.fileExplorer.states.loading")}</Text>
      </View>
    );
  }

  return (
    <View style={TREE_PANE_CONTAINER_STYLE}>
      <View style={styles.paneHeader} testID="files-pane-header">
        <Pressable onPress={handleSortCycle} style={sortTriggerStyleProp}>
          <Text style={styles.sortTriggerText}>{currentSortLabel}</Text>
          <ChevronDown size={12} color={theme.colors.foregroundMuted} />
        </Pressable>
        <View style={styles.headerActions}>
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
                <Search size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
              </TooltipTrigger>
              <TooltipContent side="bottom" align="center" offset={8}>
                <Text style={styles.tooltipText}>{t("fileFinder.open")}</Text>
              </TooltipContent>
            </Tooltip>
          ) : null}
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
                <Eye size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
              ) : (
                <EyeOff size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
              )}
            </TooltipTrigger>
            <TooltipContent side="bottom" align="center" offset={8}>
              <Text style={styles.tooltipText}>{hiddenFilesToggleAccessibilityLabel}</Text>
            </TooltipContent>
          </Tooltip>
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
                  <LoadingSpinner size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
                ) : (
                  <RotateCw size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
                )}
              </View>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="center" offset={8}>
              <Text style={styles.tooltipText}>{t("workspace.fileExplorer.actions.refresh")}</Text>
            </TooltipContent>
          </Tooltip>
        </View>
      </View>
      {treeRows.length === 0 ? (
        <View style={styles.centerState}>
          <Text style={styles.emptyText}>{emptyLabel}</Text>
        </View>
      ) : (
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
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={!showDesktopWebScrollbar}
          initialNumToRender={24}
          maxToRenderPerBatch={40}
          windowSize={12}
        />
      )}
      {treeRows.length > 0 ? scrollbar.overlay : null}
    </View>
  );
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
}: {
  directories: Map<string, { path: string; entries: ExplorerEntry[] }>;
  expandedPaths: Set<string>;
  sortOption: SortOption;
  showHiddenFiles: boolean;
  path: string;
  depth: number;
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

  for (const entry of entries) {
    rows.push({ entry, depth });
    if (entry.kind === "directory" && expandedPaths.has(entry.path)) {
      rows.push(
        ...buildTreeRows({
          directories,
          expandedPaths,
          sortOption,
          showHiddenFiles,
          path: entry.path,
          depth: depth + 1,
        }),
      );
    }
  }

  return rows;
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

function resolveTreeRows({
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
  });
}

type StartDownloadFn = ReturnType<typeof useDownloadStore.getState>["startDownload"];
type StartDownloadParams = Parameters<StartDownloadFn>[0];

function downloadExplorerEntry({
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
  onDownloadEntry,
  onEditEntry,
  onToggleContextEntry,
  onShowContextMenu,
  contextFilePaths,
}: {
  info: ListRenderItemInfo<TreeRow>;
  expandedPaths: Set<string>;
  selectedEntryPath: string | null;
  isDirectoryLoading: (path: string) => boolean;
  onEntryPress: (entry: ExplorerEntry) => void;
  onCopyPath: (path: string) => void | Promise<void>;
  onDownloadEntry: (entry: ExplorerEntry) => void;
  onEditEntry?: (entry: ExplorerEntry) => void;
  onToggleContextEntry?: (entry: ExplorerEntry) => void;
  onShowContextMenu?: (request: EntryContextMenuRequest) => void;
  contextFilePaths: ReadonlySet<string>;
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
      isExpanded={isExpanded}
      isSelected={isSelected}
      loading={loading}
      onEntryPress={onEntryPress}
      onCopyPath={onCopyPath}
      onDownloadEntry={onDownloadEntry}
      onEditEntry={onEditEntry}
      onToggleContextEntry={onToggleContextEntry}
      onShowContextMenu={onShowContextMenu}
      isInContext={contextFilePaths.has(entry.path)}
    />
  );
}

async function initializeExplorer({
  hasWorkspaceScope,
  hasInitializedRef,
  workspaceStateKey,
  requestDirectoryListing,
}: {
  hasWorkspaceScope: boolean;
  hasInitializedRef: RefObject<boolean>;
  workspaceStateKey: string | null;
  requestDirectoryListing: (
    path: string,
    opts?: { recordHistory?: boolean; setCurrentPath?: boolean },
  ) => Promise<boolean>;
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
    return;
  }
  requestPersistedExpandedPaths({ workspaceStateKey, requestDirectoryListing });
}

function requestPersistedExpandedPaths({
  workspaceStateKey,
  requestDirectoryListing,
}: {
  workspaceStateKey: string | null;
  requestDirectoryListing: (
    path: string,
    opts?: { recordHistory?: boolean; setCurrentPath?: boolean },
  ) => Promise<boolean>;
}): void {
  const showHiddenFiles = usePanelStore.getState().explorerShowHiddenFiles;
  const persistedPaths = usePanelStore.getState().expandedPathsByWorkspace[workspaceStateKey ?? ""];
  if (!persistedPaths) {
    return;
  }
  for (const path of persistedPaths) {
    if (path !== "." && (showHiddenFiles || !isHiddenExplorerPath(path))) {
      void requestDirectoryListing(path, {
        recordHistory: false,
        setCurrentPath: false,
      });
    }
  }
}

async function refreshExplorerDirectories({
  hasWorkspaceScope,
  expandedPaths,
  requestDirectoryListing,
}: {
  hasWorkspaceScope: boolean;
  expandedPaths: Set<string>;
  requestDirectoryListing: (
    path: string,
    opts?: { recordHistory?: boolean; setCurrentPath?: boolean },
  ) => Promise<boolean>;
}): Promise<null> {
  if (!hasWorkspaceScope) {
    return null;
  }
  const showHiddenFiles = usePanelStore.getState().explorerShowHiddenFiles;
  const directoryPaths = Array.from(expandedPaths).filter(
    (path) => showHiddenFiles || !isHiddenExplorerPath(path),
  );
  if (!directoryPaths.includes(".")) {
    directoryPaths.unshift(".");
  }
  await Promise.all(
    directoryPaths.map((path) =>
      requestDirectoryListing(path, {
        recordHistory: false,
        setCurrentPath: false,
      }),
    ),
  );
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
  treePane: {
    minWidth: 0,
    position: "relative",
  },
  treePaneFill: {
    flex: 1,
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
  sortTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    marginLeft: theme.spacing[3] - theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
    height: 24,
    borderRadius: theme.borderRadius.base,
  },
  sortTriggerHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  sortTriggerText: {
    fontSize: theme.fontSize.xs,
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
  treeList: {
    flex: 1,
    minHeight: 0,
  },
  entriesContent: {
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[4],
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
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  binaryMetaText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  entryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
  entryName: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  menuButton: {
    width: 30,
    height: 30,
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
  previewHeaderText: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  iconButton: {
    width: 22,
    height: 22,
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

const TREE_PANE_CONTAINER_STYLE = [styles.treePane, styles.treePaneFill];
