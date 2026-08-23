import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import type {
  LayoutChangeEvent,
  ListRenderItemInfo,
  PressableStateCallbackType,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type {
  FileSearchResultPayload,
  FileSearchSummary,
} from "@otto-code/client/internal/daemon-client";
import type { FileSearchMatch } from "@otto-code/protocol/messages";
import { getErrorMessage } from "@otto-code/protocol/error-utils";
import {
  ChevronDown,
  ChevronRight,
  Paperclip,
  Play,
  Search,
} from "@/components/icons/material-icons";
import { MaterialFileIcon } from "@/components/material-file-icon";
import {
  useTreeIconSize,
  WORKSPACE_FILE_ROW_VERTICAL_PADDING,
  WORKSPACE_TREE_ICON_FRAME_SIZE,
  WORKSPACE_TREE_ICON_LABEL_GAP,
} from "@/components/tree-primitives";
import { SearchCodeBlock, SearchSelectionBox } from "@/components/project-search-code-block";
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
import { compactUp, type Theme } from "@/styles/theme";
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

interface SearchFileResult {
  path: string;
  hash: string;
  matches: FileSearchMatch[];
}

type SearchPhase = "idle" | "searching" | "done" | "error";

interface ResultRow {
  key: string;
  kind: "file" | "matches";
  file: SearchFileResult;
  /** One entry per matched source line, for a "matches" row. */
  lines?: readonly SearchDisplayLine[];
}

const EMPTY_LINES: readonly SearchDisplayLine[] = [];

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

  const resultsListRef = useRef<FlatList<ResultRow>>(null);
  const scrollbar = useWebScrollViewScrollbar(resultsListRef, {
    enabled: showDesktopWebScrollbar,
  });

  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regexp, setRegexp] = useState(false);
  const [phase, setPhase] = useState<SearchPhase>("idle");
  const [results, setResults] = useState<SearchFileResult[]>([]);
  const [summary, setSummary] = useState<FileSearchSummary | null>(null);
  const [collapsedFiles, setCollapsedFiles] = useState<ReadonlySet<string>>(new Set());
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replacement, setReplacement] = useState("");
  // Default everything selected; this records the exceptions.
  const [uncheckedMatches, setUncheckedMatches] = useState<ReadonlySet<string>>(new Set());
  const [replacing, setReplacing] = useState(false);

  // Ignores late stream events from a superseded search.
  const runTokenRef = useRef(0);
  const queryRef = useRef(query);
  queryRef.current = query;

  const runSearch = useCallback(async () => {
    const trimmed = queryRef.current.trim();
    if (!client || !trimmed) {
      return;
    }
    const token = runTokenRef.current + 1;
    runTokenRef.current = token;
    setPhase("searching");
    setResults([]);
    setSummary(null);
    setUncheckedMatches(new Set());
    setCollapsedFiles(new Set());
    try {
      const outcome = await client.searchFiles({
        cwd: workspaceRoot,
        query: trimmed,
        caseSensitive,
        wholeWord,
        regexp,
        onFileResult: (result: FileSearchResultPayload) => {
          if (runTokenRef.current !== token) {
            return;
          }
          setResults((previous) => [
            ...previous,
            { path: result.path, hash: result.hash, matches: result.matches },
          ]);
        },
      });
      if (runTokenRef.current !== token) {
        return;
      }
      if (outcome.status === "error") {
        setPhase("error");
        toast.error(outcome.error ?? t("projectSearch.error"));
        return;
      }
      if (outcome.status === "superseded") {
        return;
      }
      setSummary(outcome);
      setPhase("done");
    } catch (error) {
      if (runTokenRef.current === token) {
        setPhase("error");
        toast.error(getErrorMessage(error));
      }
    }
  }, [caseSensitive, client, regexp, t, toast, wholeWord, workspaceRoot]);

  const handleSubmit = useCallback(() => {
    void runSearch();
  }, [runSearch]);

  const toggleFileCollapsed = useCallback((path: string) => {
    setCollapsedFiles((previous) => {
      const next = new Set(previous);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const toggleFileChecked = useCallback((file: SearchFileResult) => {
    setUncheckedMatches((previous) => {
      const keys = file.matches.map((match) => buildMatchKey(file.path, match));
      const anyChecked = keys.some((key) => !previous.has(key));
      const next = new Set(previous);
      for (const key of keys) {
        if (anyChecked) {
          next.add(key);
        } else {
          next.delete(key);
        }
      }
      return next;
    });
  }, []);

  const selection = useMemo(() => {
    let matches = 0;
    const files: Array<{ file: SearchFileResult; matches: FileSearchMatch[] }> = [];
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
  }, [results, uncheckedMatches]);

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
    setReplacing(true);
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
      setReplacing(false);
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

  const toggleReplaceOpen = useCallback(() => {
    setReplaceOpen((previous) => !previous);
  }, []);

  const handleToggleCase = useCallback(() => setCaseSensitive((value) => !value), []);
  const handleToggleWord = useCallback(() => setWholeWord((value) => !value), []);
  const handleToggleRegexp = useCallback(() => setRegexp((value) => !value), []);

  // The replace row trails a spacer matching the toggle group so both inputs
  // end at the same edge (the two icon buttons already match widths).
  const [togglesWidth, setTogglesWidth] = useState(0);
  const handleTogglesLayout = useCallback((event: LayoutChangeEvent) => {
    setTogglesWidth(event.nativeEvent.layout.width);
  }, []);
  const togglesSpacerStyle = useMemo(() => ({ width: togglesWidth }), [togglesWidth]);

  // Display lines are cached against the file object a result event created, so
  // a streaming search rebuilding `rows` per event does not re-derive (and
  // re-render) every earlier file's block.
  const displayLinesCache = useRef(new WeakMap<SearchFileResult, readonly SearchDisplayLine[]>());
  const rows = useMemo<ResultRow[]>(() => {
    const next: ResultRow[] = [];
    for (const file of results) {
      next.push({ key: `file:${file.path}`, kind: "file", file });
      if (collapsedFiles.has(file.path) || file.matches.length === 0) {
        continue;
      }
      let lines = displayLinesCache.current.get(file);
      if (!lines) {
        lines = buildSearchDisplayLines(file.matches, (match) => buildMatchKey(file.path, match));
        displayLinesCache.current.set(file, lines);
      }
      next.push({ key: `matches:${file.path}`, kind: "matches", file, lines });
    }
    return next;
  }, [collapsedFiles, results]);

  // Inline notes on hits, on the review surface Changes writes to.
  const noteSources = useMemo(
    () =>
      rows.flatMap((row) =>
        row.kind === "matches"
          ? [{ filePath: row.file.path, lines: row.lines ?? EMPTY_LINES }]
          : [],
      ),
    [rows],
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
  const toggleLineChecked = useCallback((_filePath: string, line: SearchDisplayLine) => {
    setUncheckedMatches((previous) => {
      const anyChecked = line.matchKeys.some((key) => !previous.has(key));
      const next = new Set(previous);
      for (const key of line.matchKeys) {
        if (anyChecked) {
          next.add(key);
        } else {
          next.delete(key);
        }
      }
      return next;
    });
  }, []);
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
          showSelection={showReplaceControls && replaceOpen}
          isLineChecked={isLineChecked}
          toggleLabel={t("projectSearch.toggleMatch")}
          onToggleLine={toggleLineChecked}
          onPressLine={handleOpenLine}
          onLineContextMenu={handleLineContextMenu}
          reviewActions={reviewActions}
          testIDPrefix={`project-search-match-${row.file.path}`}
        />
      );
    },
    [
      collapsedFiles,
      handleLineContextMenu,
      handleOpenLine,
      handleShowFileContextMenu,
      isLineChecked,
      reviewActions,
      replaceOpen,
      showReplaceControls,
      t,
      toggleFileChecked,
      toggleFileCollapsed,
      toggleLineChecked,
      uncheckedMatches,
    ],
  );

  const keyExtractor = useCallback((row: ResultRow) => row.key, []);

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

      <View style={styles.resultsArea}>
        {phase === "searching" && results.length === 0 ? (
          <View style={styles.centerState}>
            <ThemedLoadingSpinner uniProps={foregroundMutedIconColorMapping} />
            <Text style={styles.mutedText}>{t("projectSearch.searching")}</Text>
          </View>
        ) : null}
        {phase === "done" && results.length === 0 ? (
          <View style={styles.centerState}>
            <Text style={styles.mutedText}>{t("projectSearch.noResults")}</Text>
          </View>
        ) : null}
        {phase === "idle" ? (
          <View style={styles.centerState}>
            <Text style={styles.mutedText}>{t("projectSearch.idleHint")}</Text>
          </View>
        ) : null}
        <FlatList
          ref={resultsListRef}
          data={rows}
          renderItem={renderRow}
          keyExtractor={keyExtractor}
          style={styles.resultsList}
          contentContainerStyle={styles.resultsListContent}
          stickyHeaderIndices={stickyHeaderIndices}
          onLayout={scrollbar.onLayout}
          onScroll={scrollbar.onScroll}
          onContentSizeChange={scrollbar.onContentSizeChange}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={!showDesktopWebScrollbar}
          testID="project-search-results"
        />
        {rows.length > 0 ? scrollbar.overlay : null}
      </View>
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

function FileRow({
  file,
  collapsed,
  showSelection,
  uncheckedMatches,
  onToggleCollapsed,
  onToggleChecked,
  onShowContextMenu,
}: {
  file: SearchFileResult;
  collapsed: boolean;
  showSelection: boolean;
  uncheckedMatches: ReadonlySet<string>;
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
      collapsed ? styles.fileRowCollapsed : styles.fileRowExpanded,
      (Boolean(hovered) || pressed) && styles.fileRowActive,
    ],
    [collapsed],
  );
  const accessibilityState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);
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
  searchDetails: {
    alignItems: "center",
    gap: 2,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
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
    backgroundColor: theme.colors.surface2,
    paddingLeft: 10,
    paddingRight: theme.spacing[2],
    paddingVertical: WORKSPACE_FILE_ROW_VERTICAL_PADDING,
    gap: theme.spacing[1],
    minWidth: 0,
  },
  // Expanded, the header takes the code well's own surface so the two read as
  // one block - the same pairing the Changes file section uses.
  fileRowExpanded: {
    backgroundColor: theme.colors.surface1,
  },
  fileRowCollapsed: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
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
