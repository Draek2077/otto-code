import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  List,
  Save,
  Search,
  TriangleAlert,
  Undo2,
  WandStars,
  WrapText,
  X,
} from "@/components/icons/material-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { createControlGeometry } from "@/components/ui/control-geometry";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { CodeEditor } from "@/editor/code-editor";
import type {
  CodeEditorProps,
  EditorController,
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
import { useEditorPrefsStore } from "@/editor/editor-prefs-store";
import { GoToLineDialog } from "@/editor/go-to-line-dialog";
import { RefactorDialog } from "@/editor/refactor-dialog";
import { useAiRefactor } from "@/editor/use-ai-refactor";
import { useProjectSearchFeature } from "@/editor/use-project-search-feature";
import { useTextEditorFeature } from "@/editor/use-text-editor-feature";
import {
  FilePreview,
  type FilePreviewFileInfo,
  type FilePreviewSyncHandle,
  type PreviewPointerDown,
  type PreviewScrollMetrics,
} from "@/components/file-pane";
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
const foregroundIconColorMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
});
const ThemedSearch = withUnistyles(Search);
const ThemedList = withUnistyles(List);
const ThemedSave = withUnistyles(Save);
const ThemedUndo2 = withUnistyles(Undo2);
const ThemedWandStars = withUnistyles(WandStars);
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

// `theme` is resolved by the withUnistyles mapping below, so the wrapped
// component has to tolerate the frame where it is not injected yet.
function CodeEditorWithInjectedTheme({
  theme,
  ...rest
}: Omit<CodeEditorProps, "theme"> & { theme?: EditorThemeSpec }) {
  if (!theme) {
    return null;
  }
  return <CodeEditor {...rest} theme={theme} />;
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

// Icon-only toolbar button with a tooltip carrying its label (the
// file-view-mode-bar pattern). `loading` swaps the glyph for a spinner.
function ToolbarIconButton({
  label,
  testID,
  Icon,
  onPress,
  disabled = false,
  selected = false,
  loading = false,
}: {
  label: string;
  testID: string;
  Icon: typeof ThemedSave;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
  loading?: boolean;
}) {
  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.iconButton,
      !disabled && (Boolean(hovered) || pressed) && styles.iconButtonActive,
      selected && styles.iconButtonSelected,
      disabled && styles.iconButtonDisabled,
    ],
    [disabled, selected],
  );
  const accessibilityState = useMemo(() => ({ disabled, selected }), [disabled, selected]);
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={accessibilityState}
        testID={testID}
        onPress={onPress}
        disabled={disabled || loading}
        style={buttonStyle}
      >
        {loading ? (
          <ThemedLoadingSpinner size={16} uniProps={foregroundMutedIconColorMapping} />
        ) : (
          <Icon
            size={16}
            uniProps={selected ? foregroundIconColorMapping : foregroundMutedIconColorMapping}
          />
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

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

function PreviewOnlyView({
  serverId,
  workspaceId,
  workspaceRoot,
  location,
  modeBarProps,
  onFileInfo,
}: {
  serverId: string;
  workspaceId: string;
  workspaceRoot: string;
  location: WorkspaceFileLocation;
  modeBarProps: FileViewModeBarProps | null;
  onFileInfo: (info: FilePreviewFileInfo | null) => void;
}) {
  const draftOverride = useDraftOverride({ serverId, workspaceId, path: location.path });
  return (
    <View style={styles.container} testID="workspace-file-tab-pane">
      <View style={styles.previewToolbar}>
        <View style={styles.toolbarSpacer} />
        {modeBarProps ? <FileViewModeBar {...modeBarProps} /> : null}
      </View>
      <FilePreview
        serverId={serverId}
        workspaceRoot={workspaceRoot}
        location={location}
        contentOverride={draftOverride}
        onFileInfo={onFileInfo}
      />
    </View>
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
  controllerRef,
  onFileInfo,
}: {
  serverId: string;
  workspaceId: string;
  workspaceRoot: string;
  location: WorkspaceFileLocation;
  split: boolean;
  modeBarProps: FileViewModeBarProps | null;
  controllerRef: RefObject<EditorController | null>;
  onFileInfo: (info: FilePreviewFileInfo | null) => void;
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

  const wordWrap = useEditorPrefsStore((state) => state.wordWrap);
  const toggleWordWrap = useEditorPrefsStore((state) => state.toggleWordWrap);

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

  const initialLineHandledRef = useRef(false);
  const handleReady = useCallback(
    (controller: EditorController) => {
      controllerRef.current = controller;
      if (!initialLineHandledRef.current) {
        initialLineHandledRef.current = true;
        if (location.lineStart) {
          controller.goToLine(location.lineStart);
        }
      }
    },
    [controllerRef, location.lineStart],
  );

  // Re-opening this file with a new target line (e.g. "Edit" on a diff line)
  // updates the existing tab's location in place; jump the live editor there.
  // Before the editor is ready, handleReady owns the first jump.
  const locationLineStart = location.lineStart;
  useEffect(() => {
    if (locationLineStart && initialLineHandledRef.current) {
      controllerRef.current?.goToLine(locationLineStart);
    }
  }, [controllerRef, locationLineStart]);

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

  const refactor = useAiRefactor({ serverId, path, controllerRef });
  const handleOpenRefactor = useCallback(() => {
    void refactor.openRefactor();
  }, [refactor]);

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
      docSyncDebounceMs={split ? SPLIT_DOC_SYNC_DEBOUNCE_MS : undefined}
      onDirtyChanged={onDirtyChanged}
      onDocSync={onDocSync}
      onMatchInfo={setMatchInfo}
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
        <View style={styles.toolbarSpacer} />
        <ToolbarIconButton
          label={t("refactor.open")}
          testID="editor-refactor-toggle"
          Icon={ThemedWandStars}
          onPress={handleOpenRefactor}
        />
        <ToolbarIconButton
          label={t("editor.wordWrap")}
          testID="editor-wordwrap-toggle"
          Icon={ThemedWrapText}
          onPress={toggleWordWrap}
          selected={wordWrap}
        />
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

      <RefactorDialog
        scope={refactor.dialogScope}
        visible={refactor.dialogVisible}
        onClose={refactor.closeRefactor}
        onConfirm={refactor.confirmRefactor}
      />
    </View>
  );
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
}: {
  serverId: string;
  workspaceId: string;
  workspaceRoot: string;
  location: WorkspaceFileLocation;
  /** How editing this file is gated (in-/linked-project = free; else warns). */
  editGate: EditGate;
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

  const content =
    effectiveMode === "preview" ? (
      <PreviewOnlyView
        serverId={serverId}
        workspaceId={workspaceId}
        workspaceRoot={workspaceRoot}
        location={location}
        modeBarProps={modeBarProps}
        onFileInfo={setFileInfo}
      />
    ) : (
      <EditorModeView
        serverId={serverId}
        workspaceId={workspaceId}
        workspaceRoot={workspaceRoot}
        location={location}
        split={effectiveMode === "split"}
        modeBarProps={modeBarProps}
        controllerRef={controllerRef}
        onFileInfo={setFileInfo}
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
  // Keep the preview toolbar at button height even when the mode bar is
  // hidden (images, binaries, loading) so the chrome doesn't jump.
  const buttonHeight = createControlGeometry(theme).buttonSm.minHeight;
  const toolbarPadding = theme.spacing[1] * 2;

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
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    previewToolbar: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      paddingHorizontal: theme.spacing[2],
      paddingVertical: theme.spacing[1],
      minHeight: buttonHeight + toolbarPadding,
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
    iconButtonSelected: {
      backgroundColor: theme.colors.surface2,
    },
    iconButtonDisabled: {
      opacity: 0.4,
    },
    tooltipText: {
      color: theme.colors.foreground,
      fontSize: theme.fontSize.sm,
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
