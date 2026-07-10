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
  Check,
  ChevronDown,
  ChevronRight,
  Paperclip,
  Play,
  Search,
  Square,
} from "@/components/icons/material-icons";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
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
import type { Theme } from "@/styles/theme";

const foregroundMutedIconColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const accentIconColorMapping = (theme: Theme) => ({ color: theme.colors.accent });
const ThemedSearch = withUnistyles(Search);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedCheck = withUnistyles(Check);
const ThemedPlay = withUnistyles(Play);
const ThemedSquare = withUnistyles(Square);
const ThemedPaperclip = withUnistyles(Paperclip);
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
  kind: "file" | "match";
  file: SearchFileResult;
  match?: FileSearchMatch;
  matchIndex?: number;
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

function SelectionBox({
  checked,
  accessibilityLabel,
  testID,
  onPress,
}: {
  checked: boolean;
  accessibilityLabel: string;
  testID: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={useMemo(() => ({ checked }), [checked])}
      testID={testID}
      onPress={onPress}
      style={iconButtonStyle}
      hitSlop={6}
    >
      {checked ? (
        <ThemedCheck size={14} uniProps={accentIconColorMapping} />
      ) : (
        <ThemedSquare size={14} uniProps={foregroundMutedIconColorMapping} />
      )}
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

  // "Add to context" mirrors the file explorer's: the file (or a specific
  // matched line) lands in the workspace-scoped attachment store and shows as
  // a composer pill. Offered only while an agent tab is the focused pane, so
  // the attachment has a visible destination — the menu item is hidden
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
  const handleShowMatchContextMenu = useCallback(
    (input: { file: SearchFileResult; match: FileSearchMatch; x: number; y: number }) => {
      setContextMenuRequest({ kind: "match", ...input });
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

  const toggleMatchChecked = useCallback((key: string) => {
    setUncheckedMatches((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
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

  const rows = useMemo<ResultRow[]>(() => {
    const next: ResultRow[] = [];
    for (const file of results) {
      next.push({ key: `file:${file.path}`, kind: "file", file });
      if (collapsedFiles.has(file.path)) {
        continue;
      }
      file.matches.forEach((match, matchIndex) => {
        next.push({
          key: `match:${buildMatchKey(file.path, match)}`,
          kind: "match",
          file,
          match,
          matchIndex,
        });
      });
    }
    return next;
  }, [collapsedFiles, results]);

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
            onShowContextMenu={handleToggleFileContext ? handleShowFileContextMenu : undefined}
          />
        );
      }
      return (
        <MatchRow
          file={row.file}
          match={row.match as FileSearchMatch}
          matchIndex={row.matchIndex ?? 0}
          showSelection={showReplaceControls && replaceOpen}
          checked={
            !uncheckedMatches.has(buildMatchKey(row.file.path, row.match as FileSearchMatch))
          }
          onToggleChecked={toggleMatchChecked}
          onOpenFile={onOpenFile}
          onShowContextMenu={handleToggleLineContext ? handleShowMatchContextMenu : undefined}
        />
      );
    },
    [
      collapsedFiles,
      handleShowFileContextMenu,
      handleShowMatchContextMenu,
      handleToggleFileContext,
      handleToggleLineContext,
      onOpenFile,
      replaceOpen,
      showReplaceControls,
      toggleFileChecked,
      toggleFileCollapsed,
      toggleMatchChecked,
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
                <ThemedChevronDown size={14} uniProps={foregroundMutedIconColorMapping} />
              ) : (
                <ThemedChevronRight size={14} uniProps={foregroundMutedIconColorMapping} />
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
            <ThemedSearch size={16} uniProps={foregroundMutedIconColorMapping} />
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
          <View style={styles.queryRow}>
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
                    <ThemedPlay size={16} uniProps={foregroundMutedIconColorMapping} />
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
        onOpenChange={handleContextMenuOpenChange}
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
  return (
    <View style={styles.fileRow}>
      {showSelection ? (
        <SelectionBox
          checked={anyChecked}
          accessibilityLabel={t("projectSearch.toggleFile")}
          testID={`project-search-file-check-${file.path}`}
          onPress={handleToggleChecked}
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={handleToggleCollapsed}
        // @ts-ignore - onContextMenu is web-only and not in RN types.
        onContextMenu={isWeb && onShowContextMenu ? handleContextMenu : undefined}
        style={styles.fileRowLabel}
        testID={`project-search-file-${file.path}`}
      >
        {collapsed ? (
          <ThemedChevronRight size={12} uniProps={foregroundMutedIconColorMapping} />
        ) : (
          <ThemedChevronDown size={12} uniProps={foregroundMutedIconColorMapping} />
        )}
        <Text style={styles.filePath} numberOfLines={1}>
          {file.path}
        </Text>
        <Text style={styles.fileCount}>{file.matches.length}</Text>
      </Pressable>
    </View>
  );
}

function MatchRow({
  file,
  match,
  matchIndex,
  showSelection,
  checked,
  onToggleChecked,
  onOpenFile,
  onShowContextMenu,
}: {
  file: SearchFileResult;
  match: FileSearchMatch;
  matchIndex: number;
  showSelection: boolean;
  checked: boolean;
  onToggleChecked: (key: string) => void;
  onOpenFile?: (filePath: string, options?: { edit?: boolean; lineStart?: number }) => void;
  onShowContextMenu?: (input: {
    file: SearchFileResult;
    match: FileSearchMatch;
    x: number;
    y: number;
  }) => void;
}) {
  const { t } = useTranslation();
  const key = buildMatchKey(file.path, match);
  // Spaces/colons in a testID don't survive as a data-testid attribute cleanly
  // (they get mangled on web); a path + index stays stable and selectable.
  const rowTestId = `project-search-match-${file.path}-${matchIndex}`;
  const handleToggleChecked = useCallback(() => onToggleChecked(key), [key, onToggleChecked]);
  const handleOpen = useCallback(
    () => onOpenFile?.(file.path, { lineStart: match.line }),
    [file.path, match.line, onOpenFile],
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
      onShowContextMenu({ file, match, x: anchor.x, y: anchor.y });
    },
    [file, match, onShowContextMenu],
  );
  const before = match.lineText.slice(0, match.previewStart);
  const highlighted = match.lineText.slice(match.previewStart, match.previewStart + match.length);
  const after = match.lineText.slice(match.previewStart + match.length);
  return (
    <View style={styles.matchRow}>
      {showSelection ? (
        <SelectionBox
          checked={checked}
          accessibilityLabel={t("projectSearch.toggleMatch")}
          testID={`${rowTestId}-check`}
          onPress={handleToggleChecked}
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={handleOpen}
        // @ts-ignore - onContextMenu is web-only and not in RN types.
        onContextMenu={isWeb && onShowContextMenu ? handleContextMenu : undefined}
        style={styles.matchRowBody}
        testID={rowTestId}
      >
        <Text style={styles.matchLineNumber}>{match.line}</Text>
        <Text style={styles.matchPreview} numberOfLines={1}>
          {before}
          <Text style={styles.matchHighlight}>{highlighted}</Text>
          {after}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * Pane-level right-click menu (web only) — one shared instance serving every
 * file/match row, offering the same "add to context" action as its target.
 */
function SearchEntryContextMenu({
  request,
  onOpenChange,
  isInContext,
  onToggleFileContext,
  onToggleLineContext,
}: {
  request: SearchContextMenuRequest | null;
  onOpenChange: (open: boolean) => void;
  isInContext: boolean;
  onToggleFileContext?: (file: SearchFileResult) => void;
  onToggleLineContext?: (file: SearchFileResult, match: FileSearchMatch) => void;
}) {
  const { t } = useTranslation();

  const handleToggle = useCallback(() => {
    if (!request) {
      return;
    }
    if (request.kind === "file") {
      onToggleFileContext?.(request.file);
      return;
    }
    onToggleLineContext?.(request.file, request.match);
  }, [request, onToggleFileContext, onToggleLineContext]);

  const label = useMemo(() => {
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

  const contextLeading = useMemo(
    () => <ThemedPaperclip size={14} uniProps={foregroundMutedIconColorMapping} />,
    [],
  );

  return (
    <ContextMenu open={request !== null} onOpenChange={onOpenChange} anchor={request}>
      <ContextMenuContent width={240} testID="project-search-context-menu">
        <ContextMenuItem
          leading={contextLeading}
          onSelect={handleToggle}
          testID={
            isInContext
              ? "project-search-context-menu-remove-from-context"
              : "project-search-context-menu-add-to-context"
          }
        >
          {label}
        </ContextMenuItem>
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
    paddingBottom: theme.spacing[2] - 2.75,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  searchHeaderReplaceOpen: {
    paddingBottom: theme.spacing[2] - 3.75,
  },
  queryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingLeft: theme.spacing[2] - 5,
    paddingRight: theme.spacing[2] + 5,
    paddingTop: theme.spacing[2] - 2.75,
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
    fontSize: theme.fontSize.sm,
  },
  replaceIndent: {
    width: 22,
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
    fontSize: theme.fontSize.xs,
  },
  truncatedText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
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
    width: 16,
    height: 16,
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
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontFamily.mono,
  },
  searchToggleTextActive: {
    color: theme.colors.foreground,
  },
  resultsArea: {
    flex: 1,
    minHeight: 0,
    paddingTop: theme.spacing[1],
  },
  resultsList: {
    flex: 1,
  },
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
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[1],
    paddingTop: theme.spacing[1],
  },
  fileRowLabel: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
  },
  filePath: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  fileCount: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontVariant: ["tabular-nums"],
  },
  matchRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: theme.spacing[3],
    paddingRight: theme.spacing[1],
  },
  matchRowBody: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: 3,
  },
  matchLineNumber: {
    minWidth: 28,
    textAlign: "right",
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontFamily.mono,
    fontVariant: ["tabular-nums"],
  },
  matchPreview: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.code,
    fontFamily: theme.fontFamily.mono,
  },
  matchHighlight: {
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface3,
  },
}));
