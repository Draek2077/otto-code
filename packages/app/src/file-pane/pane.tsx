import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { ScrollView as RNScrollView, Text, View } from "react-native";
import { StyleSheet, UnistylesRuntime, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useSessionStore, type ExplorerFile } from "@/stores/session-store";
import { editorPreviewKind as filePreviewRenderKind } from "@/otto/editor/viewers/kind"; // OTTO(editor): extend Paseo's formats without a second rendering engine.
import { EditorDocumentPreview } from "@/otto/editor/viewers/document"; // OTTO(editor)
import { useAttachmentPreviewUrl } from "@/attachments/use-attachment-preview-url";
import { getFileNameFromPath } from "@/attachments/utils";
import { resolveEditorReadTarget as resolveFilePreviewReadTarget } from "@/otto/editor/read-target"; // OTTO(editor): trusted external files retain a single-file parent scope.
import type { WorkspaceFileLocation } from "@/workspace/file-open";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppActivelyVisible } from "@/hooks/use-app-visible";
import { isFileQueryEnabled } from "@/components/file-pane-enabled";
import { useAppSettings } from "@/hooks/use-settings";
import { useLiveFile } from "./live-file/hook";
import { useFilePreview } from "./preview-lifecycle/hook";
import { resolveFilePreviewLifecycle } from "./preview-lifecycle/model";
import { FilePanelBar } from "./bar";
import { FileHtmlPreview } from "./html-preview";
import { EditorMarkdownPreview as FileMarkdownPreview } from "@/otto/editor/markdown/preview"; // OTTO(editor): annotate only original Markdown, never converted views.
import { FileEditorModel, getFileConflictCallout, type FileConflictCallout } from "./editor/model";
import { createFileObservationSource } from "./editor/observation-source";
import { EditorRenderer } from "@/otto/editor/renderer/view"; // OTTO(editor): web keeps Paseo's renderer; native shares its model and extensions.
import { useOttoEditor } from "@/otto/editor/use-editor"; // OTTO(editor)
import { EditorTools } from "@/otto/editor/tools"; // OTTO(editor)
import { EditorDocumentTools } from "@/otto/editor/document-tools"; // OTTO(editor)
import { EditorMissingFile } from "@/otto/editor/missing-file"; // OTTO(editor)
import { useEditorPreviewScroll } from "@/otto/editor/preview-scroll"; // OTTO(editor)
import type { EditorScrollLink } from "@/otto/editor/scroll-link"; // OTTO(editor)
import { EditorLayout } from "@/otto/editor/layout"; // OTTO(editor)
import { TerminalEditorGate } from "@/otto/editor/terminal-pane"; // OTTO(editor)
import { EditorStatus } from "@/otto/editor/status"; // OTTO(editor)
import { EditorMarkdownToolbar } from "@/otto/editor/markdown/toolbar"; // OTTO(editor)
import { isMarkdownPath } from "@/otto/editor/markdown/markdown-path"; // OTTO(editor)
import { useEditorFileMode, EditorViewControls } from "@/otto/editor/view-controls"; // OTTO(editor)
import { EditorSplitPreview } from "@/otto/editor/split-preview"; // OTTO(editor)
import { FileSourceView } from "@/otto/editor/viewers/source"; // OTTO(editor): keep Paseo web find, restore native read-only find.
import type { FileConflictAlertState } from "./conflict-alert";
import type { LiveFileModel } from "./live-file/model";
import { confirmDialog } from "@/utils/confirm-dialog";
import { usePublishPanelInstanceAttributes } from "@/panels/panel-instance-attributes";
import type { Theme } from "@/styles/theme";
import { EditorImagePreview } from "@/otto/editor/viewers/image"; // OTTO(editor): preserve Paseo gestures and restore image transparency/natural size.
import { EditorRevealFile } from "@/otto/editor/viewers/reveal"; // OTTO(editor)

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

interface FilePreviewBodyProps {
  scrollLink?: EditorScrollLink; // OTTO(editor)
  preview: ExplorerFile | null;
  mode?: "preview" | "source";
  isLoading: boolean;
  isMobile: boolean;
  location: WorkspaceFileLocation;
  navigationRevision: number;
  imagePreviewUri: string | null;
  workspaceRoot: string;
  client: DaemonClient | null;
  serverId: string;
}

type TextExplorerFile = ExplorerFile & { kind: "text" };

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatFileSize({ size }: { size: number }): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function ReadonlySource({
  preview,
  filename,
  location,
  navigationRevision,
}: {
  preview: ExplorerFile;
  filename: string;
  location: WorkspaceFileLocation;
  navigationRevision: number;
}) {
  const theme = UnistylesRuntime.getTheme();
  const { t } = useTranslation();
  const visualTheme = useMemo(
    () => ({
      colorScheme: theme.colorScheme,
      background: theme.colors.surface0,
      foreground: theme.colors.foreground,
      cursor: theme.colors.terminal.cursor,
      foregroundMuted: theme.colors.foregroundMuted,
      border: theme.colors.border,
      selection: theme.colors.terminal.selectionBackground,
      monoFont: theme.fontFamily.mono,
      codeFontSize: theme.fontSize.code,
      syntax: theme.colors.syntax,
    }),
    [theme],
  );
  return (
    <FileSourceView
      content={preview.content ?? ""}
      filename={filename}
      location={location}
      navigationRevision={navigationRevision}
      size={preview.size}
      theme={visualTheme}
      tooLargeMessage={t("panels.file.tooLargeToDisplay")}
    />
  );
}

function TooLargeSource({ size }: { size?: number }) {
  const { t } = useTranslation();
  return (
    <View style={styles.centerState} testID="file-source-too-large">
      <Text style={styles.emptyText}>{t("panels.file.tooLargeToDisplay")}</Text>
      {size ? <Text style={styles.binaryMetaText}>{formatFileSize({ size })}</Text> : null}
    </View>
  );
}

function FilePreviewBody({
  scrollLink, // OTTO(editor)
  preview,
  mode,
  isLoading,
  isMobile: _isMobile,
  location,
  navigationRevision,
  imagePreviewUri,
  workspaceRoot,
  client,
  serverId,
}: FilePreviewBodyProps) {
  const { t } = useTranslation();
  const filePath = location.path;
  // A line target means the caller wants to land on that line, so fall back to
  // the highlighted source view even for renderable files.
  const renderKind =
    preview?.kind === "text" && !location.lineStart && mode !== "source"
      ? filePreviewRenderKind(filePath)
      : null;

  const previewScrollRef = useRef<RNScrollView>(null);
  const previewScroll = useEditorPreviewScroll(previewScrollRef, scrollLink); // OTTO(editor)

  if (isLoading && !preview) {
    return (
      <View style={styles.centerState} testID="file-preview-loading">
        <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
        <Text style={styles.loadingText}>{t("panels.file.loading")}</Text>
      </View>
    );
  }

  if (!preview) {
    return (
      <View style={styles.centerState} testID="file-preview-unsupported">
        <Text style={styles.emptyText}>{t("panels.file.noPreview")}</Text>
      </View>
    );
  }

  if (preview.kind === "text") {
    // OTTO(editor): the source/save path remains unchanged for these formats.
    if (renderKind === "mermaid" || renderKind === "asciidoc")
      return (
        <EditorDocumentPreview
          kind={renderKind}
          source={preview.content ?? ""}
          filePath={filePath}
          workspaceRoot={workspaceRoot}
          client={client}
          serverId={serverId}
        />
      );
    if (renderKind === "html") {
      // The HTML document owns its own scrolling, so no ScrollView wrapper here.
      return (
        <View style={styles.previewScrollContainer}>
          <FileHtmlPreview html={preview.content ?? ""} testID="file-html-preview" />
        </View>
      );
    }

    if (renderKind === "markdown") {
      return (
        <View style={styles.previewScrollContainer}>
          <RNScrollView
            {...previewScroll} // OTTO(editor): split-only, measured proportional synchronization.
            ref={previewScrollRef}
            style={styles.previewContent}
            showsVerticalScrollIndicator
          >
            <FileMarkdownPreview
              source={preview.content ?? ""}
              filePath={filePath}
              workspaceRoot={workspaceRoot}
              client={client}
              serverId={serverId}
            />
          </RNScrollView>
        </View>
      );
    }

    return (
      <ReadonlySource
        preview={preview}
        filename={filePath}
        location={location}
        navigationRevision={navigationRevision}
      />
    );
  }

  if (preview.kind === "image") {
    if (!imagePreviewUri) {
      return (
        <View style={styles.centerState}>
          <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
          <Text style={styles.loadingText}>{t("panels.file.loading")}</Text>
        </View>
      );
    }

    return <EditorImagePreview key={imagePreviewUri} uri={imagePreviewUri} file={preview} />;
  }

  return (
    <View style={styles.centerState}>
      <Text style={styles.emptyText}>{t("panels.file.binaryPreviewUnavailable")}</Text>
      <Text style={styles.binaryMetaText}>{formatFileSize({ size: preview.size })}</Text>
      <EditorRevealFile serverId={serverId} file={filePath} root={workspaceRoot} />
    </View>
  );
}

export function FilePane({
  serverId,
  workspaceRoot,
  location,
  navigationRevision,
}: {
  serverId: string;
  workspaceRoot: string;
  location: WorkspaceFileLocation;
  navigationRevision: number;
}) {
  const { t } = useTranslation();
  const isMobile = useIsCompactFormFactor();
  const [previewMode, setPreviewMode] = useState<"preview" | "source">("preview");

  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  // COMPAT(workspaceFileEditing): added in v0.2.0, remove after 2027-01-18 once daemon floor >= v0.2.0.
  const supportsEditing = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.workspaceFileEditing === true,
  );
  const normalizedWorkspaceRoot = useMemo(() => workspaceRoot.trim(), [workspaceRoot]);
  const normalizedFilePath = useMemo(() => trimNonEmpty(location.path), [location.path]);
  const readTarget = useMemo(
    () =>
      normalizedFilePath
        ? resolveFilePreviewReadTarget({
            path: normalizedFilePath,
            workspaceRoot: normalizedWorkspaceRoot,
          })
        : null,
    [normalizedFilePath, normalizedWorkspaceRoot],
  );

  // Re-read the file when this pane becomes visible again (#445). `isActive`
  // covers tab switches; active app visibility covers backgrounding and returning
  // from another window after an external edit. The gate lives in isFileQueryEnabled.
  const isActive = useRetainedPanelActive();
  const isAppVisible = useAppActivelyVisible();
  const enabled = isFileQueryEnabled({
    hasReadTarget: Boolean(client && readTarget),
    isTabActive: isActive,
    isAppVisible,
  });
  const liveFile = useLiveFile({
    client,
    cwd: readTarget?.cwd ?? null,
    path: readTarget?.path ?? null,
    enabled,
    liveUpdates: supportsEditing,
  });

  const targetKey = readTarget ? `${readTarget.cwd}:${readTarget.path}` : null;
  const previewLifecycle = useFilePreview({
    targetKey,
    liveFileSnapshot: liveFile.snapshot,
  });

  useEffect(() => setPreviewMode("preview"), [targetKey]);

  const { file: preview, imageAttachment } = resolveFilePreviewLifecycle(previewLifecycle);
  const imagePreviewUri = useAttachmentPreviewUrl(imageAttachment);
  const isRenderable = isRenderablePreview(preview, location.path);
  const editable = isEditableTextFile({
    preview,
    supportsEditing,
  });
  const canTogglePreviewMode = isRenderable && !location.lineStart;
  const lineCount =
    preview?.kind === "text" ? (preview.content ?? "").split("\n").length : undefined;
  const errorMessage = previewLifecycle.status === "error" ? previewLifecycle.message : null;
  const isLoading =
    previewLifecycle.status === "initial" ||
    previewLifecycle.status === "read_pending" ||
    previewLifecycle.status === "preparing";

  return (
    <FilePanePresentation
      serverId={serverId}
      workspaceRoot={normalizedWorkspaceRoot}
      client={client}
      readTarget={readTarget}
      preview={preview}
      liveFile={liveFile.model}
      onRetryRead={liveFile.refresh}
      retryingRead={liveFile.isRetrying}
      retryLabel={t("common.actions.retry")}
      filename={getFileNameFromPath(location.path) ?? location.path}
      previewMode={canTogglePreviewMode ? previewMode : undefined}
      onPreviewModeChange={canTogglePreviewMode ? setPreviewMode : undefined}
      lineCount={lineCount}
      editable={editable}
      disconnectedMessage={t("workspace.terminal.hostDisconnected")}
      errorMessage={errorMessage}
      isLoading={isLoading}
      isMobile={isMobile}
      location={location}
      navigationRevision={navigationRevision}
      imagePreviewUri={imagePreviewUri}
    />
  );
}

function isRenderablePreview(preview: ExplorerFile | null, path: string): boolean {
  return preview?.kind === "text" && filePreviewRenderKind(path) !== null;
}

function isEditableTextFile(input: {
  preview: ExplorerFile | null;
  supportsEditing: boolean;
}): boolean {
  return Boolean(
    // OTTO(editor): the native WebView edits through the same revision-checked file model.
    input.supportsEditing && input.preview?.kind === "text" && input.preview.size <= 1024 * 1024,
  );
}

function FilePanePresentation({
  serverId,
  workspaceRoot,
  client,
  readTarget,
  preview,
  liveFile,
  onRetryRead,
  retryingRead,
  retryLabel,
  filename,
  previewMode,
  onPreviewModeChange,
  lineCount,
  editable,
  disconnectedMessage,
  errorMessage,
  isLoading,
  isMobile,
  location,
  navigationRevision,
  imagePreviewUri,
}: {
  serverId: string;
  workspaceRoot: string;
  client: DaemonClient | null;
  readTarget: { cwd: string; path: string } | null;
  preview: ExplorerFile | null;
  liveFile: LiveFileModel;
  onRetryRead: () => void;
  retryingRead: boolean;
  retryLabel: string;
  filename: string;
  previewMode?: "preview" | "source";
  onPreviewModeChange?: (mode: "preview" | "source") => void;
  lineCount?: number;
  editable: boolean;
  disconnectedMessage: string;
  errorMessage: string | null;
  isLoading: boolean;
  isMobile: boolean;
  location: WorkspaceFileLocation;
  navigationRevision: number;
  imagePreviewUri: string | null;
}) {
  if (!client && readTarget) {
    return (
      <View style={styles.container} testID="workspace-file-pane">
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{disconnectedMessage}</Text>
        </View>
      </View>
    );
  }

  if (editable && client && readTarget && preview?.kind === "text") {
    return (
      <TerminalEditorGate
        key={`${serverId}:${readTarget.cwd}:${readTarget.path}`}
        serverId={serverId}
        root={readTarget.cwd}
        file={readTarget.path}
        line={location.lineStart ?? null}
        preview={previewMode === "preview"}
        refresh={onRetryRead}
      >
        <EditableFilePane
          key={`${serverId}:${readTarget.cwd}:${readTarget.path}`}
          serverId={serverId}
          workspaceRoot={workspaceRoot}
          client={client}
          cwd={readTarget.cwd}
          path={readTarget.path}
          preview={preview as TextExplorerFile}
          liveFile={liveFile}
          onRetryRead={onRetryRead}
          retryingRead={retryingRead}
          filename={filename}
          mode={previewMode}
          onModeChange={onPreviewModeChange}
          isLoading={isLoading}
          isMobile={isMobile}
          location={location}
          navigationRevision={navigationRevision}
        />
      </TerminalEditorGate>
    );
  }

  if (errorMessage) {
    if (errorMessage === "File is too large to display") {
      return (
        <View style={styles.container} testID="workspace-file-pane">
          <TooLargeSource />
        </View>
      );
    }
    return (
      <View style={styles.container} testID="workspace-file-pane">
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <EditorRevealFile serverId={serverId} file={location.path} root={workspaceRoot} />
          <Button variant="outline" size="sm" onPress={onRetryRead} loading={retryingRead}>
            {retryLabel}
          </Button>
          {client && readTarget ? (
            <EditorMissingFile
              client={client}
              target={readTarget}
              model={liveFile}
              refresh={onRetryRead}
            />
          ) : null}
          {/* OTTO(editor): confirmed absence only, no overwrite fallback. */}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="workspace-file-pane">
      {preview ? (
        <FilePanelBar
          size={preview.size}
          lineCount={lineCount}
          mode={previewMode}
          onModeChange={onPreviewModeChange}
        />
      ) : null}
      <FilePreviewBody
        preview={preview}
        mode={previewMode}
        isLoading={isLoading}
        isMobile={isMobile}
        location={location}
        navigationRevision={navigationRevision}
        imagePreviewUri={imagePreviewUri}
        workspaceRoot={workspaceRoot}
        client={client}
        serverId={serverId}
      />
    </View>
  );
}

function EditableFilePane({
  serverId,
  workspaceRoot,
  client,
  cwd,
  path,
  preview,
  liveFile,
  onRetryRead,
  retryingRead,
  filename,
  mode,
  onModeChange,
  isLoading,
  isMobile,
  location,
  navigationRevision,
}: {
  serverId: string;
  workspaceRoot: string;
  client: DaemonClient;
  cwd: string;
  path: string;
  preview: TextExplorerFile;
  liveFile: LiveFileModel;
  onRetryRead: () => void;
  retryingRead: boolean;
  filename: string;
  mode?: "preview" | "source";
  onModeChange?: (mode: "preview" | "source") => void;
  isLoading: boolean;
  isMobile: boolean;
  location: WorkspaceFileLocation;
  navigationRevision: number;
}) {
  const { settings } = useAppSettings();
  const { t } = useTranslation();
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [vimMode, setVimMode] = useState<string | null>(settings.vimKeybindings ? "NORMAL" : null);
  const session = useMemo(
    () => ({
      write(input: { content: string; expectedModifiedAt: string; expectedRevision?: string }) {
        return client.writeFile({ cwd, path, ...input });
      },
    }),
    [client, cwd, path],
  );
  const [model] = useState(() => {
    return new FileEditorModel({
      file: {
        content: preview.content ?? "",
        hasBom: preview.hasBom,
        version: {
          status: "ready",
          cwd,
          path,
          size: preview.size,
          modifiedAt: preview.modifiedAt,
          revision: preview.revision,
        },
      },
      session,
    });
  });
  useEffect(() => {
    const source = createFileObservationSource(liveFile);
    model.connectFileObservations(source);
    return () => model.disconnectFileObservations();
  }, [liveFile, model]);
  const snapshot = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const suspendPendingSave = useCallback(() => model.suspendAutosave(), [model]);
  usePublishPanelInstanceAttributes({ modified: snapshot.modified, suspendPendingSave });
  const theme = UnistylesRuntime.getTheme();
  const visualTheme = useMemo(
    () => ({
      problems: {
        error: theme.colors.statusDanger,
        warning: theme.colors.statusWarning,
        info: theme.colors.accent,
      },
      colorScheme: theme.colorScheme,
      background: theme.colors.surface0,
      foreground: theme.colors.foreground,
      cursor: theme.colors.terminal.cursor,
      foregroundMuted: theme.colors.foregroundMuted,
      border: theme.colors.border,
      selection: theme.colors.terminal.selectionBackground,
      monoFont: theme.fontFamily.mono,
      codeFontSize: theme.fontSize.code,
      syntax: theme.colors.syntax,
    }),
    [
      theme.colors.statusDanger,
      theme.colors.statusWarning,
      theme.colors.accent,
      theme.colors.border,
      theme.colors.foreground,
      theme.colors.foregroundMuted,
      theme.colors.surface0,
      theme.colors.syntax,
      theme.colors.terminal.cursor,
      theme.colors.terminal.selectionBackground,
      theme.colorScheme,
      theme.fontFamily.mono,
      theme.fontSize.code,
    ],
  );

  useEffect(() => () => model.dispose(), [model]);

  const handleReload = useCallback(() => {
    if (!snapshot.modified) {
      void model.reload();
      return;
    }
    void (async () => {
      const confirmed = await confirmDialog({
        title: t("panels.file.editor.reloadTitle"),
        message: t("panels.file.editor.reloadMessage"),
        confirmLabel: t("panels.file.editor.reload"),
        destructive: true,
      });
      if (confirmed) void model.reload();
    })();
  }, [model, snapshot.modified, t]);
  const handleOverwrite = useCallback(() => void model.overwrite(), [model]);
  const conflict = fileConflictAlertState({
    callout: getFileConflictCallout(snapshot),
    onOverwrite: handleOverwrite,
    onReload: handleReload,
    onRetry: onRetryRead,
    retrying: retryingRead,
  });
  const handleVimModeChange = useCallback((nextMode: string | null) => setVimMode(nextMode), []);
  const renderedPreview = useMemo<ExplorerFile>(
    () => ({
      ...preview,
      content: snapshot.content,
      size: snapshot.version.status === "ready" ? snapshot.version.size : preview.size,
      modifiedAt:
        snapshot.version.status === "ready" ? snapshot.version.modifiedAt : preview.modifiedAt,
    }),
    [preview, snapshot.content, snapshot.version],
  );
  const fileView = useEditorFileMode(path, mode !== undefined, location.lineStart !== undefined); // OTTO(editor): retain the original per-workspace/file view preference.
  const showSource = fileView.mode !== "preview";
  const otto = useOttoEditor({
    serverId,
    root: cwd,
    workspaceRoot,
    file: path,
    model,
    active: showSource,
  }); // OTTO(editor)
  useEffect(() => otto.surface.setSplit(fileView.mode === "split"), [otto.surface, fileView.mode]); // OTTO(editor)
  const ottoActions = useMemo(
    () =>
      showSource ? (
        <EditorTools surface={otto.surface} available={otto.available} state={otto.state} />
      ) : (
        <EditorDocumentTools surface={otto.surface} />
      ),
    [showSource, otto.surface, otto.available, otto.state],
  ); // OTTO(editor)
  const ottoStatus = useMemo(
    () => (
      <EditorStatus
        snapshot={snapshot}
        surface={otto.surface}
        filename={filename}
        cursor={cursor}
        vimMode={vimMode}
      />
    ),
    [snapshot, otto.surface, filename, cursor, vimMode],
  ); // OTTO(editor): one measured footer, no duplicate cursor row.
  const sourceBody = useMemo(
    () => (
      <EditorLayout surface={otto.surface} footer={ottoStatus}>
        <EditorRenderer
          code={otto.code}
          model={model}
          filename={filename}
          location={location}
          navigationRevision={navigationRevision}
          vimEnabled={settings.vimKeybindings}
          theme={visualTheme}
          onCursorChange={setCursor}
          onVimModeChange={handleVimModeChange}
        />
      </EditorLayout>
    ),
    [
      otto.surface,
      ottoStatus,
      otto.code,
      model,
      filename,
      location,
      navigationRevision,
      settings.vimKeybindings,
      visualTheme,
      handleVimModeChange,
    ],
  ); // OTTO(editor): one mounted source and one shared draft in split mode.
  const previewBody = useMemo(
    () => (
      <FilePreviewBody
        scrollLink={otto.surface.scroll} // OTTO(editor)
        preview={renderedPreview}
        mode="preview"
        isLoading={isLoading}
        isMobile={isMobile}
        location={location}
        navigationRevision={navigationRevision}
        imagePreviewUri={null}
        workspaceRoot={workspaceRoot}
        client={client}
        serverId={serverId}
      />
    ),
    [
      renderedPreview,
      otto.surface,
      isLoading,
      isMobile,
      location,
      navigationRevision,
      workspaceRoot,
      client,
      serverId,
    ],
  ); // OTTO(editor)
  const modeControl = useMemo(
    () =>
      mode ? <EditorViewControls mode={fileView.mode} onChange={fileView.setMode} /> : undefined,
    [mode, fileView.mode, fileView.setMode],
  ); // OTTO(editor)

  return (
    <View style={styles.container} testID="workspace-file-pane">
      <FilePanelBar
        size={
          snapshot.observedVersion.status === "ready" ? snapshot.observedVersion.size : preview.size
        }
        lineCount={showSource ? undefined : snapshot.content.split(/\r\n|\r|\n/u).length}
        editorStatus={snapshot.status}
        showMetadata={!showSource} // OTTO(editor): the source status strip owns these facts.
        conflict={conflict}
        mode={mode}
        onModeChange={onModeChange}
        actions={ottoActions} // OTTO(editor)
        modeControl={modeControl} // OTTO(editor)
      />
      {
        showSource && isMarkdownPath(filename) ? (
          <EditorMarkdownToolbar surface={otto.surface} />
        ) : null /* OTTO(editor) */
      }
      <EditorFileBodies mode={fileView.mode} source={sourceBody} preview={previewBody} />
    </View>
  );
}
// OTTO(editor): keep layout selection outside Paseo's save/conflict owner.
function EditorFileBodies({
  mode,
  source,
  preview,
}: {
  mode: import("@/otto/editor/view-state").FileViewMode;
  source: React.ReactNode;
  preview: React.ReactNode;
}) {
  return <EditorSplitPreview mode={mode} source={source} preview={preview} />; // OTTO(editor): retain undo, selection and scroll when changing views.
}

function fileConflictAlertState(input: {
  callout: FileConflictCallout | null;
  onOverwrite(): void;
  onReload(): void;
  onRetry(): void;
  retrying: boolean;
}): FileConflictAlertState | undefined {
  if (!input.callout) return undefined;
  if (input.callout.kind === "deleted") return { kind: "deleted" };
  if (input.callout.kind === "checkFailed") {
    return { kind: "checkFailed", retrying: input.retrying, onRetry: input.onRetry };
  }
  return {
    kind: "changed",
    canOverwrite: input.callout.canOverwrite,
    onReload: input.onReload,
    onOverwrite: input.onOverwrite,
  };
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  loadingText: {
    marginTop: theme.spacing[2],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  binaryMetaText: {
    marginTop: theme.spacing[2],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  previewScrollContainer: {
    flex: 1,
    minHeight: 0,
  },
  previewContent: {
    flex: 1,
    minHeight: 0,
  },
  previewCodeScrollContent: {
    padding: theme.spacing[4],
  },
}));
