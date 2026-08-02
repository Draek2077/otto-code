import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  History,
  List,
  Save,
  Search,
  TriangleAlert,
  Undo2,
  WandStars,
  WrapText,
  X,
} from "@/components/icons/material-icons";
import { SourceControlPanelIcon } from "@/components/icons/source-control-panel-icon";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Shortcut } from "@/components/ui/shortcut";
import { ToolbarIconButton } from "@/components/ui/toolbar-icon-button";
import { ToolbarSeparator } from "@/components/ui/toolbar-separator";
import { PANE_TOOLBAR_HEIGHT } from "@/components/ui/control-geometry";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useAppSettings, type AppSettings } from "@/hooks/use-settings";
import { isWeb } from "@/constants/platform";
import { CodeEditor } from "@/editor/code-editor";
import { MarkdownToolbarForPath } from "@/editor/markdown/markdown-toolbar";
import type {
  CodeEditorProps,
  EditorController,
  EditorCursorPosition,
  MarkdownCommandName,
  EditorMatchInfo,
  EditorPointerSelect,
  EditorScrollMetrics,
  EditorThemeSpec,
} from "@/editor/editor-contract";
import { buildEditorThemeSpec } from "@/editor/editor-theme";
import { resolveFindSeed } from "@/editor/find-seed";
import type { EditorBufferState } from "@/editor/editor-buffer-state";
import { buildEditorBufferKey, useEditorBufferStore } from "@/editor/editor-buffer-store";
import { useEditorBuffer } from "@/editor/use-editor-buffer";
import { useEditorClipboardActions } from "@/editor/use-editor-clipboard-actions";
import { DefinitionPickerDialog } from "@/editor/definition-picker-dialog";
import { EditorOutlineSheet } from "@/editor/editor-outline-sheet";
import { useEditorShortcutHints } from "@/editor/editor-shortcut-hints";
import { useEditorKeyBindings } from "@/editor/editor-key-bindings";
import { EditorStatusBar, useBufferByteSize } from "@/editor/editor-status-bar";
import { useEditorPrefsStore } from "@/editor/editor-prefs-store";
import { GoToLineDialog } from "@/editor/go-to-line-dialog";
import { useCodeIndexFeature } from "@/editor/use-code-index-feature";
import { useDefinitionSources } from "@/editor/use-definition-sources";
import { useCodeHover } from "@/editor/use-code-hover";
import { mirrorableText, useCodeDocument } from "@/editor/use-code-document";
import { useFindReferences } from "@/editor/references/use-find-references";
import { useRenameSymbol } from "@/editor/rename/use-rename-symbol";
import { RenameSymbolDialog } from "@/editor/rename/rename-symbol-dialog";
import { EditorDiagnosticsPanel, useDismissibleProblems } from "@/editor/editor-diagnostics-panel";
import { useGoToDefinition, type GoToDefinitionTarget } from "@/editor/use-go-to-definition";
import { useTextEditorFeature } from "@/editor/use-text-editor-feature";
import { revealFileInChanges, useChangedFilePaths } from "@/git/changes-reveal";
import { openFileHistoryTab } from "@/git/file-history/open-file-history-tab";
import type { FileHistoryRange } from "@/git/file-history/use-file-history-data";
import { useGitFileHistoryFeature } from "@/git/use-git-file-history-feature";
import { useToast } from "@/contexts/toast-context";
import { openRefineTab } from "@/refine/open-refine-tab";
import { isRefinableDocument } from "@/refine/refine-scope";
import { useRefineFeature } from "@/refine/use-refine-feature";
import {
  FilePreview,
  type FilePreviewFileInfo,
  type FilePreviewSyncHandle,
  type PreviewPointerDown,
  type PreviewScrollMetrics,
} from "@/components/file-pane";
import { MAX_PREVIEW_FIND_MATCHES, type PreviewFindQuery } from "@/components/file-preview-find";
import { FileViewModeBar, type FileViewModeBarProps } from "@/components/file-view-mode-bar";
import {
  contentFractionToLine,
  contentYFraction,
  createSplitSyncGate,
  lineToTargetContentY,
  scrollFraction,
} from "@/components/file-split-sync";
import { defaultFileViewMode } from "@/components/file-pane-render-mode";
import { ResizeHandle } from "@/components/resize-handle";
import { usePaneContext } from "@/panels/pane-context";
import { useFileViewMode, useFileViewStore, type FileViewMode } from "@/stores/file-view-store";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-tabs-store";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import type { EditGate } from "@/projects/cross-project-open";
import { isAbsolutePath } from "@/utils/path";
import type { WorkspaceFileLocation } from "@/workspace/file-open";
import type { Theme } from "@/styles/theme";

// One pane per file tab. Hosts the three views — editor, editor+preview
// split, read-only preview — behind the FileViewModeBar. The editor buffer
// outlives mode switches (only closing the tab discards it), and in split
// view the two sides stay proportionally aligned: scrolling one side scrolls
// the other to the same content fraction, and a click carries the equivalent
// content on the other side to the same viewport height.

const MAX_COUNTED_MATCHES = 999;

// Livelier doc-sync while the preview renders the draft next to the editor.
const SPLIT_DOC_SYNC_DEBOUNCE_MS = 250;

const foregroundMutedIconColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
// The alert glyph on a sync banner carries the banner's own tone — a muted grey
// triangle on an amber bar reads as decoration rather than a warning.
const warningIconColorMapping = (theme: Theme) => ({
  color: theme.colors.statusWarningStrong,
});
const ThemedSearch = withUnistyles(Search);
const ThemedList = withUnistyles(List);
const ThemedHistory = withUnistyles(History);
const ThemedSourceControl = withUnistyles(SourceControlPanelIcon);
const ThemedWandStars = withUnistyles(WandStars);
const ThemedSave = withUnistyles(Save);
const ThemedUndo2 = withUnistyles(Undo2);
const ThemedWrapText = withUnistyles(WrapText);
const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedArrowDown = withUnistyles(ArrowDown);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedTriangleAlert = withUnistyles(TriangleAlert);
const ThemedX = withUnistyles(X);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedFindInput = withUnistyles(TextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));

/** The off switch and the column live in separate settings; the spec has one field. */
function resolveRulerColumn(settings: AppSettings): number | null {
  return settings.rulerEnabled ? settings.rulerColumn : null;
}

// `theme` is resolved by the withUnistyles mapping below, so the wrapped
// component has to tolerate the frame where it is not injected yet. The ruler
// column rides in as a separate prop because it lives in device-local app
// settings, not in the Unistyles theme the mapping can see.
function CodeEditorWithInjectedTheme({
  theme,
  rulerColumn,
  ...rest
}: Omit<CodeEditorProps, "theme"> & {
  theme?: EditorThemeSpec;
  rulerColumn: number | null;
}) {
  const themeWithRuler = useMemo(
    () => (theme ? { ...theme, rulerColumn } : null),
    [theme, rulerColumn],
  );
  if (!themeWithRuler) {
    return null;
  }
  return <CodeEditor {...rest} theme={themeWithRuler} />;
}

const ThemedCodeEditor = withUnistyles(CodeEditorWithInjectedTheme, (theme) => ({
  theme: buildEditorThemeSpec(theme),
}));

function iconButtonStyle({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.iconButton, (Boolean(hovered) || pressed) && styles.iconButtonActive];
}

interface FindStripState {
  open: boolean;
  search: string;
  replace: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
  replaceOpen: boolean;
}

const INITIAL_FIND_STATE: FindStripState = {
  open: false,
  search: "",
  replace: "",
  caseSensitive: false,
  wholeWord: false,
  regexp: false,
  replaceOpen: false,
};

function FindToggle({
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
    () => [styles.findToggle, active && styles.findToggleActive],
    [active],
  );
  const textStyle = useMemo(
    () => [styles.findToggleText, active && styles.findToggleTextActive],
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

function EditorSyncBanners({
  diskChange,
  hasConflict,
  onDiskReload,
  onDiskKeepMine,
  onDiskDismiss,
  onConflictReload,
  onConflictOverwrite,
  onConflictDismiss,
}: {
  diskChange: EditorBufferState["diskChange"];
  hasConflict: boolean;
  onDiskReload: () => void;
  onDiskKeepMine: () => void;
  onDiskDismiss: () => void;
  onConflictReload: () => void;
  onConflictOverwrite: () => void;
  onConflictDismiss: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {diskChange ? (
        <View style={styles.conflictBanner} testID="editor-disk-banner">
          <ThemedTriangleAlert size={16} uniProps={warningIconColorMapping} />
          <Text style={styles.conflictText}>
            {diskChange.kind === "deleted"
              ? t("editor.diskChange.deletedMessage")
              : t("editor.diskChange.changedMessage")}
          </Text>
          {diskChange.kind === "changed" ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                onPress={onDiskReload}
                testID="editor-disk-reload"
              >
                {t("editor.diskChange.reload")}
              </Button>
              <Button size="sm" variant="ghost" onPress={onDiskKeepMine} testID="editor-disk-keep">
                {t("editor.diskChange.keepMine")}
              </Button>
            </>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("editor.diskChange.dismiss")}
            testID="editor-disk-dismiss"
            onPress={onDiskDismiss}
            style={iconButtonStyle}
          >
            <ThemedX size={14} uniProps={foregroundMutedIconColorMapping} />
          </Pressable>
        </View>
      ) : null}

      {hasConflict ? (
        <View style={styles.conflictBanner} testID="editor-conflict-banner">
          <ThemedTriangleAlert size={16} uniProps={warningIconColorMapping} />
          <Text style={styles.conflictText}>{t("editor.conflict.message")}</Text>
          <Button
            size="sm"
            variant="secondary"
            onPress={onConflictReload}
            testID="editor-conflict-reload"
          >
            {t("editor.conflict.reload")}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onPress={onConflictOverwrite}
            testID="editor-conflict-overwrite"
          >
            {t("editor.conflict.overwrite")}
          </Button>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("editor.conflict.dismiss")}
            testID="editor-conflict-dismiss"
            onPress={onConflictDismiss}
            style={iconButtonStyle}
          >
            <ThemedX size={14} uniProps={foregroundMutedIconColorMapping} />
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

/** The buffer draft, only while it differs from disk (dirty). */
function useDraftOverride(input: {
  serverId: string;
  workspaceId: string;
  path: string;
}): string | null {
  const key = buildEditorBufferKey(input);
  return useEditorBufferStore((state) => {
    const buffer = state.buffers[key];
    return buffer?.dirty ? (buffer.draft ?? null) : null;
  });
}

interface PreviewFindState {
  open: boolean;
  search: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
}

const INITIAL_PREVIEW_FIND_STATE: PreviewFindState = {
  open: false,
  search: "",
  caseSensitive: false,
  wholeWord: false,
  regexp: false,
};

interface PreviewFindStripHandlers {
  onSearchChange: (search: string) => void;
  onToggleCase: () => void;
  onToggleWord: () => void;
  onToggleRegexp: () => void;
  onFindNext: () => void;
  onFindPrevious: () => void;
  onKeyPress: (event: { nativeEvent: { key: string } }) => void;
  onClose: () => void;
}

/**
 * The read-only preview's find bar — the editor's find strip minus replace
 * (there is no buffer to write to here). It drives a plain text scan over the
 * previewed file rather than CodeMirror, but wears the same chrome so the two
 * views feel like one editor.
 */
function PreviewFindStrip({
  find,
  matchCountLabel,
  handlers,
}: {
  find: PreviewFindState;
  matchCountLabel: string;
  handlers: PreviewFindStripHandlers;
}) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  return (
    <View style={styles.findStrip} testID="preview-find-strip">
      <View style={styles.findRow}>
        <ThemedFindInput
          style={styles.findInput}
          value={find.search}
          onChangeText={handlers.onSearchChange}
          placeholder={t("editor.find.placeholder")}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          blurOnSubmit={false}
          onSubmitEditing={handlers.onFindNext}
          onKeyPress={handlers.onKeyPress}
          testID="preview-find-input"
        />
        {matchCountLabel ? (
          <Text style={styles.matchCount} testID="preview-find-count">
            {matchCountLabel}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("editor.find.previous")}
          testID="preview-find-previous"
          onPress={handlers.onFindPrevious}
          style={iconButtonStyle}
        >
          <ThemedArrowUp size={14} uniProps={foregroundMutedIconColorMapping} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("editor.find.next")}
          testID="preview-find-next"
          onPress={handlers.onFindNext}
          style={iconButtonStyle}
        >
          <ThemedArrowDown size={14} uniProps={foregroundMutedIconColorMapping} />
        </Pressable>
        <FindToggle
          label="Cc"
          active={find.caseSensitive}
          accessibilityLabel={t("editor.find.matchCase")}
          testID="preview-find-case"
          onPress={handlers.onToggleCase}
        />
        {isCompact ? null : (
          <>
            <FindToggle
              label="W"
              active={find.wholeWord}
              accessibilityLabel={t("editor.find.wholeWord")}
              testID="preview-find-word"
              onPress={handlers.onToggleWord}
            />
            <FindToggle
              label=".*"
              active={find.regexp}
              accessibilityLabel={t("editor.find.regexp")}
              testID="preview-find-regex"
              onPress={handlers.onToggleRegexp}
            />
          </>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("editor.find.close")}
          testID="preview-find-close"
          onPress={handlers.onClose}
          style={iconButtonStyle}
        >
          <ThemedX size={14} uniProps={foregroundMutedIconColorMapping} />
        </Pressable>
      </View>
    </View>
  );
}

function PreviewOnlyView({
  serverId,
  workspaceId,
  workspaceRoot,
  location,
  modeBarProps,
  toolbarLeadingSlot,
  fileInfo,
  onFileInfo,
  onOpenHistory,
  onViewChanges,
  onRefine,
}: {
  serverId: string;
  workspaceId: string;
  workspaceRoot: string;
  location: WorkspaceFileLocation;
  modeBarProps: FileViewModeBarProps | null;
  toolbarLeadingSlot: ReactNode;
  fileInfo: FilePreviewFileInfo | null;
  onFileInfo: (info: FilePreviewFileInfo | null) => void;
  onOpenHistory: ((range: FileHistoryRange | null) => void) | null;
  onViewChanges: (() => void) | null;
  /** Opens the Refine job tab for this file; null when unavailable. */
  onRefine: (() => void) | null;
}) {
  const { t } = useTranslation();
  const draftOverride = useDraftOverride({ serverId, workspaceId, path: location.path });
  // Preview has no selection to scope by, so it always investigates the file.
  const handleOpenHistory = useMemo(
    () => (onOpenHistory ? () => onOpenHistory(null) : null),
    [onOpenHistory],
  );

  // Wrap is one preference, shared with the editor: a user who wraps long lines
  // wants that in whichever view they are reading in.
  const wordWrap = useEditorPrefsStore((state) => state.wordWrap);
  const toggleWordWrap = useEditorPrefsStore((state) => state.toggleWordWrap);

  // The outline reads the daemon's symbol index, which knows nothing about the
  // view it is driving — so preview gets the same jump list the editor has, it
  // just scrolls instead of moving a caret.
  const hasCodeIndex = useCodeIndexFeature(serverId);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const openOutline = useCallback(() => setOutlineOpen(true), []);
  const closeOutline = useCallback(() => setOutlineOpen(false), []);
  const previewSyncRef = useRef<FilePreviewSyncHandle | null>(null);
  const handleOutlineLine = useCallback((line: number) => {
    previewSyncRef.current?.scrollToLine(line);
  }, []);

  const [find, setFind] = useState<PreviewFindState>(INITIAL_PREVIEW_FIND_STATE);
  const [matchCount, setMatchCount] = useState(0);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);

  // Find only makes sense over the syntax-highlighted text view: a rendered
  // document (markdown, a mermaid diagram) has no line mapping to highlight,
  // and images/binaries have no text. The button and strip stay hidden for those.
  const findAvailable = fileInfo?.kind === "text" && !fileInfo.isRenderedDocument;

  const findQuery = useMemo<PreviewFindQuery | null>(
    () =>
      find.open && find.search
        ? {
            search: find.search,
            caseSensitive: find.caseSensitive,
            wholeWord: find.wholeWord,
            regexp: find.regexp,
          }
        : null,
    [find],
  );

  // A new query always starts at its first hit; the scan reports the fresh
  // count, and the clamp below keeps the active index inside it.
  useEffect(() => {
    setActiveMatchIndex(0);
  }, [findQuery]);
  useEffect(() => {
    setActiveMatchIndex((index) => (matchCount === 0 ? 0 : Math.min(index, matchCount - 1)));
  }, [matchCount]);

  // Close the strip if the file it was searching stops supporting find.
  useEffect(() => {
    if (!findAvailable) {
      setFind(INITIAL_PREVIEW_FIND_STATE);
    }
  }, [findAvailable]);

  const openFind = useCallback(() => setFind((prev) => ({ ...prev, open: true })), []);
  const closeFind = useCallback(() => setFind((prev) => ({ ...prev, open: false })), []);
  const goNext = useCallback(() => {
    setActiveMatchIndex((index) => (matchCount === 0 ? 0 : (index + 1) % matchCount));
  }, [matchCount]);
  const goPrevious = useCallback(() => {
    setActiveMatchIndex((index) => (matchCount === 0 ? 0 : (index - 1 + matchCount) % matchCount));
  }, [matchCount]);

  const findHandlers = useMemo<PreviewFindStripHandlers>(
    () => ({
      onSearchChange: (search: string) => setFind((prev) => ({ ...prev, search })),
      onToggleCase: () => setFind((prev) => ({ ...prev, caseSensitive: !prev.caseSensitive })),
      onToggleWord: () => setFind((prev) => ({ ...prev, wholeWord: !prev.wholeWord })),
      onToggleRegexp: () => setFind((prev) => ({ ...prev, regexp: !prev.regexp })),
      onFindNext: goNext,
      onFindPrevious: goPrevious,
      onKeyPress: (event) => {
        if (event.nativeEvent.key === "Escape") {
          closeFind();
        }
      },
      onClose: closeFind,
    }),
    [closeFind, goNext, goPrevious],
  );

  const matchCountLabel = (() => {
    if (!find.search) {
      return "";
    }
    if (matchCount === 0) {
      return t("editor.find.noMatches");
    }
    const total =
      matchCount >= MAX_PREVIEW_FIND_MATCHES ? `${MAX_PREVIEW_FIND_MATCHES - 1}+` : `${matchCount}`;
    return `${activeMatchIndex + 1}/${total}`;
  })();

  return (
    <View style={styles.container} testID="workspace-file-tab-pane">
      {/* Same shape as the editor toolbar: file actions, a separator, then the
          navigate-within-the-file tools — so the two views don't move the
          buttons around under the user when they switch mode. */}
      <View style={styles.previewToolbar}>
        <FileGitToolbarGroup
          onOpenHistory={handleOpenHistory}
          onViewChanges={onViewChanges}
          showLeadingSeparator={false}
        />
        <FileAiToolbarGroup
          onRefine={onRefine}
          showLeadingSeparator={Boolean(handleOpenHistory || onViewChanges)}
        />
        <ToolbarLeadingSlot>{toolbarLeadingSlot}</ToolbarLeadingSlot>
        <ToolbarSeparator />
        {hasCodeIndex ? (
          <ToolbarIconButton
            label={t("codeOutline.open")}
            testID="preview-outline-toggle"
            Icon={ThemedList}
            onPress={openOutline}
          />
        ) : null}
        {findAvailable ? (
          <ToolbarIconButton
            label={t("editor.find.open")}
            testID="preview-find-toggle"
            Icon={ThemedSearch}
            onPress={find.open ? closeFind : openFind}
            selected={find.open}
          />
        ) : null}
        <View style={styles.toolbarSpacer} />
        {/* Wrap only means anything over the line-numbered code view; markdown
            prose and images wrap by their own rules. */}
        {findAvailable ? (
          <ToolbarIconButton
            label={t("editor.wordWrap")}
            testID="preview-wordwrap-toggle"
            Icon={ThemedWrapText}
            onPress={toggleWordWrap}
            selected={wordWrap}
          />
        ) : null}
        {modeBarProps ? <FileViewModeBar {...modeBarProps} /> : null}
      </View>
      {findAvailable && find.open ? (
        <PreviewFindStrip find={find} matchCountLabel={matchCountLabel} handlers={findHandlers} />
      ) : null}
      <FilePreview
        serverId={serverId}
        workspaceRoot={workspaceRoot}
        location={location}
        wrapLines={wordWrap}
        contentOverride={draftOverride}
        onFileInfo={onFileInfo}
        findQuery={findQuery}
        activeMatchIndex={activeMatchIndex}
        onFindMatchCount={setMatchCount}
        syncRef={previewSyncRef}
      />
      {/* Null until the preview has read the file — the bar appears with real
          values rather than flashing zeroes. No caret: there is no editor. */}
      {fileInfo ? (
        <EditorStatusBar
          path={location.path}
          byteSize={fileInfo.size}
          eol={fileInfo.eol}
          isText={fileInfo.kind === "text"}
          cursor={null}
          imageDimensions={fileInfo.imageDimensions}
        />
      ) : null}

      {hasCodeIndex ? (
        <EditorOutlineSheet
          serverId={serverId}
          workspaceRoot={workspaceRoot}
          path={location.path}
          visible={outlineOpen}
          onClose={closeOutline}
          onSelectLine={handleOutlineLine}
        />
      ) : null}
    </View>
  );
}

/**
 * The AI cluster: every action that hands this document to a model.
 *
 * Its own fenced section rather than a button loose among the git tools — this
 * is the part of the toolbar where a model sees your file, and that is worth
 * marking even while Refine is the only thing in it.
 *
 * Everything here is about THIS file. A surface's own model-facing action goes
 * here only if that is true of it too; Context Management's "Compact with AI"
 * is not — it opens a job carrying the whole context graph — so it lives beside
 * the graph's tabs instead. Two AI buttons in one bar, one file-scoped and one
 * graph-scoped, read as the same button rendered twice.
 *
 * Last of the file's own clusters, after git. Reading what a document already is
 * comes before asking for it to be rewritten, and putting the model-facing
 * action at the far end of the file group keeps it out of the path of the ones
 * you reach for without thinking.
 *
 * What is deliberately absent is an AI button that edits in place. The old
 * "Refactor with AI" handed a prompt to a full agent with complete tool access
 * and no diff; everything in this group can only ever propose, and the proposal
 * is reviewed before a byte is written.
 */
function FileAiToolbarGroup({
  onRefine,
  showLeadingSeparator,
}: {
  onRefine: (() => void) | null;
  showLeadingSeparator: boolean;
}) {
  const { t } = useTranslation();
  if (!onRefine) {
    return null;
  }
  return (
    <>
      {showLeadingSeparator ? <ToolbarSeparator /> : null}
      <ToolbarIconButton
        label={t("refine.open")}
        testID="file-refine-open"
        Icon={ThemedWandStars}
        onPress={onRefine}
      />
    </>
  );
}

/**
 * The git-investigation cluster: this file's history, and its diff in the
 * Changes tab. Shown once the host serves the local-git file RPCs; "view
 * changes" additionally requires the file to be in the current diff, since it
 * would otherwise send the user to a tab that does not list it.
 *
 * A component rather than an inline conditional so both toolbars (editor and
 * preview) spell it the same way. `showLeadingSeparator` fences the cluster off
 * from whatever precedes it — save and revert act on what you typed, these ask
 * what git knows. A separator with nothing on its left divides nothing, so the
 * caller passes false when this cluster opens the bar.
 */
function FileGitToolbarGroup({
  onOpenHistory,
  onViewChanges,
  showLeadingSeparator,
}: {
  onOpenHistory: (() => void) | null;
  onViewChanges: (() => void) | null;
  showLeadingSeparator: boolean;
}) {
  const { t } = useTranslation();
  if (!onOpenHistory && !onViewChanges) {
    return null;
  }
  return (
    <>
      {showLeadingSeparator ? <ToolbarSeparator /> : null}
      {onOpenHistory ? (
        <ToolbarIconButton
          label={t("gitFileHistory.open")}
          testID="file-history-open"
          Icon={ThemedHistory}
          onPress={onOpenHistory}
        />
      ) : null}
      {onViewChanges ? (
        <ToolbarIconButton
          label={t("workspace.git.diff.viewChanges")}
          testID="file-view-changes"
          Icon={ThemedSourceControl}
          onPress={onViewChanges}
        />
      ) : null}
    </>
  );
}

/**
 * Right-click inside the editor.
 *
 * Go to Definition lives here rather than in the toolbar: it acts on the word
 * you are pointing at, so the pointer is the natural place to ask for it (the
 * core moves the caret to the click first — see its `contextmenu` handler).
 *
 * Because claiming the right-click suppresses the platform's own menu, this
 * menu owes the user the edit actions that menu had. On Electron the native one
 * is suppressed to match, via `shouldShowDefaultContextMenu` — two menus for
 * one click is worse than either. Web-only: on a phone, long-press belongs to
 * the platform's text selection menu.
 */
function EditorContextMenu({
  anchor,
  onClose,
  cursor,
  canGoToDefinition,
  onGoToDefinition,
  onFindReferences,
  onRenameSymbol,
  onCut,
  onCopy,
  onPaste,
  onSelectAll,
  onSelectLine,
}: {
  anchor: { x: number; y: number } | null;
  onClose: () => void;
  cursor: EditorCursorPosition | null;
  canGoToDefinition: boolean;
  onGoToDefinition: () => void;
  /** Null when no language server covers this file — references have no ctags fallback. */
  onFindReferences: (() => void) | null;
  /** Null for the same reason: a rename with no server behind it is a find-and-replace. */
  onRenameSymbol: (() => void) | null;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
  onSelectLine: () => void;
}) {
  const { t } = useTranslation();
  // Derived here rather than at the call site so the cursor readout's optional
  // hops stay out of the editor view's branch budget.
  const hasSelection = (cursor?.selectedChars ?? 0) > 0;
  // Built as elements rather than inline per item, because jsx-as-a-prop is a
  // lint error. Memoized on the resolved keys rather than once per mount: they
  // move when the user rebinds one in Settings.
  const keys = useEditorShortcutHints();
  const hints = useMemo(
    () => ({
      goToDefinition: <Shortcut chord={keys.goToDefinition} />,
      findReferences: <Shortcut chord={keys.findReferences} />,
      renameSymbol: <Shortcut chord={keys.renameSymbol} />,
      cut: <Shortcut chord={keys.cut} />,
      copy: <Shortcut chord={keys.copy} />,
      paste: <Shortcut chord={keys.paste} />,
      selectLine: <Shortcut chord={keys.selectLine} />,
      selectAll: <Shortcut chord={keys.selectAll} />,
    }),
    [keys],
  );
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );
  return (
    <ContextMenu open={anchor !== null} onOpenChange={handleOpenChange} anchor={anchor}>
      <ContextMenuContent width={240} testID="editor-context-menu">
        {canGoToDefinition ? (
          <ContextMenuItem
            testID="editor-context-go-to-definition"
            onSelect={onGoToDefinition}
            trailing={hints.goToDefinition}
          >
            {t("goToDefinition.action")}
          </ContextMenuItem>
        ) : null}
        {/* Language-server only. Unlike go-to-definition there is no ctags fallback: the
            name index can list every symbol CALLED `foo`, which is not the same question as
            "what refers to THIS foo" and would be a worse answer than none. */}
        {onFindReferences ? (
          <ContextMenuItem
            testID="editor-context-find-references"
            onSelect={onFindReferences}
            trailing={hints.findReferences}
          >
            Find references
          </ContextMenuItem>
        ) : null}
        {onRenameSymbol ? (
          <ContextMenuItem
            testID="editor-context-rename-symbol"
            onSelect={onRenameSymbol}
            trailing={hints.renameSymbol}
          >
            Rename symbol…
          </ContextMenuItem>
        ) : null}
        {canGoToDefinition || onFindReferences || onRenameSymbol ? <ContextMenuSeparator /> : null}
        <ContextMenuItem disabled={!hasSelection} onSelect={onCut} trailing={hints.cut}>
          {t("editor.contextMenu.cut")}
        </ContextMenuItem>
        <ContextMenuItem disabled={!hasSelection} onSelect={onCopy} trailing={hints.copy}>
          {t("editor.contextMenu.copy")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onPaste} trailing={hints.paste}>
          {t("editor.contextMenu.paste")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          testID="editor-context-select-line"
          onSelect={onSelectLine}
          trailing={hints.selectLine}
        >
          {t("editor.contextMenu.selectLine")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onSelectAll} trailing={hints.selectAll}>
          {t("editor.contextMenu.selectAll")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * Save/revert own the far left of the editor toolbar; a host's own controls sit
 * right after them behind a separator, ahead of the generic editor tools.
 * Renders nothing — not even the separator — when the host supplied none.
 */
function ToolbarLeadingSlot({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <>
      <ToolbarSeparator />
      {children}
    </>
  );
}

interface EditorFindStripHandlers {
  onToggleReplaceOpen: () => void;
  onSearchChange: (search: string) => void;
  onReplaceChange: (replace: string) => void;
  onToggleCase: () => void;
  onToggleWord: () => void;
  onToggleRegexp: () => void;
  onFindNext: () => void;
  onFindPrevious: () => void;
  onReplaceNext: () => void;
  onReplaceAll: () => void;
  onKeyPress: (event: { nativeEvent: { key: string } }) => void;
  onClose: () => void;
}

/**
 * Put the caret in the find box and select what is already there, so the next
 * keystroke replaces the term rather than appending to it. Runs on every open
 * (and again once a selection seeds the term), which is why it is imperative:
 * the input may already be mounted and even already focused.
 */
function focusAndSelectFindInput(input: TextInput | null, termLength: number): void {
  if (!input) {
    return;
  }
  input.focus();
  if (isWeb) {
    // The web ref is the host <input> (sometimes behind getNativeRef), which
    // selects itself — same reach-through the composer and the browser URL bar
    // use. `setSelection` is native-only.
    const handle = input as TextInput & { getNativeRef?: () => unknown };
    const native = handle.getNativeRef?.() ?? input;
    if (native instanceof HTMLInputElement) {
      native.select();
    }
    return;
  }
  input.setSelection(0, termLength);
}

function EditorFindStrip({
  find,
  matchInfo,
  handlers,
  focusSignal,
}: {
  find: FindStripState;
  matchInfo: EditorMatchInfo | null;
  handlers: EditorFindStripHandlers;
  /** Changes whenever the host wants the find box focused; see openFind. */
  focusSignal: number;
}) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();

  const searchInputRef = useRef<TextInput | null>(null);
  const searchLengthRef = useRef(find.search.length);
  searchLengthRef.current = find.search.length;
  useEffect(() => {
    focusAndSelectFindInput(searchInputRef.current, searchLengthRef.current);
    // Only the signal, never the term: re-selecting on every keystroke would
    // make the box impossible to type in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSignal]);

  const matchCountLabel = (() => {
    if (!matchInfo || !find.search) {
      return "";
    }
    if (matchInfo.total === 0) {
      return t("editor.find.noMatches");
    }
    const total =
      matchInfo.total >= MAX_COUNTED_MATCHES ? `${MAX_COUNTED_MATCHES}+` : `${matchInfo.total}`;
    return `${matchInfo.current}/${total}`;
  })();

  return (
    <View style={styles.findStrip} testID="editor-find-strip">
      <View style={styles.findRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("editor.find.expandReplace")}
          testID="editor-replace-expand"
          onPress={handlers.onToggleReplaceOpen}
          style={iconButtonStyle}
        >
          {find.replaceOpen ? (
            <ThemedChevronDown size={14} uniProps={foregroundMutedIconColorMapping} />
          ) : (
            <ThemedChevronRight size={14} uniProps={foregroundMutedIconColorMapping} />
          )}
        </Pressable>
        {/* No autoFocus: the focusSignal effect owns focus, and it has to run on
            every open anyway — two mechanisms would just race on mount. */}
        <ThemedFindInput
          ref={searchInputRef}
          style={styles.findInput}
          value={find.search}
          onChangeText={handlers.onSearchChange}
          placeholder={t("editor.find.placeholder")}
          autoCapitalize="none"
          autoCorrect={false}
          blurOnSubmit={false}
          onSubmitEditing={handlers.onFindNext}
          onKeyPress={handlers.onKeyPress}
          testID="editor-find-input"
        />
        {matchCountLabel ? (
          <Text style={styles.matchCount} testID="editor-find-count">
            {matchCountLabel}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("editor.find.previous")}
          testID="editor-find-previous"
          onPress={handlers.onFindPrevious}
          style={iconButtonStyle}
        >
          <ThemedArrowUp size={14} uniProps={foregroundMutedIconColorMapping} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("editor.find.next")}
          testID="editor-find-next"
          onPress={handlers.onFindNext}
          style={iconButtonStyle}
        >
          <ThemedArrowDown size={14} uniProps={foregroundMutedIconColorMapping} />
        </Pressable>
        <FindToggle
          label="Cc"
          active={find.caseSensitive}
          accessibilityLabel={t("editor.find.matchCase")}
          testID="editor-find-case"
          onPress={handlers.onToggleCase}
        />
        {isCompact ? null : (
          <>
            <FindToggle
              label="W"
              active={find.wholeWord}
              accessibilityLabel={t("editor.find.wholeWord")}
              testID="editor-find-word"
              onPress={handlers.onToggleWord}
            />
            <FindToggle
              label=".*"
              active={find.regexp}
              accessibilityLabel={t("editor.find.regexp")}
              testID="editor-find-regex"
              onPress={handlers.onToggleRegexp}
            />
          </>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("editor.find.close")}
          testID="editor-find-close"
          onPress={handlers.onClose}
          style={iconButtonStyle}
        >
          <ThemedX size={14} uniProps={foregroundMutedIconColorMapping} />
        </Pressable>
      </View>
      {find.replaceOpen ? (
        <View style={styles.findRow}>
          <View style={styles.replaceIndent} />
          <ThemedFindInput
            style={styles.findInput}
            value={find.replace}
            onChangeText={handlers.onReplaceChange}
            placeholder={t("editor.find.replacePlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            testID="editor-replace-input"
          />
          {isCompact ? null : (
            <Button
              size="sm"
              variant="ghost"
              onPress={handlers.onReplaceNext}
              disabled={!find.search}
              testID="editor-replace-one"
            >
              {t("editor.find.replace")}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onPress={handlers.onReplaceAll}
            disabled={!find.search}
            testID="editor-replace-all"
          >
            {t("editor.find.replaceAll")}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

function EditorModeView({
  serverId,
  workspaceId,
  workspaceRoot,
  location,
  split,
  modeBarProps,
  toolbarLeadingSlot,
  controllerRef,
  onFileInfo,
  onOpenHistory,
  onViewChanges,
  onRefine,
}: {
  serverId: string;
  workspaceId: string;
  workspaceRoot: string;
  location: WorkspaceFileLocation;
  split: boolean;
  modeBarProps: FileViewModeBarProps | null;
  toolbarLeadingSlot: ReactNode;
  controllerRef: RefObject<EditorController | null>;
  onFileInfo: (info: FilePreviewFileInfo | null) => void;
  onOpenHistory: ((range: FileHistoryRange | null) => void) | null;
  onViewChanges: (() => void) | null;
  /** Opens the Refine job tab for this file; null when unavailable. */
  onRefine: (() => void) | null;
}) {
  const { t } = useTranslation();
  const path = location.path;
  const {
    buffer,
    onDirtyChanged,
    onDocSync,
    save,
    revert,
    reloadFromConflict,
    overwriteFromConflict,
    dismissConflict,
    reloadFromDisk,
    keepMyChanges,
    dismissDiskChange,
  } = useEditorBuffer({ serverId, workspaceId, workspaceRoot, path, controllerRef });

  const [find, setFind] = useState<FindStripState>(INITIAL_FIND_STATE);
  const [matchInfo, setMatchInfo] = useState<EditorMatchInfo | null>(null);
  const [cursor, setCursor] = useState<EditorCursorPosition | null>(null);
  const byteSize = useBufferByteSize(buffer);

  const wordWrap = useEditorPrefsStore((state) => state.wordWrap);
  const livePreview = useEditorPrefsStore((state) => state.markdownLivePreview);
  const toggleLivePreview = useEditorPrefsStore((state) => state.toggleMarkdownLivePreview);
  const toggleWordWrap = useEditorPrefsStore((state) => state.toggleWordWrap);
  // Only the buttons with a real binding get a hint; revert, history, outline
  // and wrap have none, and inventing one would be a lie the tooltip cannot
  // honour.
  const shortcutHints = useEditorShortcutHints();
  // The File Editor section of the user's effective shortcuts, as a CM6 keymap.
  // This is what makes those rows rebindable rather than merely listed.
  const editorKeyBindings = useEditorKeyBindings();

  const { settings } = useAppSettings();
  const rulerColumn = resolveRulerColumn(settings);

  const applyFind = useCallback(
    (next: FindStripState) => {
      setFind(next);
      const controller = controllerRef.current;
      if (!controller) {
        return;
      }
      if (!next.open || !next.search) {
        controller.setFind(null);
        return;
      }
      controller.setFind({
        search: next.search,
        replace: next.replace,
        caseSensitive: next.caseSensitive,
        wholeWord: next.wholeWord,
        regexp: next.regexp,
      });
    },
    [controllerRef],
  );

  const findRef = useRef(find);
  findRef.current = find;

  // Bumped on every open so the strip re-focuses and selects its term even when
  // it was already on screen — Mod-F is "take me to the find box", not just
  // "show it".
  const [findFocusSignal, setFindFocusSignal] = useState(0);

  const openFind = useCallback(() => {
    applyFind({ ...findRef.current, open: true });
    setFindFocusSignal((value) => value + 1);
    const controller = controllerRef.current;
    if (!controller) {
      return;
    }
    // Seed the term from the selection, the way every IDE does. The read is a
    // promise (the native host round-trips the webview), so the strip opens
    // first and the term lands a tick later rather than the open waiting on a
    // bridge that may be gone.
    void (async () => {
      // A dead or closed editor cannot answer; that is not a failure, the strip
      // is already open with whatever it had.
      const selection = await controller.getSelection().catch(() => null);
      const seed = selection ? resolveFindSeed(selection) : null;
      if (seed === null || seed === findRef.current.search) {
        return;
      }
      applyFind({ ...findRef.current, open: true, search: seed });
      setFindFocusSignal((value) => value + 1);
    })();
  }, [applyFind, controllerRef]);

  const closeFind = useCallback(() => {
    applyFind({ ...findRef.current, open: false });
    setMatchInfo(null);
    controllerRef.current?.focus();
  }, [applyFind, controllerRef]);

  // The live buffer, for anything that outlines or indexes what is on screen
  // rather than what is on disk. Markdown's outline is built from this.
  const readDocument = useCallback(
    async () => (await controllerRef.current?.getDoc()) ?? "",
    [controllerRef],
  );

  // The formatting toolbar runs the same commands the keymap does, through the
  // controller. Nothing is tracked here: the command owns whether it applies.
  const handleMarkdownCommand = useCallback(
    (command: MarkdownCommandName) => {
      controllerRef.current?.runMarkdownCommand(command);
    },
    [controllerRef],
  );

  const [goToLineOpen, setGoToLineOpen] = useState(false);
  const openGoToLine = useCallback(() => setGoToLineOpen(true), []);
  const closeGoToLine = useCallback(() => {
    setGoToLineOpen(false);
    controllerRef.current?.focus();
  }, [controllerRef]);
  const handleGoToLineSubmit = useCallback(
    (line: number) => {
      setGoToLineOpen(false);
      // goToLine also refocuses the editor at the target line.
      controllerRef.current?.goToLine(line);
    },
    [controllerRef],
  );

  // Read through a ref so the reveal callback stays stable: it is invoked from
  // `onReady`, which fires long after the props it needs were captured.
  const locationRef = useRef(location);
  locationRef.current = location;

  // A caller that knows the extent of what it sent you to gets the span
  // selected; one that only knows a line gets the cursor. Both focus.
  const revealTarget = useCallback((controller: EditorController): void => {
    const { lineStart, lineEnd } = locationRef.current;
    if (!lineStart) return;
    if (lineEnd && lineEnd >= lineStart) {
      controller.selectLines(lineStart, lineEnd);
      return;
    }
    controller.goToLine(lineStart);
  }, []);

  // Every time an editor becomes available, honour the location it was opened
  // at — not just the first one. The editor remounts whenever the file changes
  // (the buffer goes through a loading state), so a once-only guard here meant
  // the *second* file you jumped to opened at line 1 with nothing focused.
  const handleReady = useCallback(
    (controller: EditorController) => {
      controllerRef.current = controller;
      revealTarget(controller);
    },
    [controllerRef, revealTarget],
  );

  // Re-opening the *same* file at a new target (e.g. "Edit" on a diff line, or
  // another finding in the file already on screen) updates the tab's location
  // in place without remounting, so nothing above fires; jump the live editor.
  const locationLineStart = location.lineStart;
  const locationLineEnd = location.lineEnd;
  useEffect(() => {
    if (!locationLineStart) return;
    const controller = controllerRef.current;
    if (controller) revealTarget(controller);
  }, [controllerRef, locationLineStart, locationLineEnd, path, revealTarget]);

  const handleSavePress = useCallback(() => {
    void save();
  }, [save]);

  const handleRevertPress = useCallback(() => {
    void revert();
  }, [revert]);

  const handleFindKeyPress = useCallback(
    (event: { nativeEvent: { key: string } }) => {
      if (event.nativeEvent.key === "Escape") {
        closeFind();
      }
    },
    [closeFind],
  );

  const handleFindNext = useCallback(() => controllerRef.current?.findNext(), [controllerRef]);
  const handleFindPrevious = useCallback(
    () => controllerRef.current?.findPrevious(),
    [controllerRef],
  );
  const handleReplaceNext = useCallback(
    () => controllerRef.current?.replaceNext(),
    [controllerRef],
  );
  const handleReplaceAll = useCallback(() => controllerRef.current?.replaceAll(), [controllerRef]);

  const handleToggleReplaceOpen = useCallback(() => {
    applyFind({ ...findRef.current, replaceOpen: !findRef.current.replaceOpen });
  }, [applyFind]);
  const handleSearchChange = useCallback(
    (search: string) => applyFind({ ...findRef.current, search }),
    [applyFind],
  );
  const handleReplaceChange = useCallback(
    (replace: string) => applyFind({ ...findRef.current, replace }),
    [applyFind],
  );
  const handleToggleCase = useCallback(() => {
    applyFind({ ...findRef.current, caseSensitive: !findRef.current.caseSensitive });
  }, [applyFind]);
  const handleToggleWord = useCallback(() => {
    applyFind({ ...findRef.current, wholeWord: !findRef.current.wholeWord });
  }, [applyFind]);
  const handleToggleRegexp = useCallback(() => {
    applyFind({ ...findRef.current, regexp: !findRef.current.regexp });
  }, [applyFind]);

  const handleConflictReload = useCallback(() => {
    void reloadFromConflict();
  }, [reloadFromConflict]);
  const handleConflictOverwrite = useCallback(() => {
    void overwriteFromConflict();
  }, [overwriteFromConflict]);

  const handleDiskReload = useCallback(() => {
    void reloadFromDisk();
  }, [reloadFromDisk]);
  const handleDiskKeepMine = useCallback(() => {
    void keepMyChanges();
  }, [keepMyChanges]);

  // The outline and go-to-definition both ride on `code.*`, so they share the
  // code-index gate. Absent capability hides both outright — no fallback path.
  const { hasCodeIndex, hasLsp, canGoToDefinition } = useDefinitionSources(serverId);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const openOutline = useCallback(() => setOutlineOpen(true), []);
  const closeOutline = useCallback(() => setOutlineOpen(false), []);
  // Shared by the outline and by a definition that lands in this same file:
  // both mean "move the caret", never "open a tab".
  const jumpToLineInBuffer = useCallback(
    (line: number) => {
      controllerRef.current?.goToLine(line);
    },
    [controllerRef],
  );

  const { workspaceId: paneWorkspaceId, openFileInWorkspace } = usePaneContext();
  const paneWorkspaceRoot = useWorkspaceDirectory(serverId, paneWorkspaceId);
  // "main", not "side": following a definition is continuing to read the same
  // thread of code, so it belongs in the pane you are already reading in.
  //
  // The target arrives relative to THIS tab's workspace (or absolute when the
  // definition lives outside it), and `openFileInWorkspace` anchors a relative
  // path to the PANE's workspace. Those are the same root for an ordinary tab,
  // and different ones for a linked project's file (gated-multi-root), where a
  // relative path would resolve against the wrong tree. Send an absolute path in
  // that case and let the cross-project open gate re-derive the owning workspace.
  const handleOpenDefinitionTarget = useCallback(
    (target: GoToDefinitionTarget) => {
      const targetPath =
        paneWorkspaceRoot === workspaceRoot || isAbsolutePath(target.path)
          ? target.path
          : `${workspaceRoot}/${target.path}`;
      openFileInWorkspace({
        location: { path: targetPath, lineStart: target.line },
        disposition: "main",
      });
    },
    [openFileInWorkspace, paneWorkspaceRoot, workspaceRoot],
  );
  const {
    pickerName: definitionPickerName,
    candidates: definitionCandidates,
    goToDefinition,
    closePicker: closeDefinitionPicker,
    selectCandidate: selectDefinitionCandidate,
  } = useGoToDefinition({
    serverId,
    workspaceRoot,
    path,
    controllerRef,
    onJumpInFile: jumpToLineInBuffer,
    onOpenTarget: handleOpenDefinitionTarget,
    lspEnabled: hasLsp,
    cursor,
  });
  const resolveHover = useCodeHover({
    serverId,
    workspaceRoot,
    path,
    controllerRef,
    enabled: hasLsp,
  });
  // Mirrors the buffer to the daemon so the servers re-lint as you type, and reads back
  // what they found. `buffer.draft` is already the editor's debounced doc-sync, which is
  // why nothing here re-debounces.
  const diagnostics = useCodeDocument({
    serverId,
    workspaceRoot,
    path,
    text: mirrorableText(buffer),
    enabled: hasLsp,
  });
  const problems = useDismissibleProblems(diagnostics);
  const rename = useRenameSymbol({
    serverId,
    workspaceId,
    path,
    controllerRef,
    cursor,
    enabled: hasLsp,
  });
  // Opens a results tab rather than answering in place: a reference list is a surface you
  // navigate from, and the search must survive visiting its own hits.
  const findReferences = useFindReferences({
    serverId,
    workspaceId,
    path,
    controllerRef,
    cursor,
    enabled: hasLsp,
  });

  // The keystroke reaches the editor even when the menu item is hidden, so the
  // capability gate has to be re-applied here rather than only on the item.
  const handleGoToDefinition = useCallback(() => {
    if (!canGoToDefinition) {
      return;
    }
    void goToDefinition();
  }, [canGoToDefinition, goToDefinition]);

  // Same shape for the two language-server actions, which are null when no
  // server covers the file: the editor is always handed a callback, and the
  // no-op inside it is the gate. Wiring `undefined` instead would make the key
  // fall through to CodeMirror's own keymap, which is a different behaviour on a
  // file that merely has no server yet.
  const renameRequest = rename.request;
  const handleFindReferencesShortcut = useCallback(() => findReferences?.(), [findReferences]);
  const handleRenameSymbolShortcut = useCallback(() => renameRequest?.(), [renameRequest]);

  // Git investigation stays selection-aware from the toolbar rather than moving
  // into the right-click menu: selecting lines and pressing History is the same
  // gesture in one fewer step, and the sheet shows the scope with a way out.
  const handleOpenHistory = useMemo(() => {
    if (!onOpenHistory) {
      return null;
    }
    return () => {
      void openHistoryForSelection(controllerRef.current, onOpenHistory);
    };
  }, [controllerRef, onOpenHistory]);

  // The editor's right-click menu. The anchor doubles as the open flag; the
  // core has already moved the caret to the click by the time this fires, so
  // every action below reads the selection it should act on.
  const [editorMenuAnchor, setEditorMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const closeEditorMenu = useCallback(() => setEditorMenuAnchor(null), []);
  // Supplying the handler at all is what suppresses the platform menu, so the
  // web gate lives here rather than at the call site — native must receive
  // undefined and keep its own long-press text menu.
  const handleEditorContextMenu = useMemo(
    () => (isWeb ? (point: { x: number; y: number }) => setEditorMenuAnchor(point) : undefined),
    [],
  );
  const handleGoToDefinitionFromMenu = useCallback(() => {
    handleGoToDefinition();
  }, [handleGoToDefinition]);
  const {
    copy: handleEditorCopy,
    cut: handleEditorCut,
    paste: handleEditorPaste,
    selectAll: handleEditorSelectAll,
    selectLine: handleEditorSelectLine,
  } = useEditorClipboardActions(controllerRef);

  // No AI action edits *in this editor*. The one AI entry point in the toolbar
  // is Refine, and it opens a job tab that can only propose — see
  // FileAiToolbarGroup. The `@/editor/refactor-*` modules stay on disk but
  // remain unwired: they hand a prompt to a full agent with complete tool
  // access and no diff, which is exactly what Refine replaced.

  // Split-view sync. Both sides report only user-driven scrolls (their own
  // programmatic scrolls are suppressed at the source); the gate keeps a
  // single driver at a time so the panes cannot ping-pong.
  const previewSyncRef = useRef<FilePreviewSyncHandle | null>(null);
  const syncGateRef = useRef(createSplitSyncGate());

  const handleEditorScrolled = useCallback((metrics: EditorScrollMetrics) => {
    if (!syncGateRef.current.claim("editor")) {
      return;
    }
    previewSyncRef.current?.scrollToFraction(
      scrollFraction({
        scrollTop: metrics.scrollTop,
        contentHeight: metrics.scrollHeight,
        clientHeight: metrics.clientHeight,
      }),
    );
  }, []);

  const handleEditorPointerSelect = useCallback((select: EditorPointerSelect) => {
    syncGateRef.current.claim("editor");
    const preview = previewSyncRef.current;
    if (!preview) {
      return;
    }
    const previewMetrics = preview.getMetrics();
    const contentY = lineToTargetContentY({
      line: select.line,
      lineCount: select.lineCount,
      targetContentHeight: previewMetrics.contentHeight,
    });
    preview.scrollToContentY(contentY, select.viewportOffsetY);
  }, []);

  const handlePreviewScrolled = useCallback(
    (metrics: PreviewScrollMetrics) => {
      if (!syncGateRef.current.claim("preview")) {
        return;
      }
      controllerRef.current?.scrollToFraction?.(scrollFraction(metrics));
    },
    [controllerRef],
  );

  const handlePreviewPointerDown = useCallback(
    (pointer: PreviewPointerDown) => {
      syncGateRef.current.claim("preview");
      const controller = controllerRef.current;
      if (!controller?.scrollToLineAtOffset) {
        return;
      }
      const editorMetrics = controller.getScrollMetrics?.();
      if (!editorMetrics) {
        return;
      }
      const line = contentFractionToLine(
        contentYFraction(pointer.contentY, pointer.contentHeight),
        editorMetrics.lineCount,
      );
      controller.scrollToLineAtOffset(line, pointer.viewportOffsetY);
    },
    [controllerRef],
  );

  const splitRatio = useFileViewStore((state) => state.splitRatio);
  const setSplitRatio = useFileViewStore((state) => state.setSplitRatio);
  const splitSizes = useMemo(() => [splitRatio, 1 - splitRatio], [splitRatio]);
  const handleResizeSplit = useCallback(
    (_groupId: string, sizes: number[]) => {
      const editorShare = sizes[0];
      if (typeof editorShare === "number") {
        setSplitRatio(editorShare);
      }
    },
    [setSplitRatio],
  );
  const editorPaneStyle = useMemo(
    () => [styles.splitPane, inlineUnistylesStyle({ flexGrow: splitRatio })],
    [splitRatio],
  );
  const previewPaneStyle = useMemo(
    () => [styles.splitPane, inlineUnistylesStyle({ flexGrow: 1 - splitRatio })],
    [splitRatio],
  );

  const draftOverride = useDraftOverride({ serverId, workspaceId, path });

  const findHandlers = useMemo<EditorFindStripHandlers>(
    () => ({
      onToggleReplaceOpen: handleToggleReplaceOpen,
      onSearchChange: handleSearchChange,
      onReplaceChange: handleReplaceChange,
      onToggleCase: handleToggleCase,
      onToggleWord: handleToggleWord,
      onToggleRegexp: handleToggleRegexp,
      onFindNext: handleFindNext,
      onFindPrevious: handleFindPrevious,
      onReplaceNext: handleReplaceNext,
      onReplaceAll: handleReplaceAll,
      onKeyPress: handleFindKeyPress,
      onClose: closeFind,
    }),
    [
      closeFind,
      handleFindKeyPress,
      handleFindNext,
      handleFindPrevious,
      handleReplaceAll,
      handleReplaceChange,
      handleReplaceNext,
      handleSearchChange,
      handleToggleCase,
      handleToggleRegexp,
      handleToggleReplaceOpen,
      handleToggleWord,
    ],
  );

  if (!buffer || buffer.status === "loading") {
    return (
      <View style={styles.container} testID="workspace-file-tab-pane">
        <View style={styles.centerState}>
          <ThemedLoadingSpinner uniProps={foregroundMutedIconColorMapping} />
          <Text style={styles.mutedText}>{t("editor.loading")}</Text>
        </View>
      </View>
    );
  }

  if (buffer.status === "error" || !buffer.baseline) {
    return (
      <View style={styles.container} testID="workspace-file-tab-pane">
        <View style={styles.previewToolbar}>
          {toolbarLeadingSlot}
          <View style={styles.toolbarSpacer} />
          {modeBarProps ? <FileViewModeBar {...modeBarProps} /> : null}
        </View>
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{buffer.error ?? t("editor.loadFailed")}</Text>
        </View>
      </View>
    );
  }

  const editorNode = (
    <ThemedCodeEditor
      path={path}
      initialDoc={buffer.draft ?? buffer.baseline.content}
      cleanDoc={buffer.baseline.content}
      wordWrap={wordWrap}
      markdownLivePreview={livePreview}
      rulerColumn={rulerColumn}
      docSyncDebounceMs={split ? SPLIT_DOC_SYNC_DEBOUNCE_MS : undefined}
      onDirtyChanged={onDirtyChanged}
      onDocSync={onDocSync}
      onMatchInfo={setMatchInfo}
      onCursorMoved={setCursor}
      keyBindings={editorKeyBindings}
      onSaveShortcut={handleSavePress}
      onFindShortcut={openFind}
      onCloseFindShortcut={closeFind}
      onGoToLineShortcut={openGoToLine}
      onGoToDefinitionShortcut={handleGoToDefinition}
      onFindReferencesShortcut={handleFindReferencesShortcut}
      onRenameSymbolShortcut={handleRenameSymbolShortcut}
      onScrolled={split ? handleEditorScrolled : undefined}
      onPointerSelect={split ? handleEditorPointerSelect : undefined}
      onContextMenu={handleEditorContextMenu}
      hoverProvider={resolveHover}
      diagnostics={diagnostics}
      onReady={handleReady}
    />
  );

  return (
    <View style={styles.container} testID="workspace-file-tab-pane">
      <View style={styles.toolbar}>
        <ToolbarIconButton
          label={t("editor.save")}
          testID="editor-save"
          Icon={ThemedSave}
          onPress={handleSavePress}
          disabled={!buffer.dirty || buffer.saving || buffer.conflict !== null}
          loading={buffer.saving}
          shortcut={shortcutHints.save}
        />
        <ToolbarIconButton
          label={t("editor.revert")}
          testID="editor-revert"
          Icon={ThemedUndo2}
          onPress={handleRevertPress}
          disabled={!buffer.dirty || buffer.saving}
        />
        <FileGitToolbarGroup
          onOpenHistory={handleOpenHistory}
          onViewChanges={onViewChanges}
          showLeadingSeparator
        />
        <FileAiToolbarGroup onRefine={onRefine} showLeadingSeparator />
        <ToolbarLeadingSlot>{toolbarLeadingSlot}</ToolbarLeadingSlot>
        {/* Save/revert/history act on the FILE; outline and find navigate WITHIN
            it. The separator is the line between those two jobs, and both groups
            stay left where the eye starts. */}
        <ToolbarSeparator />
        {hasCodeIndex ? (
          <ToolbarIconButton
            label={t("codeOutline.open")}
            testID="editor-outline-toggle"
            Icon={ThemedList}
            onPress={openOutline}
          />
        ) : null}
        <ToolbarIconButton
          label={t("editor.find.open")}
          testID="editor-find-toggle"
          Icon={ThemedSearch}
          onPress={find.open ? closeFind : openFind}
          selected={find.open}
          shortcut={shortcutHints.find}
        />
        <View style={styles.toolbarSpacer} />
        {/* Word wrap is a view setting, so it lives with the view-mode bar. */}
        <ToolbarIconButton
          label={t("editor.wordWrap")}
          testID="editor-wordwrap-toggle"
          Icon={ThemedWrapText}
          onPress={toggleWordWrap}
          selected={wordWrap}
        />
        {modeBarProps ? <FileViewModeBar {...modeBarProps} /> : null}
      </View>

      {find.open ? (
        <EditorFindStrip
          find={find}
          matchInfo={matchInfo}
          handlers={findHandlers}
          focusSignal={findFocusSignal}
        />
      ) : null}

      <EditorSyncBanners
        diskChange={buffer.diskChange}
        hasConflict={buffer.conflict !== null}
        onDiskReload={handleDiskReload}
        onDiskKeepMine={handleDiskKeepMine}
        onDiskDismiss={dismissDiskChange}
        onConflictReload={handleConflictReload}
        onConflictOverwrite={handleConflictOverwrite}
        onConflictDismiss={dismissConflict}
      />

      {/* Directly above the editing surface in both modes, and only for markdown.
          On a phone it is the only way to reach these commands at all. */}
      <MarkdownToolbarForPath
        path={path}
        onRun={handleMarkdownCommand}
        livePreview={livePreview}
        onToggleLivePreview={toggleLivePreview}
      />

      {split ? (
        <View style={styles.splitRow}>
          <View style={editorPaneStyle} testID="file-split-editor">
            {editorNode}
          </View>
          <ResizeHandle
            direction="horizontal"
            groupId="file-tab-split"
            index={0}
            sizes={splitSizes}
            onResizeSplit={handleResizeSplit}
          />
          <View style={previewPaneStyle} testID="file-split-preview">
            <FilePreview
              serverId={serverId}
              workspaceRoot={workspaceRoot}
              location={locationWithoutLines(location)}
              wrapLines={wordWrap}
              contentOverride={draftOverride}
              onFileInfo={onFileInfo}
              syncRef={previewSyncRef}
              onScrolledSync={handlePreviewScrolled}
              onPointerDownSync={handlePreviewPointerDown}
            />
          </View>
        </View>
      ) : (
        <View style={styles.editorHost}>{editorNode}</View>
      )}

      <EditorDiagnosticsPanel
        visible={problems.visible}
        diagnostics={diagnostics}
        onSelectLine={jumpToLineInBuffer}
        onDismiss={problems.dismiss}
      />

      <EditorStatusBar
        path={path}
        byteSize={byteSize}
        eol={buffer.baseline.eol}
        isText
        cursor={cursor}
        diagnostics={diagnostics}
      />

      {hasCodeIndex ? (
        <>
          <EditorOutlineSheet
            serverId={serverId}
            workspaceRoot={workspaceRoot}
            path={path}
            visible={outlineOpen}
            onClose={closeOutline}
            onSelectLine={jumpToLineInBuffer}
            getDocument={readDocument}
          />
          <DefinitionPickerDialog
            name={definitionPickerName}
            candidates={definitionCandidates}
            onClose={closeDefinitionPicker}
            onSelect={selectDefinitionCandidate}
          />
        </>
      ) : null}

      <EditorContextMenu
        anchor={editorMenuAnchor}
        onClose={closeEditorMenu}
        cursor={cursor}
        canGoToDefinition={canGoToDefinition}
        onGoToDefinition={handleGoToDefinitionFromMenu}
        onFindReferences={findReferences}
        onRenameSymbol={rename.request}
        onCut={handleEditorCut}
        onCopy={handleEditorCopy}
        onPaste={handleEditorPaste}
        onSelectAll={handleEditorSelectAll}
        onSelectLine={handleEditorSelectLine}
      />

      <RenameSymbolDialog
        visible={rename.dialogOpen}
        symbol={rename.symbol}
        onClose={rename.closeDialog}
        onSubmit={rename.submit}
      />

      <GoToLineDialog
        visible={goToLineOpen}
        onClose={closeGoToLine}
        onSubmit={handleGoToLineSubmit}
      />
    </View>
  );
}

/**
 * Open git investigation scoped to whatever is selected right now, or to the
 * whole file when nothing is. A failed selection read is not worth an error —
 * the whole file is always a valid, useful answer.
 */
async function openHistoryForSelection(
  controller: EditorController | null,
  onOpenHistory: (range: FileHistoryRange | null) => void,
): Promise<void> {
  if (!controller) {
    onOpenHistory(null);
    return;
  }
  try {
    const selection = await controller.getSelection();
    onOpenHistory(
      selection.isEmpty ? null : { startLine: selection.lineStart, endLine: selection.lineEnd },
    );
  } catch {
    onOpenHistory(null);
  }
}

/**
 * The split preview follows the editor, not a search hit: strip lineStart so
 * the preview renders markdown normally instead of the line-highlight view.
 */
function locationWithoutLines(location: WorkspaceFileLocation): WorkspaceFileLocation {
  return { path: location.path };
}

/**
 * Workspace-relative -> absolute, for the Refine working set. Refine addresses
 * every file by absolute path because a set legitimately spans the repo and the
 * home directory (a context set includes `~/.claude/CLAUDE.md`).
 */
function joinWorkspacePath(workspaceRoot: string, path: string): string {
  const root = workspaceRoot.replace(/[/\\]$/, "");
  return root ? `${root}/${path}` : path;
}

function resolveEffectiveMode(input: {
  mode: FileViewMode;
  editorAllowed: boolean;
  splitAllowed: boolean;
}): FileViewMode {
  if (!input.editorAllowed) {
    return "preview";
  }
  if (input.mode === "split" && !input.splitAllowed) {
    return "editor";
  }
  return input.mode;
}

export function FileTabPane({
  serverId,
  workspaceId,
  workspaceRoot,
  location,
  editGate,
  toolbarLeadingSlot = null,
}: {
  serverId: string;
  workspaceId: string;
  workspaceRoot: string;
  location: WorkspaceFileLocation;
  /** How editing this file is gated (in-/linked-project = free; else warns). */
  editGate: EditGate;
  /** Host-supplied toolbar controls, placed just after the file's own jobs. Lets
   *  a surface that opens files for a purpose (Context Management) put its own
   *  action in the existing bar instead of stacking a second one above it. */
  toolbarLeadingSlot?: ReactNode;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const persistenceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });

  // Editing an out-of-project file is no longer gated behind a confirm dialog —
  // it just works, with a persistent red banner making the trade-off plain (the
  // file is outside this project, so its edits are not part of the agent's
  // context and not part of this workspace's Git changes). Rendered formats
  // (markdown, images, binaries) still open in preview; plain text and code
  // open straight in the editor, in-project or not.
  const { mode, setMode } = useFileViewMode({
    persistenceKey,
    path: location.path,
    defaultMode: defaultFileViewMode(location.path),
  });
  const canEdit = useTextEditorFeature(serverId);
  const isCompact = useIsCompactFormFactor();
  const [fileInfo, setFileInfo] = useState<FilePreviewFileInfo | null>(null);
  const controllerRef = useRef<EditorController | null>(null);

  // Until the first read reports back, trust the remembered mode: a file that
  // was in editor view last time is a text file until proven otherwise.
  const editorAllowed = canEdit && (fileInfo === null || fileInfo.kind === "text");
  const splitAllowed = editorAllowed && isWeb && !isCompact;
  const effectiveMode = resolveEffectiveMode({
    mode,
    editorAllowed,
    splitAllowed,
  });

  const otherProjectName = editGate.kind === "other-project" ? editGate.projectName : null;

  const handleModeChange = useCallback(
    (next: FileViewMode) => {
      const controller = controllerRef.current;
      if (next === "preview" && controller) {
        // The doc-sync mirror is debounced; flush the real buffer into the
        // draft so the preview shows the latest keystrokes, not stale ones.
        const key = buildEditorBufferKey({ serverId, workspaceId, path: location.path });
        void controller
          .getDoc()
          .then((doc) => {
            const buffer = useEditorBufferStore.getState().buffers[key];
            if (buffer?.dirty) {
              useEditorBufferStore.getState().setDraft(key, doc);
            }
            return undefined;
          })
          .catch(() => undefined)
          .finally(() => {
            setMode(next);
          });
        return;
      }
      setMode(next);
    },
    [location.path, serverId, setMode, workspaceId],
  );

  const modeBarProps = useMemo<FileViewModeBarProps | null>(
    () =>
      editorAllowed
        ? { mode: effectiveMode, showSplit: splitAllowed, onChange: handleModeChange }
        : null,
    [editorAllowed, effectiveMode, handleModeChange, splitAllowed],
  );

  // Git file investigation — history, per-commit diffs, blame, origin commit.
  // No per-provider rollout to gate on (it is git, not an agent): the host
  // either serves the RPCs or it doesn't. It is limited to in-project files
  // because the queries run `git` in this workspace with a workspace-relative
  // pathspec — a linked or outside-project file belongs to a different repo, so
  // asking here would be a question about the wrong tree.
  const hostServesGitFileHistory = useGitFileHistoryFeature(serverId);
  const gitFileHistorySupported = hostServesGitFileHistory && editGate.kind === "free";
  // Opens a tab, not an overlay: reading history means walking commits with the
  // diff beside you, which wants the whole frame and wants to stay open while
  // you go back to the code.
  const openHistory = useCallback(
    (range: FileHistoryRange | null) => {
      openFileHistoryTab({
        serverId,
        workspaceId,
        path: location.path,
        ...(range ? { startLine: range.startLine, endLine: range.endLine } : {}),
      });
    },
    [location.path, serverId, workspaceId],
  );
  const onOpenHistory = gitFileHistorySupported ? openHistory : null;

  // "View changes" sits beside history because it answers the neighbouring
  // question — not what this file has been, but what it is right now against the
  // base. Same in-project restriction: an outside file's diff belongs to another
  // repo. Offered only while the file is actually in the diff, so the button
  // never sends the user to a Changes tab that does not list it.
  const changedPaths = useChangedFilePaths({
    serverId,
    workspaceId,
    cwd: workspaceRoot,
    enabled: editGate.kind === "free",
  });
  const onViewChanges = useMemo(() => {
    if (editGate.kind !== "free" || !changedPaths.has(location.path)) {
      return null;
    }
    return () => {
      revealFileInChanges({ serverId, cwd: workspaceRoot, path: location.path });
    };
  }, [changedPaths, editGate.kind, location.path, serverId, workspaceRoot]);

  // Refine — the AI rewrite, as a reviewable job in its own tab.
  //
  // In-project only, for the same reason as history and changes: the job runs
  // against this workspace's root with a workspace-relative path, so a linked
  // or outside-project file would be a question about the wrong tree.
  //
  // A dirty buffer blocks entry. Refine pins its base from DISK, so starting it
  // over unsaved edits would show a diff against something the user is not
  // looking at, and accepting it would write a document those edits were never
  // part of. Save or revert first — the toast says so rather than silently
  // picking one.
  const hasRefine = useRefineFeature(serverId);
  const onRefine = useMemo(() => {
    // Prose and instruction files only (`isRefinableDocument`): Refine is a
    // whole-document text rewrite with no symbol awareness, so over source code
    // it would produce a plausible diff that silently breaks a call site. That
    // is the objection that pulled the old "Refactor with AI" button, and a
    // review loop does not answer it — nobody spots a broken import in a
    // 400-line diff.
    if (!hasRefine || !editorAllowed || editGate.kind !== "free") {
      return null;
    }
    if (!isRefinableDocument(location.path)) {
      return null;
    }
    return () => {
      const bufferKey = buildEditorBufferKey({ serverId, workspaceId, path: location.path });
      if (useEditorBufferStore.getState().buffers[bufferKey]?.dirty) {
        toast.error(t("refine.saveFirst"));
        return;
      }
      // From the editor the working set is this one file: the tab is the place
      // to widen it, since that is where the blast radius is visible.
      openRefineTab({
        serverId,
        workspaceId,
        paths: [joinWorkspacePath(workspaceRoot, location.path)],
      });
    };
  }, [
    editGate.kind,
    editorAllowed,
    hasRefine,
    location.path,
    serverId,
    t,
    toast,
    workspaceId,
    workspaceRoot,
  ]);

  const content =
    effectiveMode === "preview" ? (
      <PreviewOnlyView
        serverId={serverId}
        workspaceId={workspaceId}
        workspaceRoot={workspaceRoot}
        location={location}
        modeBarProps={modeBarProps}
        toolbarLeadingSlot={toolbarLeadingSlot}
        fileInfo={fileInfo}
        onFileInfo={setFileInfo}
        onOpenHistory={onOpenHistory}
        onViewChanges={onViewChanges}
        onRefine={onRefine}
      />
    ) : (
      <EditorModeView
        serverId={serverId}
        workspaceId={workspaceId}
        workspaceRoot={workspaceRoot}
        location={location}
        split={effectiveMode === "split"}
        modeBarProps={modeBarProps}
        toolbarLeadingSlot={toolbarLeadingSlot}
        controllerRef={controllerRef}
        onFileInfo={setFileInfo}
        onOpenHistory={onOpenHistory}
        onViewChanges={onViewChanges}
        onRefine={onRefine}
      />
    );

  if (editGate.kind === "free") {
    return content;
  }
  return (
    <View style={styles.outOfProjectWrap}>
      <OutOfProjectBanner projectName={otherProjectName} />
      {content}
    </View>
  );
}

// A file opened from another project — or from no project at all — shows a
// persistent, red banner across the top of the pane: editing works, but this
// is a constant reminder that the file is outside this workspace, so its edits
// are not part of the agent's context and not part of this workspace's Git
// changes. `projectName` is null for a file outside every project.
function OutOfProjectBanner({ projectName }: { projectName: string | null }) {
  const { t } = useTranslation();
  return (
    <View style={styles.outOfProjectBanner} testID="file-out-of-project-banner">
      <Text style={styles.outOfProjectText} numberOfLines={2}>
        {projectName
          ? t("editor.outOfProject.badge", { project: projectName })
          : t("editor.outOfProject.badgeNoProject")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => {
  return {
    container: {
      flex: 1,
      minHeight: 0,
      backgroundColor: theme.colors.surface0,
    },
    outOfProjectWrap: {
      flex: 1,
      minHeight: 0,
    },
    outOfProjectBanner: {
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: theme.spacing[3],
      paddingVertical: theme.spacing[1],
      backgroundColor: theme.colors.statusDangerSurface,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.statusDanger,
    },
    outOfProjectText: {
      color: theme.colors.statusDanger,
      fontSize: theme.fontSize.xs,
      fontWeight: "600",
      textAlign: "center",
    },
    centerState: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: theme.spacing[2],
      padding: theme.spacing[4],
    },
    mutedText: {
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.sm,
    },
    errorText: {
      color: theme.colors.destructive,
      fontSize: theme.fontSize.sm,
      textAlign: "center",
    },
    toolbar: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      paddingHorizontal: theme.spacing[2],
      paddingVertical: theme.spacing[1],
      // Pinned so every pane toolbar (this, the preview variant below, and the
      // visualizer bar) shares one height and lines up across a split.
      minHeight: PANE_TOOLBAR_HEIGHT,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    previewToolbar: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      paddingHorizontal: theme.spacing[2],
      paddingVertical: theme.spacing[1],
      // Keep the preview toolbar at full height even when the mode bar is
      // hidden (images, binaries, loading) so the chrome doesn't jump.
      minHeight: PANE_TOOLBAR_HEIGHT,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    toolbarSpacer: {
      flex: 1,
    },
    iconButton: {
      padding: theme.spacing[1],
      borderRadius: 6,
    },
    iconButtonActive: {
      backgroundColor: theme.colors.surfaceHover,
    },
    findStrip: {
      gap: theme.spacing[1],
      paddingHorizontal: theme.spacing[2],
      paddingVertical: theme.spacing[1],
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    findRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[1],
    },
    findInput: {
      flex: 1,
      minWidth: 80,
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
    matchCount: {
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.xs,
      fontVariant: ["tabular-nums"],
    },
    findToggle: {
      paddingHorizontal: theme.spacing[1],
      paddingVertical: 2,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: "transparent",
    },
    findToggleActive: {
      borderColor: theme.colors.borderAccent,
      backgroundColor: theme.colors.surface2,
    },
    findToggleText: {
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.xs,
      fontFamily: theme.fontFamily.mono,
    },
    findToggleTextActive: {
      color: theme.colors.foreground,
    },
    // Both sync banners say the same kind of thing — "the file on disk and your
    // buffer disagree, and you must choose" — so both carry the semantic
    // warning tint rather than reading as neutral chrome. `statusWarningSurface`
    // is alpha, so it tints whichever surface the active theme provides instead
    // of replacing it, and it is already calibrated per scheme (heavier on dark,
    // lighter on near-white). See docs/design.md.
    conflictBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      paddingHorizontal: theme.spacing[2],
      paddingVertical: theme.spacing[1],
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.statusWarningMuted,
      backgroundColor: theme.colors.statusWarningSurface,
    },
    conflictText: {
      flex: 1,
      color: theme.colors.foreground,
      fontSize: theme.fontSize.sm,
    },
    editorHost: {
      flex: 1,
      minHeight: 0,
    },
    splitRow: {
      flex: 1,
      minHeight: 0,
      flexDirection: "row",
      alignItems: "stretch",
    },
    splitPane: {
      flexBasis: 0,
      flexShrink: 1,
      minWidth: 0,
      minHeight: 0,
    },
  };
});
