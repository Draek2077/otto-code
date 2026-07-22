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
  WrapText,
  X,
} from "@/components/icons/material-icons";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ToolbarIconButton } from "@/components/ui/toolbar-icon-button";
import { ToolbarSeparator } from "@/components/ui/toolbar-separator";
import { PANE_TOOLBAR_HEIGHT } from "@/components/ui/control-geometry";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useAppSettings, type AppSettings } from "@/hooks/use-settings";
import { isWeb } from "@/constants/platform";
import { CodeEditor } from "@/editor/code-editor";
import type {
  CodeEditorProps,
  EditorController,
  EditorCursorPosition,
  EditorMatchInfo,
  EditorPointerSelect,
  EditorScrollMetrics,
  EditorThemeSpec,
} from "@/editor/editor-contract";
import { buildEditorThemeSpec } from "@/editor/editor-theme";
import type { EditorBufferState } from "@/editor/editor-buffer-state";
import { buildEditorBufferKey, useEditorBufferStore } from "@/editor/editor-buffer-store";
import { useEditorBuffer } from "@/editor/use-editor-buffer";
import { EditorOutlineSheet } from "@/editor/editor-outline-sheet";
import { EditorStatusBar, useBufferByteSize } from "@/editor/editor-status-bar";
import { useEditorPrefsStore } from "@/editor/editor-prefs-store";
import { GoToLineDialog } from "@/editor/go-to-line-dialog";
import { useProjectSearchFeature } from "@/editor/use-project-search-feature";
import { useTextEditorFeature } from "@/editor/use-text-editor-feature";
import { openFileHistoryTab } from "@/git/file-history/open-file-history-tab";
import type { FileHistoryRange } from "@/git/file-history/use-file-history-data";
import { useGitFileHistoryFeature } from "@/git/use-git-file-history-feature";
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
import { useFileViewMode, useFileViewStore, type FileViewMode } from "@/stores/file-view-store";
import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-tabs-store";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { confirmDialog, confirmDialogWithCheckbox } from "@/utils/confirm-dialog";
import type { EditGate } from "@/projects/cross-project-open";
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
const ThemedSearch = withUnistyles(Search);
const ThemedList = withUnistyles(List);
const ThemedHistory = withUnistyles(History);
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
          <ThemedTriangleAlert size={16} uniProps={foregroundMutedIconColorMapping} />
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
          <ThemedTriangleAlert size={16} uniProps={foregroundMutedIconColorMapping} />
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
}) {
  const { t } = useTranslation();
  const draftOverride = useDraftOverride({ serverId, workspaceId, path: location.path });
  // Preview has no selection to scope by, so it always investigates the file.
  const handleOpenHistory = useCallback(() => onOpenHistory?.(null), [onOpenHistory]);

  const [find, setFind] = useState<PreviewFindState>(INITIAL_PREVIEW_FIND_STATE);
  const [matchCount, setMatchCount] = useState(0);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);

  // Find only makes sense over the syntax-highlighted text view: markdown
  // renders to prose with no line mapping to highlight, and images/binaries
  // have no text. The button and strip stay hidden for those.
  const findAvailable = fileInfo?.kind === "text" && !fileInfo.isMarkdown;

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
      <View style={styles.previewToolbar}>
        {toolbarLeadingSlot}
        <View style={styles.toolbarSpacer} />
        {findAvailable ? (
          <ToolbarIconButton
            label={t("editor.find.open")}
            testID="preview-find-toggle"
            Icon={ThemedSearch}
            onPress={find.open ? closeFind : openFind}
            selected={find.open}
          />
        ) : null}
        <FileHistoryToolbarButton supported={onOpenHistory !== null} onPress={handleOpenHistory} />
        {modeBarProps ? <FileViewModeBar {...modeBarProps} /> : null}
      </View>
      {findAvailable && find.open ? (
        <PreviewFindStrip find={find} matchCountLabel={matchCountLabel} handlers={findHandlers} />
      ) : null}
      <FilePreview
        serverId={serverId}
        workspaceRoot={workspaceRoot}
        location={location}
        contentOverride={draftOverride}
        onFileInfo={onFileInfo}
        findQuery={findQuery}
        activeMatchIndex={activeMatchIndex}
        onFindMatchCount={setMatchCount}
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
        />
      ) : null}
    </View>
  );
}

/**
 * The git-investigation entry point, shown once the host serves the local-git
 * file RPCs. A component rather than an inline conditional so both toolbars
 * (editor and preview) spell it the same way.
 */
function FileHistoryToolbarButton({
  supported,
  onPress,
}: {
  supported: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  if (!supported) {
    return null;
  }
  return (
    <ToolbarIconButton
      label={t("gitFileHistory.open")}
      testID="file-history-open"
      Icon={ThemedHistory}
      onPress={onPress}
    />
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

function EditorFindStrip({
  find,
  matchInfo,
  handlers,
}: {
  find: FindStripState;
  matchInfo: EditorMatchInfo | null;
  handlers: EditorFindStripHandlers;
}) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();

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
  const toggleWordWrap = useEditorPrefsStore((state) => state.toggleWordWrap);

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

  const openFind = useCallback(() => {
    applyFind({ ...findRef.current, open: true });
  }, [applyFind]);

  const closeFind = useCallback(() => {
    applyFind({ ...findRef.current, open: false });
    setMatchInfo(null);
    controllerRef.current?.focus();
  }, [applyFind, controllerRef]);

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

  const hasCodeIndex = useProjectSearchFeature(serverId);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const openOutline = useCallback(() => setOutlineOpen(true), []);
  const closeOutline = useCallback(() => setOutlineOpen(false), []);
  const handleOutlineLine = useCallback(
    (line: number) => {
      controllerRef.current?.goToLine(line);
    },
    [controllerRef],
  );

  // Git investigation is selection-aware from the toolbar, not from a
  // right-click menu. Right-click inside the editor belongs to the platform's
  // own edit menu (copy/paste/spellcheck) — and on Electron that menu fires
  // even when the renderer calls preventDefault (see
  // shouldShowDefaultContextMenu in packages/desktop), so an app menu here
  // would double up. Selecting lines and pressing History is the same gesture
  // in one fewer step, and the sheet shows the scope with a way out of it.
  const handleOpenHistory = useCallback(() => {
    if (onOpenHistory) {
      void openHistoryForSelection(controllerRef.current, onOpenHistory);
    }
  }, [controllerRef, onOpenHistory]);

  // No AI action lives in this toolbar. The editor is a plain document editor;
  // an AI rewrite belongs behind a surface that can scope and review it, which
  // is what projects/refine/refine.md is for. The `@/editor/refactor-*` modules
  // stay on disk for that work — they are simply not wired up here.

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
      wordWrap={wordWrap}
      rulerColumn={rulerColumn}
      docSyncDebounceMs={split ? SPLIT_DOC_SYNC_DEBOUNCE_MS : undefined}
      onDirtyChanged={onDirtyChanged}
      onDocSync={onDocSync}
      onMatchInfo={setMatchInfo}
      onCursorMoved={setCursor}
      onSaveShortcut={handleSavePress}
      onFindShortcut={openFind}
      onGoToLineShortcut={openGoToLine}
      onScrolled={split ? handleEditorScrolled : undefined}
      onPointerSelect={split ? handleEditorPointerSelect : undefined}
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
        />
        <ToolbarIconButton
          label={t("editor.revert")}
          testID="editor-revert"
          Icon={ThemedUndo2}
          onPress={handleRevertPress}
          disabled={!buffer.dirty || buffer.saving}
        />
        <ToolbarLeadingSlot>{toolbarLeadingSlot}</ToolbarLeadingSlot>
        <View style={styles.toolbarSpacer} />
        <ToolbarIconButton
          label={t("editor.wordWrap")}
          testID="editor-wordwrap-toggle"
          Icon={ThemedWrapText}
          onPress={toggleWordWrap}
          selected={wordWrap}
        />
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
        />
        <FileHistoryToolbarButton supported={onOpenHistory !== null} onPress={handleOpenHistory} />
        {modeBarProps ? <FileViewModeBar {...modeBarProps} /> : null}
      </View>

      {find.open ? (
        <EditorFindStrip find={find} matchInfo={matchInfo} handlers={findHandlers} />
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

      <EditorStatusBar
        path={path}
        byteSize={byteSize}
        eol={buffer.baseline.eol}
        isText
        cursor={cursor}
      />

      {hasCodeIndex ? (
        <EditorOutlineSheet
          serverId={serverId}
          workspaceRoot={workspaceRoot}
          path={path}
          visible={outlineOpen}
          onClose={closeOutline}
          onSelectLine={handleOutlineLine}
        />
      ) : null}

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

function resolveEffectiveMode(input: {
  mode: FileViewMode;
  editorAllowed: boolean;
  splitAllowed: boolean;
  /** False for an out-of-project file whose edit warning hasn't been accepted. */
  editUnlocked: boolean;
}): FileViewMode {
  if (!input.editorAllowed) {
    return "preview";
  }
  if (!input.editUnlocked) {
    // Gated file: stays in preview until the user accepts the edit warning.
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
  /** Host-supplied toolbar controls, placed just after save/revert. Lets a
   *  surface that opens files for a purpose (Context Management) put its own
   *  action in the existing bar instead of stacking a second one above it. */
  toolbarLeadingSlot?: ReactNode;
}) {
  const { t } = useTranslation();
  const persistenceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });

  // A warning must be accepted before editing an out-of-project file. The
  // "other-project" warning is globally suppressible; "outside-project" always
  // warns (no suppress). Reading the suppress flag reactively so accepting the
  // checkbox unlocks other-project files immediately.
  const suppressOtherProject = useEditorPrefsStore((state) => state.suppressOutOfProjectWarning);
  const gateActive =
    editGate.kind === "outside-project" ||
    (editGate.kind === "other-project" && !suppressOtherProject);

  // Rendered formats (markdown, images, binaries) open in preview; plain
  // text and code open straight in the editor. Out-of-project files default to
  // preview (editing is opt-in via the gate). The per-file memory wins, but the
  // effective-mode clamp still forces preview until the gate is accepted.
  const { mode, setMode } = useFileViewMode({
    persistenceKey,
    path: location.path,
    defaultMode: gateActive ? "preview" : defaultFileViewMode(location.path),
  });
  const canEdit = useTextEditorFeature(serverId);
  const isCompact = useIsCompactFormFactor();
  const [fileInfo, setFileInfo] = useState<FilePreviewFileInfo | null>(null);
  // Per-tab acceptance of the edit warning — lives until the tab unmounts
  // (closes), so reopening a gated file warns again.
  const [editOverridden, setEditOverridden] = useState(false);
  const controllerRef = useRef<EditorController | null>(null);

  const editUnlocked = !gateActive || editOverridden;
  // Until the first read reports back, trust the remembered mode: a file that
  // was in editor view last time is a text file until proven otherwise.
  const editorAllowed = canEdit && (fileInfo === null || fileInfo.kind === "text");
  const splitAllowed = editorAllowed && isWeb && !isCompact;
  const effectiveMode = resolveEffectiveMode({
    mode,
    editorAllowed,
    splitAllowed,
    editUnlocked,
  });

  const otherProjectName = editGate.kind === "other-project" ? editGate.projectName : null;
  const requestEditUnlock = useCallback(async (): Promise<boolean> => {
    if (editGate.kind === "outside-project") {
      return confirmDialog({
        title: t("editor.outOfProject.editOutsideTitle"),
        message: t("editor.outOfProject.editOutsideMessage"),
        confirmLabel: t("editor.outOfProject.editConfirm"),
        cancelLabel: t("editor.cancel"),
        destructive: true,
      });
    }
    const { confirmed, checkboxChecked } = await confirmDialogWithCheckbox({
      title: t("editor.outOfProject.editOtherTitle"),
      message: t("editor.outOfProject.editOtherMessage", {
        project: otherProjectName ?? "",
      }),
      confirmLabel: t("editor.outOfProject.editConfirm"),
      cancelLabel: t("editor.cancel"),
      checkboxLabel: t("editor.outOfProject.editOtherSuppress"),
    });
    if (confirmed && checkboxChecked) {
      useEditorPrefsStore.getState().setSuppressOutOfProjectWarning(true);
    }
    return confirmed;
  }, [editGate.kind, otherProjectName, t]);

  const handleModeChange = useCallback(
    (next: FileViewMode) => {
      // Switching into an editable mode on a gated file requires accepting the
      // warning first; a rejection leaves the mode unchanged (stays in preview).
      if ((next === "editor" || next === "split") && gateActive && !editOverridden) {
        void (async () => {
          const accepted = await requestEditUnlock();
          if (accepted) {
            setEditOverridden(true);
            setMode(next);
          }
        })();
        return;
      }
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
    [editOverridden, gateActive, location.path, requestEditUnlock, serverId, setMode, workspaceId],
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
// persistent, centered banner: a constant reminder that edits here won't be
// part of this project's commit (gated-multi-root). `projectName` is null for
// a file outside every project.
function OutOfProjectBanner({ projectName }: { projectName: string | null }) {
  const { t } = useTranslation();
  return (
    <View style={styles.outOfProjectBanner} testID="file-out-of-project-banner">
      <Text style={styles.outOfProjectText} numberOfLines={1}>
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
      paddingHorizontal: theme.spacing[2],
      paddingVertical: theme.spacing[1],
      backgroundColor: theme.colors.surface2,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    outOfProjectText: {
      color: theme.colors.statusWarning,
      fontSize: theme.fontSize.xs,
      fontWeight: "600",
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
    conflictBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      paddingHorizontal: theme.spacing[2],
      paddingVertical: theme.spacing[1],
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
      backgroundColor: theme.colors.surface1,
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
