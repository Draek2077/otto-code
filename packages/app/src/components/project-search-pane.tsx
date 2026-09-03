import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import type {
  LayoutChangeEvent,
  ListRenderItemInfo,
  PressableStateCallbackType,
  ViewStyle,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { FileSearchResultPayload } from "@otto-code/client/internal/daemon-client";
import type { FileSearchMatch } from "@otto-code/protocol/messages";
import { getErrorMessage } from "@otto-code/protocol/error-utils";
import {
  ChevronDown,
  ChevronRight,
  Paperclip,
  Play,
  Search,
  X,
} from "@/components/icons/material-icons";
import { MaterialFileIcon } from "@/components/material-file-icon";
import {
  TreeChevron,
  useTreeIconSize,
  WORKSPACE_FILE_ROW_VERTICAL_PADDING,
  WORKSPACE_TREE_ICON_FRAME_SIZE,
  WORKSPACE_TREE_ICON_LABEL_GAP,
} from "@/components/tree-primitives";
import {
  searchCodeLineHeight,
  SearchCodeBlock,
  SearchSelectionBox,
} from "@/components/project-search-code-block";
import {
  buildSearchRowOffsets,
  estimateSearchRowHeight,
} from "@/components/project-search-row-metrics";
import { useProjectSearchNotes } from "@/components/use-project-search-notes";
import { revealFileInFiles } from "@/git/changes-reveal";
import { useTextEditorFeature } from "@/editor/use-text-editor-feature";
import { buildAbsoluteExplorerPath } from "@/utils/explorer-paths";
import * as Clipboard from "expo-clipboard";
import {
  buildSearchDisplayLines,
  type SearchDisplayLine,
} from "@/components/project-search-code-lines";
import { Copy, FolderTree, SquarePen } from "@/components/icons/material-icons";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  contextMenuAnchorFromEvent,
} from "@/components/ui/context-menu";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { useProjectSearchScrollRetention } from "@/components/use-project-search-scroll-retention";
import { useProjectSearchToolbarItems } from "@/components/use-project-search-toolbar-items";
import { PinnableToolbar } from "@/components/ui/pinnable-toolbar";
import { ToolbarIconButton } from "@/components/ui/toolbar-icon-button";
import { useProjectSearchPreferencesStore } from "@/stores/project-search-preferences-store";
import {
  buildProjectSearchScopeKey,
  EMPTY_PROJECT_SEARCH_SESSION,
  useProjectSearchSessionStore,
  type SearchFileResult,
  type SearchPhase,
} from "@/stores/project-search-session-store";
import { useAppSettings } from "@/hooks/use-settings";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";
import { isEditorBufferDirty } from "@/editor/editor-buffer-store";
import { useSessionStore } from "@/stores/session-store";
import { usePanelStore } from "@/stores/panel-store";
import {
  useWorkspaceAttachments,
  useWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import { confirmBulkReplace } from "@/components/project-search-replace-warning";
import { BORDER_WIDTH, compactUp, type Theme } from "@/styles/theme";
import { PANE_TOOLBAR_HEIGHT } from "@/components/ui/control-geometry";

const foregroundMutedIconColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const ThemedSearch = withUnistyles(Search);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedPlay = withUnistyles(Play);
const ThemedPaperclip = withUnistyles(Paperclip);
const ThemedCopy = withUnistyles(Copy);
const ThemedFolderTree = withUnistyles(FolderTree);
const ThemedSquarePen = withUnistyles(SquarePen);
const ThemedX = withUnistyles(X);
const SEARCH_CONTEXT_EDIT_ICON = (
  <ThemedSquarePen size="sm" uniProps={foregroundMutedIconColorMapping} />
);
const SEARCH_CONTEXT_FIND_IN_FILES_ICON = (
  <ThemedFolderTree size="sm" uniProps={foregroundMutedIconColorMapping} />
);
const SEARCH_CONTEXT_COPY_ICON = (
  <ThemedCopy size="sm" uniProps={foregroundMutedIconColorMapping} />
);
const SEARCH_CONTEXT_ATTACH_ICON = (
  <ThemedPaperclip size="sm" uniProps={foregroundMutedIconColorMapping} />
);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedSearchInput = withUnistyles(TextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));

function iconButtonStyle({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.iconButton, (Boolean(hovered) || pressed) && styles.iconButtonActive];
}

interface ResultRow {
  key: string;
  kind: "file" | "matches";
  file: SearchFileResult;
  /** The slice of matched source lines a "matches" row renders. */
  lines?: readonly SearchDisplayLine[];
  /** The file's highest matched line, so every chunk shares one gutter width. */
  maxLineNumber?: number;
  isFirstChunk?: boolean;
  isLastChunk?: boolean;
  /** Index of the chunk's first line within the file, for stable row testIDs. */
  chunkStart?: number;
}

const EMPTY_LINES: readonly SearchDisplayLine[] = [];

/**
 * The browser's own scroll anchoring works against a virtualized list: it reads
 * a row mounting as the content shifting and moves the scroller to compensate,
 * which moves rows in and out of the window, which mounts more rows. The chat
 * transcript turns it off for the same reason (see @/agent-stream/strategy-web).
 */
const WEB_SCROLL_ANCHORING_OFF = (isWeb ? { overflowAnchor: "none" } : null) as ViewStyle | null;

/** Sub-pixel differences between an assumed and a measured row are rounding. */
const ROW_HEIGHT_EPSILON = 0.5;
const EMPTY_ROW_HEIGHTS: ReadonlyMap<string, number> = new Map();

/**
 * How many hits one list row carries.
 *
 * A file's hits are split into rows of this size rather than one row per file,
 * because the list virtualizes per row: a single row holding a 200-hit file
 * mounts all 200 lines the moment any part of it comes near the viewport, and
 * a wide search has several such files in flight at once. Chunking bounds what
 * an approaching row can cost while keeping a file's hits in one well.
 */
const MATCH_ROWS_PER_CHUNK = 16;

/**
 * Display lines, cached against the file object a result event created.
 *
 * Module-level, not a component ref: the pane unmounts whenever the reader
 * leaves the Search tab, and rebuilding (and re-tokenizing) every line on the
 * way back in is exactly the cost the retained session exists to avoid.
 */
interface FileDisplayLines {
  lines: readonly SearchDisplayLine[];
  /** The same lines, pre-sliced into the rows the list renders. */
  chunks: readonly (readonly SearchDisplayLine[])[];
  maxLineNumber: number;
}

const displayLinesCache = new WeakMap<SearchFileResult, FileDisplayLines>();

function getFileDisplayLines(file: SearchFileResult): FileDisplayLines {
  const cached = displayLinesCache.get(file);
  if (cached) {
    return cached;
  }
  const lines = buildSearchDisplayLines(file.matches, (match) => buildMatchKey(file.path, match));
  let maxLineNumber = 0;
  for (const line of lines) {
    maxLineNumber = Math.max(maxLineNumber, line.line);
  }
  // Sliced once and kept: a streaming search rebuilds the row list per batch,
  // and slicing there would hand every chunk a new array, so no already-mounted
  // row could hold its memo.
  const chunks: (readonly SearchDisplayLine[])[] = [];
  for (let start = 0; start < lines.length; start += MATCH_ROWS_PER_CHUNK) {
    chunks.push(lines.slice(start, start + MATCH_ROWS_PER_CHUNK));
  }
  const entry = { lines, chunks, maxLineNumber };
  displayLinesCache.set(file, entry);
  return entry;
}

/** Right-click target for the pane-level "add to context" menu (web only). */
type SearchContextMenuRequest =
  | { kind: "file"; file: SearchFileResult; x: number; y: number }
  | { kind: "match"; file: SearchFileResult; match: FileSearchMatch; x: number; y: number };

function buildMatchKey(path: string, match: FileSearchMatch): string {
  return `${path} ${match.line}:${match.column}`;
}

function SearchToggle({
  label,
  active,
  accessibilityLabel,
  testID,
  onPress,
}: {
  label: string;
  active: boolean;
  accessibilityLabel: string;
  testID: string;
  onPress: () => void;
}) {
  const containerStyle = useMemo(
    () => [styles.searchToggle, active && styles.searchToggleActive],
    [active],
  );
  const textStyle = useMemo(
    () => [styles.searchToggleText, active && styles.searchToggleTextActive],
    [active],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      onPress={onPress}
      style={containerStyle}
    >
      <Text style={textStyle}>{label}</Text>
    </Pressable>
  );
}

export function ProjectSearchPane({
  serverId,
  workspaceId,
  workspaceRoot,
  onOpenFile,
}: {
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
  onOpenFile?: (filePath: string, options?: { edit?: boolean; lineStart?: number }) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const isCompact = useIsCompactFormFactor();
  const showDesktopWebScrollbar = isWeb && !isCompact;
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);

  // "Add to chat" mirrors the file explorer's: the file (or a specific
  // matched line) lands in the workspace-scoped attachment store and shows as
  // a composer pill. Offered only while an agent tab is the focused pane, so
  // the attachment has a visible destination - the menu item is hidden
  // entirely (rather than disabled) when there is none, matching the file
  // explorer convention.
  const focusedAgentId = useSessionStore(
    (state) => state.sessions[serverId]?.focusedAgentId ?? null,
  );
  const attachmentScopeKey = useWorkspaceAttachmentScopeKey({
    serverId,
    workspaceId,
    cwd: workspaceRoot,
  });
  const workspaceAttachments = useWorkspaceAttachments(attachmentScopeKey);
  const contextKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const attachment of workspaceAttachments) {
      if (attachment.kind === "file_context") {
        keys.add(
          attachment.lineStart != null
            ? `${attachment.path}:${attachment.lineStart}`
            : attachment.path,
        );
      }
    }
    return keys;
  }, [workspaceAttachments]);

  const handleToggleFileContext = useMemo(() => {
    if (!focusedAgentId) {
      return undefined;
    }
    return (file: SearchFileResult) => {
      const { attachmentsByScope, setWorkspaceAttachments, addWorkspaceAttachment } =
        useWorkspaceAttachmentsStore.getState();
      const current = attachmentsByScope[attachmentScopeKey] ?? [];
      const remaining = current.filter(
        (attachment) => !(attachment.kind === "file_context" && attachment.id === file.path),
      );
      if (remaining.length !== current.length) {
        setWorkspaceAttachments({ scopeKey: attachmentScopeKey, attachments: remaining });
        return;
      }
      addWorkspaceAttachment({
        scopeKey: attachmentScopeKey,
        attachment: { kind: "file_context", id: file.path, path: file.path },
      });
    };
  }, [attachmentScopeKey, focusedAgentId]);

  const handleToggleLineContext = useMemo(() => {
    if (!focusedAgentId) {
      return undefined;
    }
    return (file: SearchFileResult, match: FileSearchMatch) => {
      const lineId = `${file.path}:${match.line}`;
      const { attachmentsByScope, setWorkspaceAttachments, addWorkspaceAttachment } =
        useWorkspaceAttachmentsStore.getState();
      const current = attachmentsByScope[attachmentScopeKey] ?? [];
      const remaining = current.filter(
        (attachment) => !(attachment.kind === "file_context" && attachment.id === lineId),
      );
      if (remaining.length !== current.length) {
        setWorkspaceAttachments({ scopeKey: attachmentScopeKey, attachments: remaining });
        return;
      }
      addWorkspaceAttachment({
        scopeKey: attachmentScopeKey,
        attachment: { kind: "file_context", id: lineId, path: file.path, lineStart: match.line },
      });
    };
  }, [attachmentScopeKey, focusedAgentId]);

  const [contextMenuRequest, setContextMenuRequest] = useState<SearchContextMenuRequest | null>(
    null,
  );
  const handleShowFileContextMenu = useCallback(
    (input: { file: SearchFileResult; x: number; y: number }) => {
      setContextMenuRequest({ kind: "file", ...input });
    },
    [],
  );
  const handleContextMenuOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setContextMenuRequest(null);
    }
  }, []);

  const queryInputRef = useRef<TextInput | null>(null);
  // The search-sidebar keyboard shortcut wants the query input focused, both
  // when this pane is already visible and when the shortcut just mounted it.
  // The token is consumed back to 0 so later remounts don't steal focus.
  const focusToken = usePanelStore((state) => state.projectSearchFocusToken);
  useEffect(() => {
    if (focusToken === 0) {
      return;
    }
    usePanelStore.getState().clearProjectSearchFocusRequest();
    queryInputRef.current?.focus();
  }, [focusToken]);

  // The session - query, options, results - is held per workspace outside this
  // component, so leaving the Search tab to read a hit does not throw the
  // results away (see @/stores/project-search-session-store).
  const scopeKey = useMemo(
    () => buildProjectSearchScopeKey({ serverId, workspaceId, workspaceRoot }),
    [serverId, workspaceId, workspaceRoot],
  );

  const resultsListRef = useRef<FlatList<ResultRow>>(null);
  const scrollbar = useWebScrollViewScrollbar(resultsListRef, {
    enabled: showDesktopWebScrollbar,
  });

  const resultsScroll = useProjectSearchScrollRetention({
    scopeKey,
    listRef: resultsListRef,
    scrollbar,
  });

  const session = useProjectSearchSessionStore(
    (state) => state.sessions[scopeKey] ?? EMPTY_PROJECT_SEARCH_SESSION,
  );
  const {
    query,
    caseSensitive,
    wholeWord,
    regexp,
    phase,
    results,
    summary,
    collapsedFiles,
    uncheckedMatches,
    replaceOpen,
    replacement,
    replacing,
  } = session;

  const updateSessionForScope = useProjectSearchSessionStore((state) => state.updateSession);
  const updateSession = useCallback(
    (update: Parameters<typeof updateSessionForScope>[1]) =>
      updateSessionForScope(scopeKey, update),
    [scopeKey, updateSessionForScope],
  );
  const setQuery = useCallback((value: string) => updateSession({ query: value }), [updateSession]);
  const setReplacement = useCallback(
    (value: string) => updateSession({ replacement: value }),
    [updateSession],
  );

  const runSearch = useCallback(async () => {
    // Read the live session rather than closing over it: this callback is
    // handed to the stream and re-entered after a replace, and a stale copy of
    // the query or its options would search for the wrong thing.
    const store = useProjectSearchSessionStore.getState();
    const current = store.sessions[scopeKey] ?? EMPTY_PROJECT_SEARCH_SESSION;
    const trimmed = current.query.trim();
    if (!client || !trimmed) {
      return;
    }
    const token = store.beginRun(scopeKey);
    try {
      const outcome = await client.searchFiles({
        cwd: workspaceRoot,
        query: trimmed,
        caseSensitive: current.caseSensitive,
        wholeWord: current.wholeWord,
        regexp: current.regexp,
        onFileResult: (result: FileSearchResultPayload) => {
          store.appendResult(scopeKey, token, {
            path: result.path,
            hash: result.hash,
            matches: result.matches,
          });
        },
      });
      if (outcome.status === "superseded") {
        return;
      }
      if (!store.isCurrentRun(scopeKey, token)) {
        return;
      }
      if (outcome.status === "error") {
        store.finishRun(scopeKey, token, { failed: true });
        toast.error(outcome.error ?? t("projectSearch.error"));
        return;
      }
      store.finishRun(scopeKey, token, { summary: outcome });
    } catch (error) {
      if (!store.isCurrentRun(scopeKey, token)) {
        return;
      }
      store.finishRun(scopeKey, token, { failed: true });
      toast.error(getErrorMessage(error));
    }
  }, [client, scopeKey, t, toast, workspaceRoot]);

  const handleSubmit = useCallback(() => {
    void runSearch();
  }, [runSearch]);

  const toggleFileCollapsed = useCallback(
    (path: string) => {
      updateSession((current) => {
        const next = new Set(current.collapsedFiles);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return { collapsedFiles: next };
      });
    },
    [updateSession],
  );

  const toggleFileChecked = useCallback(
    (file: SearchFileResult) => {
      updateSession((current) => {
        const keys = file.matches.map((match) => buildMatchKey(file.path, match));
        const anyChecked = keys.some((key) => !current.uncheckedMatches.has(key));
        const next = new Set(current.uncheckedMatches);
        for (const key of keys) {
          if (anyChecked) {
            next.add(key);
          } else {
            next.delete(key);
          }
        }
        return { uncheckedMatches: next };
      });
    },
    [updateSession],
  );

  // Only computed while the replace band is open: it walks every match in the
  // result set, and a streaming search would otherwise re-walk all of them on
  // every batch for a number nothing is rendering.
  const selection = useMemo(() => {
    let matches = 0;
    const files: Array<{ file: SearchFileResult; matches: FileSearchMatch[] }> = [];
    if (!replaceOpen) {
      return { files, matches };
    }
    for (const file of results) {
      const picked = file.matches.filter(
        (match) => !uncheckedMatches.has(buildMatchKey(file.path, match)),
      );
      if (picked.length > 0) {
        files.push({ file, matches: picked });
        matches += picked.length;
      }
    }
    return { files, matches };
  }, [replaceOpen, results, uncheckedMatches]);

  const runReplace = useCallback(async () => {
    if (!client || replacing || selection.files.length === 0) {
      return;
    }
    const dirtyPaths = new Set(
      selection.files
        .filter((entry) =>
          workspaceId
            ? isEditorBufferDirty({ serverId, workspaceId, path: entry.file.path })
            : false,
        )
        .map((entry) => entry.file.path),
    );
    const cleanFiles = selection.files.filter((entry) => !dirtyPaths.has(entry.file.path));
    if (cleanFiles.length === 0) {
      toast.error(t("projectSearch.dirtySkipped"));
      return;
    }
    const matchTotal = cleanFiles.reduce((total, entry) => total + entry.matches.length, 0);
    const confirmed = await confirmBulkReplace({ matches: matchTotal, files: cleanFiles.length });
    if (!confirmed) {
      return;
    }
    updateSession({ replacing: true });
    try {
      const payload = await client.replaceFiles({
        cwd: workspaceRoot,
        replacement,
        files: cleanFiles.map((entry) => ({
          path: entry.file.path,
          expectedHash: entry.file.hash,
          matches: entry.matches.map((match) => ({
            line: match.line,
            column: match.column,
            length: match.length,
          })),
        })),
      });
      if (payload.error) {
        toast.error(payload.error);
        return;
      }
      const okCount = payload.results.filter((result) => result.status === "ok").length;
      const issueCount = payload.results.length - okCount + dirtyPaths.size;
      toast.show(
        issueCount > 0
          ? `${t("projectSearch.replaceDone", { files: okCount })} · ${t("projectSearch.replaceIssues", { count: issueCount })}`
          : t("projectSearch.replaceDone", { files: okCount }),
      );
      // Refresh the results against the rewritten files.
      await runSearch();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      updateSession({ replacing: false });
    }
  }, [
    client,
    replacement,
    replacing,
    runSearch,
    selection,
    serverId,
    t,
    toast,
    updateSession,
    workspaceId,
    workspaceRoot,
  ]);

  const handleReplacePress = useCallback(() => {
    void runReplace();
  }, [runReplace]);

  const replaceDisabled = replacing || selection.matches === 0 || phase !== "done";
  const replaceGoStyle = useCallback(
    (state: PressableStateCallbackType & { hovered?: boolean }) => [
      ...iconButtonStyle(state),
      replaceDisabled && styles.iconButtonDisabled,
    ],
    [replaceDisabled],
  );

  const toggleReplaceOpen = useCallback(
    () => updateSession((current) => ({ replaceOpen: !current.replaceOpen })),
    [updateSession],
  );

  const handleToggleCase = useCallback(
    () => updateSession((current) => ({ caseSensitive: !current.caseSensitive })),
    [updateSession],
  );
  const handleToggleWord = useCallback(
    () => updateSession((current) => ({ wholeWord: !current.wholeWord })),
    [updateSession],
  );
  const handleToggleRegexp = useCallback(
    () => updateSession((current) => ({ regexp: !current.regexp })),
    [updateSession],
  );

  // The replace row trails a spacer matching the toggle group so both inputs
  // end at the same edge (the two icon buttons already match widths).
  const [togglesWidth, setTogglesWidth] = useState(0);
  const handleTogglesLayout = useCallback((event: LayoutChangeEvent) => {
    setTogglesWidth(event.nativeEvent.layout.width);
  }, []);
  const togglesSpacerStyle = useMemo(() => ({ width: togglesWidth }), [togglesWidth]);

  const rows = useMemo<ResultRow[]>(() => {
    const next: ResultRow[] = [];
    for (const file of results) {
      next.push({ key: `file:${file.path}`, kind: "file", file });
      if (collapsedFiles.has(file.path) || file.matches.length === 0) {
        continue;
      }
      const { chunks, maxLineNumber } = getFileDisplayLines(file);
      chunks.forEach((chunk, chunkIndex) => {
        next.push({
          key: `matches:${file.path}:${chunkIndex}`,
          kind: "matches",
          file,
          lines: chunk,
          maxLineNumber,
          isFirstChunk: chunkIndex === 0,
          isLastChunk: chunkIndex === chunks.length - 1,
          chunkStart: chunkIndex * MATCH_ROWS_PER_CHUNK,
        });
      });
    }
    return next;
  }, [collapsedFiles, results]);

  // Inline notes on hits, on the review surface Changes writes to. Sourced from
  // the results rather than from `rows`, which also churns when a file is
  // collapsed - and re-deriving this is proportional to the whole result set.
  const noteSources = useMemo(
    () =>
      results.map((file) => ({
        filePath: file.path,
        lines: getFileDisplayLines(file).lines,
      })),
    [results],
  );
  const reviewActions = useProjectSearchNotes({
    serverId,
    workspaceId,
    workspaceRoot,
    attachmentScopeKey,
    sources: noteSources,
  });

  const stickyHeaderIndices = useMemo(
    () =>
      rows.reduce<number[]>((indices, row, index) => {
        if (row.kind === "file") {
          indices.push(index);
        }
        return indices;
      }, []),
    [rows],
  );

  // A code line stands for every match on it, so its checkbox covers them all.
  // Two hits on one line cannot be selected apart - the row is the line.
  const isLineChecked = useCallback(
    (_filePath: string, line: SearchDisplayLine) =>
      line.matchKeys.some((key) => !uncheckedMatches.has(key)),
    [uncheckedMatches],
  );
  const toggleLineChecked = useCallback(
    (_filePath: string, line: SearchDisplayLine) => {
      updateSession((current) => {
        const anyChecked = line.matchKeys.some((key) => !current.uncheckedMatches.has(key));
        const next = new Set(current.uncheckedMatches);
        for (const key of line.matchKeys) {
          if (anyChecked) {
            next.add(key);
          } else {
            next.delete(key);
          }
        }
        return { uncheckedMatches: next };
      });
    },
    [updateSession],
  );
  const handleOpenLine = useCallback(
    (filePath: string, line: SearchDisplayLine) => {
      onOpenFile?.(filePath, { lineStart: line.line });
    },
    [onOpenFile],
  );
  const handleLineContextMenu = useCallback(
    (filePath: string, line: SearchDisplayLine, event: unknown) => {
      const anchor = contextMenuAnchorFromEvent(event);
      if (!anchor) {
        return;
      }
      const file = results.find((entry) => entry.path === filePath);
      const match = file?.matches.find((entry) => entry.line === line.line);
      if (!file || !match) {
        return;
      }
      setContextMenuRequest({ kind: "match", file, match, x: anchor.x, y: anchor.y });
    },
    [results],
  );

  const showReplaceControls = !isCompact;

  // Line wrapping and toolbar pins are device-local preferences, held the way
  // the other persisted pane preferences are.
  const wrapLines = useProjectSearchPreferencesStore((state) => state.wrapLines);
  const pinnedToolbarItems = useProjectSearchPreferencesStore((state) => state.pinnedToolbarItems);
  const handleToggleWrapLines = useProjectSearchPreferencesStore((state) => state.toggleWrapLines);
  const handleToggleToolbarPin = useProjectSearchPreferencesStore(
    (state) => state.toggleToolbarPin,
  );
  const { settings: appSettings } = useAppSettings();
  const isSearching = phase === "searching";

  // Hover reveal for the pinned strip, tracked on the plain toolbar row below
  // (see docs/hover.md). Always visible on native and compact.
  const [toolbarHovered, setToolbarHovered] = useState(false);
  const handleToolbarPointerEnter = useCallback(() => setToolbarHovered(true), []);
  const handleToolbarPointerLeave = useCallback(() => setToolbarHovered(false), []);

  const clearSessionForScope = useProjectSearchSessionStore((state) => state.clearSession);
  const handleClear = useCallback(() => {
    clearSessionForScope(scopeKey);
    queryInputRef.current?.focus();
  }, [clearSessionForScope, scopeKey]);
  // Nothing to clear once the query is empty and no results are left standing.
  const clearDisabled = query.length === 0 && results.length === 0 && summary === null;

  // "Expanded" is the absence of collapsed files, so a fresh search starts
  // expanded and the button offers Collapse all.
  const allFilesExpanded = collapsedFiles.size === 0;
  const handleToggleExpandAll = useCallback(() => {
    updateSession((current) => ({
      collapsedFiles:
        current.collapsedFiles.size === 0
          ? new Set(current.results.map((file) => file.path))
          : new Set<string>(),
    }));
  }, [updateSession]);

  const toolbarItems = useProjectSearchToolbarItems({
    wrapLines,
    hasResults: results.length > 0,
    allFilesExpanded,
    isSearching,
    canRefresh: query.trim().length > 0,
    onToggleWrapLines: handleToggleWrapLines,
    onToggleExpandAll: handleToggleExpandAll,
    onRefresh: handleSubmit,
  });

  // ── Row geometry ─────────────────────────────────────────────────────────
  // The list is told where every row sits rather than left to average its way
  // there (see @/components/project-search-row-metrics for why). Heights are
  // computed from the row's own lines, and a row that lands somewhere else -
  // a wrapped line, an open review thread - reports what it measured.
  const codeLineHeight = searchCodeLineHeight(appSettings.codeFontSize);
  const paneTreeIconSize = useTreeIconSize();
  const [measuredFileRowHeight, setMeasuredFileRowHeight] = useState(0);
  const [measuredRowHeights, setMeasuredRowHeights] =
    useState<ReadonlyMap<string, number>>(EMPTY_ROW_HEIGHTS);

  // A row's height depends on the code metrics, on wrapping, and on whether the
  // replace band's checkboxes are in the line. Change any of them and every
  // measurement taken under the old geometry is worth nothing.
  const rowGeometryKey = `${codeLineHeight}:${wrapLines ? "wrap" : "clip"}:${
    showReplaceControls && replaceOpen ? "select" : "plain"
  }`;
  useEffect(() => {
    setMeasuredRowHeights(EMPTY_ROW_HEIGHTS);
  }, [rowGeometryKey]);
  // A new run reuses these keys for other files, so what the last run measured
  // says nothing about this one.
  useEffect(() => {
    if (phase === "searching") {
      setMeasuredRowHeights(EMPTY_ROW_HEIGHTS);
    }
  }, [phase]);

  const rowGeometry = useMemo(
    () => ({
      fileRowHeight:
        measuredFileRowHeight || paneTreeIconSize + 2 * WORKSPACE_FILE_ROW_VERTICAL_PADDING,
      codeLineHeight,
      chunkBorderWidth: BORDER_WIDTH[1],
    }),
    [codeLineHeight, measuredFileRowHeight, paneTreeIconSize],
  );
  const rowHeights = useMemo(
    () =>
      rows.map(
        (row) => measuredRowHeights.get(row.key) ?? estimateSearchRowHeight(row, rowGeometry),
      ),
    [measuredRowHeights, rowGeometry, rows],
  );
  const rowOffsets = useMemo(() => buildSearchRowOffsets(rowHeights), [rowHeights]);
  const getItemLayout = useCallback(
    (_data: ArrayLike<ResultRow> | null | undefined, index: number) => ({
      length: rowHeights[index] ?? 0,
      offset: rowOffsets[index] ?? rowOffsets[rowOffsets.length - 1] ?? 0,
      index,
    }),
    [rowHeights, rowOffsets],
  );
  const handleFileRowHeight = useCallback((height: number) => {
    setMeasuredFileRowHeight((current) =>
      Math.abs(current - height) <= ROW_HEIGHT_EPSILON ? current : height,
    );
  }, []);
  const handleMatchRowHeight = useCallback((rowKey: string, height: number) => {
    setMeasuredRowHeights((current) => {
      const previous = current.get(rowKey);
      if (previous !== undefined && Math.abs(previous - height) <= ROW_HEIGHT_EPSILON) {
        return current;
      }
      // Copied rather than mutated so the memo above re-runs. Only the rows
      // that defeat the estimate land here, so the map stays small on the
      // ordinary result set and the copy stays cheap.
      const next = new Map(current);
      next.set(rowKey, height);
      return next;
    });
  }, []);

  const renderRow = useCallback(
    (info: ListRenderItemInfo<ResultRow>) => {
      const row = info.item;
      if (row.kind === "file") {
        return (
          <FileRow
            file={row.file}
            collapsed={collapsedFiles.has(row.file.path)}
            showSelection={showReplaceControls && replaceOpen}
            uncheckedMatches={uncheckedMatches}
            expectedHeight={rowGeometry.fileRowHeight}
            onHeightChange={handleFileRowHeight}
            onToggleCollapsed={toggleFileCollapsed}
            onToggleChecked={toggleFileChecked}
            onShowContextMenu={handleShowFileContextMenu}
          />
        );
      }
      return (
        <SearchCodeBlock
          filePath={row.file.path}
          lines={row.lines ?? EMPTY_LINES}
          maxLineNumber={row.maxLineNumber ?? 0}
          isFirstChunk={row.isFirstChunk ?? true}
          isLastChunk={row.isLastChunk ?? true}
          showSelection={showReplaceControls && replaceOpen}
          wrapLines={wrapLines}
          isLineChecked={isLineChecked}
          toggleLabel={t("projectSearch.toggleMatch")}
          onToggleLine={toggleLineChecked}
          onPressLine={handleOpenLine}
          onLineContextMenu={handleLineContextMenu}
          reviewActions={reviewActions}
          testIDPrefix={`project-search-match-${row.file.path}`}
          lineOffset={row.chunkStart ?? 0}
          rowKey={row.key}
          expectedHeight={rowHeights[info.index] ?? 0}
          onHeightChange={handleMatchRowHeight}
        />
      );
    },
    [
      collapsedFiles,
      handleFileRowHeight,
      handleLineContextMenu,
      handleMatchRowHeight,
      handleOpenLine,
      handleShowFileContextMenu,
      isLineChecked,
      reviewActions,
      replaceOpen,
      rowGeometry,
      rowHeights,
      showReplaceControls,
      t,
      toggleFileChecked,
      toggleFileCollapsed,
      toggleLineChecked,
      uncheckedMatches,
      wrapLines,
    ],
  );

  const keyExtractor = useCallback((row: ResultRow) => row.key, []);

  const resultsListStyle = useMemo(() => [styles.resultsList, WEB_SCROLL_ANCHORING_OFF], []);

  const searchHeaderStyle = useMemo(
    () => [
      styles.searchHeader,
      showReplaceControls && replaceOpen && styles.searchHeaderReplaceOpen,
    ],
    [replaceOpen, showReplaceControls],
  );

  return (
    <View style={styles.container} testID="project-search-pane">
      <View style={searchHeaderStyle}>
        <View style={styles.queryRow}>
          {showReplaceControls ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("projectSearch.openReplace")}
              testID="project-search-replace-expand"
              onPress={toggleReplaceOpen}
              style={iconButtonStyle}
            >
              {replaceOpen ? (
                <ThemedChevronDown size="sm" uniProps={foregroundMutedIconColorMapping} />
              ) : (
                <ThemedChevronRight size="sm" uniProps={foregroundMutedIconColorMapping} />
              )}
            </Pressable>
          ) : null}
          <ThemedSearchInput
            ref={queryInputRef}
            style={styles.queryInput}
            value={query}
            onChangeText={setQuery}
            placeholder={t("projectSearch.placeholder")}
            autoCapitalize="none"
            autoCorrect={false}
            blurOnSubmit={false}
            onSubmitEditing={handleSubmit}
            testID="project-search-input"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("projectSearch.placeholder")}
            testID="project-search-submit"
            onPress={handleSubmit}
            style={iconButtonStyle}
          >
            <ThemedSearch size="md" uniProps={foregroundMutedIconColorMapping} />
          </Pressable>
          <View style={styles.searchToggles} onLayout={handleTogglesLayout}>
            <SearchToggle
              label="Cc"
              active={caseSensitive}
              accessibilityLabel={t("projectSearch.matchCase")}
              testID="project-search-case"
              onPress={handleToggleCase}
            />
            <SearchToggle
              label="W"
              active={wholeWord}
              accessibilityLabel={t("projectSearch.wholeWord")}
              testID="project-search-word"
              onPress={handleToggleWord}
            />
            <SearchToggle
              label=".*"
              active={regexp}
              accessibilityLabel={t("projectSearch.regexp")}
              testID="project-search-regex"
              onPress={handleToggleRegexp}
            />
          </View>
        </View>

        {showReplaceControls && replaceOpen ? (
          <View style={styles.replaceRow}>
            <View style={styles.replaceIndent} />
            <ThemedSearchInput
              style={styles.queryInput}
              value={replacement}
              onChangeText={setReplacement}
              placeholder={t("projectSearch.replacePlaceholder")}
              autoCapitalize="none"
              autoCorrect={false}
              testID="project-search-replace-input"
            />
            <Tooltip delayDuration={300}>
              <TooltipTrigger
                accessibilityRole="button"
                accessibilityLabel={t("projectSearch.replaceSelected")}
                testID="project-search-replace-selected"
                onPress={handleReplacePress}
                disabled={replaceDisabled}
                style={replaceGoStyle}
              >
                <View style={styles.goIconSlot}>
                  {replacing ? (
                    <ThemedLoadingSpinner uniProps={foregroundMutedIconColorMapping} />
                  ) : (
                    <ThemedPlay size="md" uniProps={foregroundMutedIconColorMapping} />
                  )}
                </View>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="center" offset={8}>
                <Text style={styles.tooltipText}>{t("projectSearch.replaceSelected")}</Text>
              </TooltipContent>
            </Tooltip>
            <View style={togglesSpacerStyle} />
          </View>
        ) : null}
      </View>

      <View
        style={styles.toolbarRow}
        onPointerEnter={handleToolbarPointerEnter}
        onPointerLeave={handleToolbarPointerLeave}
        testID="project-search-toolbar"
      >
        {/* The toolbar's one left-hand action, where Changes keeps its diff-mode
            picker: clearing the query and the results it produced. */}
        <ToolbarIconButton
          label={t("projectSearch.clear")}
          Icon={ThemedX}
          onPress={handleClear}
          disabled={clearDisabled}
          testID="project-search-clear"
        />
        <PinnableToolbar
          items={toolbarItems}
          pinnedItems={pinnedToolbarItems}
          onTogglePin={handleToggleToolbarPin}
          hovered={toolbarHovered}
          isMobile={isCompact}
          hideUntilHover={false}
          optionsLabel={t("projectSearch.options")}
          testIDPrefix="project-search"
        />
      </View>

      <View style={styles.resultsArea}>
        <SearchPlaceholder phase={phase} hasResults={results.length > 0} />
        <FlatList
          ref={resultsListRef}
          data={rows}
          renderItem={renderRow}
          keyExtractor={keyExtractor}
          style={resultsListStyle}
          contentContainerStyle={styles.resultsListContent}
          stickyHeaderIndices={stickyHeaderIndices}
          // Exact row geometry, so the rows the window drops are replaced by
          // spacers of the right size instead of by an average that is re-taken
          // on every batch - which is what threw the list around mid-scroll.
          getItemLayout={getItemLayout}
          // A wide search runs to thousands of hits, so the window is held
          // close: the defaults keep ten viewports of rows either side mounted,
          // which for code rows is tens of thousands of nodes.
          initialNumToRender={12}
          maxToRenderPerBatch={8}
          updateCellsBatchingPeriod={50}
          windowSize={5}
          onLayout={resultsScroll.onLayout}
          onScroll={resultsScroll.onScroll}
          onContentSizeChange={resultsScroll.onContentSizeChange}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={!showDesktopWebScrollbar}
          testID="project-search-results"
        />
        {rows.length > 0 ? scrollbar.overlay : null}
      </View>

      {summary ? (
        <View style={styles.searchDetails} testID="project-search-details">
          <Text style={styles.summaryText} testID="project-search-summary">
            {t("projectSearch.summary", {
              matches: summary.matchCount,
              files: summary.fileCount,
            })}
          </Text>
          {summary.status === "truncated" ? (
            <Text style={styles.truncatedText}>{t("projectSearch.truncated")}</Text>
          ) : null}
        </View>
      ) : null}
      <SearchEntryContextMenu
        request={contextMenuRequest}
        serverId={serverId}
        workspaceRoot={workspaceRoot}
        onOpenChange={handleContextMenuOpenChange}
        onOpenFile={onOpenFile}
        isInContext={
          contextMenuRequest
            ? contextKeys.has(
                contextMenuRequest.kind === "match"
                  ? `${contextMenuRequest.file.path}:${contextMenuRequest.match.line}`
                  : contextMenuRequest.file.path,
              )
            : false
        }
        onToggleFileContext={handleToggleFileContext}
        onToggleLineContext={handleToggleLineContext}
      />
    </View>
  );
}

/**
 * What the results area shows before there is anything to show: the running
 * search, an empty result, or the standing hint. An errored run says nothing -
 * the failure arrives as a toast, and a second copy of it here would outlive
 * the toast with no way to dismiss it.
 */
function SearchPlaceholder({ phase, hasResults }: { phase: SearchPhase; hasResults: boolean }) {
  const { t } = useTranslation();
  if (hasResults) {
    return null;
  }
  if (phase === "searching") {
    return (
      <View style={styles.centerState}>
        <ThemedLoadingSpinner uniProps={foregroundMutedIconColorMapping} />
        <Text style={styles.mutedText}>{t("projectSearch.searching")}</Text>
      </View>
    );
  }
  if (phase === "done") {
    return (
      <View style={styles.centerState}>
        <Text style={styles.mutedText}>{t("projectSearch.noResults")}</Text>
      </View>
    );
  }
  if (phase === "idle") {
    return (
      <View style={styles.centerState}>
        <Text style={styles.mutedText}>{t("projectSearch.idleHint")}</Text>
      </View>
    );
  }
  return null;
}

function FileRow({
  file,
  collapsed,
  showSelection,
  uncheckedMatches,
  expectedHeight,
  onHeightChange,
  onToggleCollapsed,
  onToggleChecked,
  onShowContextMenu,
}: {
  file: SearchFileResult;
  collapsed: boolean;
  showSelection: boolean;
  uncheckedMatches: ReadonlySet<string>;
  /**
   * The height the list has file rows down as. Every file row is the same row,
   * so the first one to disagree corrects the list for all of them.
   */
  expectedHeight: number;
  onHeightChange: (height: number) => void;
  onToggleCollapsed: (path: string) => void;
  onToggleChecked: (file: SearchFileResult) => void;
  onShowContextMenu?: (input: { file: SearchFileResult; x: number; y: number }) => void;
}) {
  const { t } = useTranslation();
  const treeIconSize = useTreeIconSize();
  const handleToggleCollapsed = useCallback(
    () => onToggleCollapsed(file.path),
    [file.path, onToggleCollapsed],
  );
  const handleToggleChecked = useCallback(() => onToggleChecked(file), [file, onToggleChecked]);
  const anyChecked = useMemo(
    () => file.matches.some((match) => !uncheckedMatches.has(buildMatchKey(file.path, match))),
    [file, uncheckedMatches],
  );
  const handleContextMenu = useCallback(
    (event: unknown) => {
      if (!onShowContextMenu) {
        return;
      }
      const anchor = contextMenuAnchorFromEvent(event);
      if (!anchor) {
        return;
      }
      onShowContextMenu({ file, x: anchor.x, y: anchor.y });
    },
    [file, onShowContextMenu],
  );
  const rowStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.fileRow,
      collapsed ? null : styles.fileRowExpanded,
      (Boolean(hovered) || pressed) && styles.fileRowActive,
    ],
    [collapsed],
  );
  const accessibilityState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = event.nativeEvent.layout.height;
      if (!Number.isFinite(height) || height <= 0) {
        return;
      }
      if (Math.abs(height - expectedHeight) <= ROW_HEIGHT_EPSILON) {
        return;
      }
      onHeightChange(height);
    },
    [expectedHeight, onHeightChange],
  );
  const fileName = file.path.split("/").pop() ?? file.path;
  // The whole path, not just the name: two hits in two `index.ts` files have to
  // be tellable apart. The directory leads and gives way first, ellipsized from
  // the head, so the file name is the one part that never gets squeezed out.
  const directory = file.path.includes("/")
    ? `${file.path.slice(0, file.path.lastIndexOf("/"))}/`
    : "";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      onPress={handleToggleCollapsed}
      // @ts-ignore - onContextMenu is web-only and not in RN types.
      onContextMenu={isWeb && onShowContextMenu ? handleContextMenu : undefined}
      onLayout={handleLayout}
      style={rowStyle}
      testID={`project-search-file-${file.path}`}
    >
      {showSelection ? (
        <SearchSelectionBox
          checked={anyChecked}
          accessibilityLabel={t("projectSearch.toggleFile")}
          testID={`project-search-file-check-${file.path}`}
          onPress={handleToggleChecked}
        />
      ) : null}
      {/* Disclosure state, drawn with the Files tree's own chevron so a
          collapsed result file reads like a collapsed folder. */}
      <TreeChevron expanded={!collapsed} />
      <View style={styles.fileIcon}>
        <MaterialFileIcon fileName={fileName} size={treeIconSize} />
      </View>
      {directory ? (
        <Text style={styles.fileDir} numberOfLines={1} ellipsizeMode="head">
          {directory}
        </Text>
      ) : null}
      <Text style={styles.fileName} numberOfLines={1}>
        {fileName}
      </Text>
      <View style={styles.fileSpacer} />
      <Text style={styles.fileCount}>{file.matches.length}</Text>
    </Pressable>
  );
}

/**
 * The pane-level right-click menu (web only) - one shared instance serving every
 * file row and code line, with the same actions and section order the Changes
 * menu uses. A line target keeps its line: Edit file opens at it, and the chat
 * action attaches that line rather than the whole file.
 */
function SearchEntryContextMenu({
  request,
  serverId,
  workspaceRoot,
  onOpenChange,
  isInContext,
  onOpenFile,
  onToggleFileContext,
  onToggleLineContext,
}: {
  request: SearchContextMenuRequest | null;
  serverId: string;
  workspaceRoot: string;
  onOpenChange: (open: boolean) => void;
  isInContext: boolean;
  onOpenFile?: (filePath: string, options?: { edit?: boolean; lineStart?: number }) => void;
  onToggleFileContext?: (file: SearchFileResult) => void;
  onToggleLineContext?: (file: SearchFileResult, match: FileSearchMatch) => void;
}) {
  const { t } = useTranslation();
  const canEditFiles = useTextEditorFeature(serverId);

  const handleToggleContext = useCallback(() => {
    if (!request) {
      return;
    }
    if (request.kind === "file") {
      onToggleFileContext?.(request.file);
      return;
    }
    onToggleLineContext?.(request.file, request.match);
  }, [request, onToggleFileContext, onToggleLineContext]);

  const handleEdit = useCallback(() => {
    if (!request || !onOpenFile) {
      return;
    }
    onOpenFile(request.file.path, {
      edit: true,
      ...(request.kind === "match" ? { lineStart: request.match.line } : null),
    });
  }, [onOpenFile, request]);

  const handleFindInFiles = useCallback(() => {
    if (!request) {
      return;
    }
    revealFileInFiles({ serverId, cwd: workspaceRoot, path: request.file.path });
  }, [request, serverId, workspaceRoot]);

  const handleCopyPath = useCallback(() => {
    if (!request) {
      return;
    }
    void Clipboard.setStringAsync(
      buildAbsoluteExplorerPath({ workspaceRoot, entryPath: request.file.path }),
    );
  }, [request, workspaceRoot]);

  const handleCopyRelativePath = useCallback(() => {
    if (!request) {
      return;
    }
    void Clipboard.setStringAsync(request.file.path);
  }, [request]);

  const contextLabel = useMemo(() => {
    if (!request) {
      return "";
    }
    if (request.kind === "match") {
      return isInContext
        ? t("projectSearch.removeLineFromContext", { line: request.match.line })
        : t("projectSearch.addLineToContext", { line: request.match.line });
    }
    return isInContext ? t("projectSearch.removeFromContext") : t("projectSearch.addToContext");
  }, [isInContext, request, t]);

  const showEdit = canEditFiles && Boolean(onOpenFile);
  const showContextAction =
    request !== null &&
    (request.kind === "file" ? Boolean(onToggleFileContext) : Boolean(onToggleLineContext));

  return (
    <ContextMenu open={request !== null} onOpenChange={onOpenChange} anchor={request}>
      <ContextMenuContent width={240} testID="project-search-context-menu">
        {showEdit ? (
          <ContextMenuItem
            leading={SEARCH_CONTEXT_EDIT_ICON}
            onSelect={handleEdit}
            testID="project-search-context-menu-edit"
          >
            {t("workspace.fileActions.editFile")}
          </ContextMenuItem>
        ) : null}
        {showEdit ? <ContextMenuSeparator /> : null}
        <ContextMenuItem
          leading={SEARCH_CONTEXT_FIND_IN_FILES_ICON}
          onSelect={handleFindInFiles}
          testID="project-search-context-menu-find-in-files"
        >
          {t("workspace.fileExplorer.context.findInFiles")}
        </ContextMenuItem>
        <ContextMenuItem
          leading={SEARCH_CONTEXT_COPY_ICON}
          onSelect={handleCopyPath}
          testID="project-search-context-menu-copy-path"
        >
          {t("workspace.fileExplorer.context.copyPath")}
        </ContextMenuItem>
        <ContextMenuItem
          leading={SEARCH_CONTEXT_COPY_ICON}
          onSelect={handleCopyRelativePath}
          testID="project-search-context-menu-copy-relative-path"
        >
          {t("workspace.fileExplorer.context.copyRelativePath")}
        </ContextMenuItem>
        {showContextAction ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              leading={SEARCH_CONTEXT_ATTACH_ICON}
              onSelect={handleToggleContext}
              testID={
                isInContext
                  ? "project-search-context-menu-remove-from-context"
                  : "project-search-context-menu-add-to-context"
              }
            >
              {contextLabel}
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
  },
  searchHeader: {
    paddingBottom: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  searchHeaderReplaceOpen: {
    // The replace band (styles.replaceRow) owns its own vertical rhythm - a full
    // pane-toolbar-height row with the input centered - so the header drops its
    // own bottom padding when open and lets the band govern the lower edge.
    paddingBottom: 0,
  },
  queryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    // On compact the leading replace-expand button isn't rendered, so the field
    // needs a bit more breathing room against the pane edge.
    paddingLeft: {
      xs: theme.spacing[2] - 2,
      md: theme.spacing[2] - 5,
    },
    paddingRight: theme.spacing[2] + 5,
    // Paired with searchHeader's paddingBottom: collapsed, these two are the
    // whole band, so they stay equal to keep the field centered. Changing one
    // without the other tilts the bar.
    paddingTop: theme.spacing[1],
  },
  // The replace band mirrors the search row's horizontal geometry but forms its
  // own full pane-toolbar-height row with the input vertically centered (no
  // paddingTop, unlike queryRow). This adds a proper second band below the
  // search row - leaving the search row untouched - so the expanded toolbar
  // lines up with the neighboring pane's toolbar divider and the replace input
  // sits centered in the added space.
  replaceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingLeft: {
      xs: theme.spacing[2] - 2,
      md: theme.spacing[2] - 5,
    },
    paddingRight: theme.spacing[2] + 5,
    // A touch taller than a bare pane-toolbar row, with the input centered in
    // the band (alignItems: "center"). This height alone governs how far the
    // expanded header's lower divider sits below the collapsed one, because
    // searchHeader drops its paddingBottom while open - so tune the open band
    // here, and leave queryRow's paddingTop to the collapsed bar.
    height: PANE_TOOLBAR_HEIGHT + 3.75,
  },
  queryInput: {
    flex: 1,
    minWidth: 60,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    color: theme.colors.foreground,
    // Explicit compact bump matching the explorer tab labels.
    fontSize: {
      xs: theme.fontSize.sm + 2,
      md: theme.fontSize.sm,
    },
  },
  replaceIndent: {
    // Mirrors the replace-expand button's width (icon + iconButton padding) so
    // the replace field aligns with the query field on each form factor.
    width: {
      xs: 36,
      sm: 36,
      md: 22,
    },
  },
  // The option strip, on the Changes toolbar's own geometry (same height, same
  // trailing inset) so the divider lines up with the neighboring pane's.
  toolbarRow: {
    height: PANE_TOOLBAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    // Two corner-pinned ends, like the Changes toolbar: the clear action leads,
    // the options strip trails.
    justifyContent: "space-between",
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  // The result count reads as a footer under the list, not a banner over it, so
  // the toolbar keeps the top edge and the divider sits above the summary.
  searchDetails: {
    alignItems: "center",
    gap: 2,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  summaryText: {
    color: theme.colors.foregroundMuted,
    fontSize: {
      xs: theme.fontSize.xs + 2,
      md: theme.fontSize.xs,
    },
  },
  truncatedText: {
    color: theme.colors.foregroundMuted,
    fontSize: {
      xs: theme.fontSize.xs + 2,
      md: theme.fontSize.xs,
    },
  },
  iconButton: {
    padding: theme.spacing[1],
    borderRadius: 6,
  },
  iconButtonActive: {
    backgroundColor: theme.colors.surfaceHover,
  },
  iconButtonDisabled: {
    opacity: 0.4,
  },
  goIconSlot: {
    // Doubled on compact to wrap the run icon's compact upscale.
    width: compactUp(16),
    height: compactUp(16),
    alignItems: "center",
    justifyContent: "center",
  },
  searchToggles: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  searchToggle: {
    paddingHorizontal: theme.spacing[1],
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "transparent",
  },
  searchToggleActive: {
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface2,
  },
  searchToggleText: {
    color: theme.colors.foregroundMuted,
    fontSize: {
      xs: theme.fontSize.xs + 2,
      md: theme.fontSize.xs,
    },
    fontFamily: theme.fontFamily.mono,
  },
  searchToggleTextActive: {
    color: theme.colors.foreground,
  },
  resultsArea: {
    flex: 1,
    minHeight: 0,
  },
  resultsList: {
    flex: 1,
  },
  // No inset: the first file row starts flush under the summary separator, the
  // way the Changes list starts flush under its toolbar.
  resultsListContent: {},
  centerState: {
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[4],
  },
  mutedText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  // The Changes file header, geometry included: a result row and a changed-file
  // row are the same kind of row, so they share the tree's padding, icon frame,
  // and label gap rather than each inventing its own.
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    // Collapsed, the row takes the panel's own surface and reads flat against
    // Explorer is one canvas, but this sticky row still needs that exact canvas
    // fill so scrolling code cannot show through it.
    backgroundColor: theme.colors.background,
    paddingLeft: 10,
    paddingRight: theme.spacing[2],
    paddingVertical: WORKSPACE_FILE_ROW_VERTICAL_PADDING,
    gap: theme.spacing[1],
    minWidth: 0,
  },
  // Expanded, the header takes the code well's own surface so the two read as
  // one block - the same pairing the Changes file section uses. The well draws
  // the divider under itself (SearchCodeBlock), so a collapsed row needs none,
  // matching the Changes list where only an expanded body is underlined.
  fileRowExpanded: {
    backgroundColor: theme.colors.surface1,
  },
  fileRowActive: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  fileIcon: {
    width: WORKSPACE_TREE_ICON_FRAME_SIZE,
    height: WORKSPACE_TREE_ICON_FRAME_SIZE,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    marginRight: WORKSPACE_TREE_ICON_LABEL_GAP - theme.spacing[1],
  },
  fileName: {
    color: theme.colors.foreground,
    // Explicit compact bump matching the Files tree's row labels.
    fontSize: {
      xs: theme.fontSize.sm + 2,
      md: theme.fontSize.sm,
    },
    flexShrink: 0,
    userSelect: "none",
  },
  fileDir: {
    color: theme.colors.foregroundMuted,
    fontSize: {
      xs: theme.fontSize.sm + 2,
      md: theme.fontSize.sm,
    },
    flexShrink: 1,
    minWidth: 0,
    userSelect: "none",
  },
  fileSpacer: {
    flex: 1,
    minWidth: 0,
  },
  fileCount: {
    color: theme.colors.foregroundMuted,
    fontSize: {
      xs: theme.fontSize.xs + 2,
      md: theme.fontSize.xs,
    },
    // Held to the tree's icon frame so the count cannot make a header row
    // taller than the file rows it sits among.
    height: WORKSPACE_TREE_ICON_FRAME_SIZE,
    lineHeight: WORKSPACE_TREE_ICON_FRAME_SIZE,
    flexShrink: 0,
    fontVariant: ["tabular-nums"],
  },
}));
