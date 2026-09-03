import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, View, type LayoutChangeEvent } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { DiffViewer } from "@/components/diff-viewer";
import { FileHeader } from "@/git/file-header";
import { createDiffDocumentFromParsedFile } from "@/utils/diff-document";
import type { DiffDocumentProps } from "./types";

const EMPTY_PATHS: readonly string[] = [];

/**
 * The virtual canvas is deliberately the Line renderer. Structural review has
 * a different row model, so it composes the shared per-file viewer instead of
 * attempting to make a second semantic planner inside the canvas pipeline.
 */
export function StructuralDiffDocument(props: DiffDocumentProps) {
  const { t } = useTranslation();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const fileOffsets = useRef(new Map<string, number>());
  const consumedFocus = useRef<string | null>(null);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const collapseState = props.mode.kind === "working" ? props.collapseState : null;
  const collapsedPaths = collapseState?.paths ?? EMPTY_PATHS;
  const collapsedFilePaths = useMemo(() => new Set(collapsedPaths), [collapsedPaths]);

  const toggleFile = useCallback(
    (path: string) => {
      if (!collapseState) return;
      collapseState.onChange(
        collapsedFilePaths.has(path)
          ? collapsedPaths.filter((entry) => entry !== path)
          : [...collapsedPaths, path],
      );
    },
    [collapseState, collapsedFilePaths, collapsedPaths],
  );
  const handleFileLayout = useCallback((path: string, event: LayoutChangeEvent) => {
    const offset = event.nativeEvent.layout.y;
    if (fileOffsets.current.get(path) === offset) return;
    fileOffsets.current.set(path, offset);
    setLayoutVersion((current) => current + 1);
  }, []);
  const handleActivate = useCallback(
    (path: string) => {
      if (props.mode.kind !== "working") return;
      toggleFile(path);
    },
    [props.mode.kind, toggleFile],
  );

  useEffect(() => {
    if (props.mode.kind !== "working" || !props.mode.focusPath) return;
    const focusKey = `${props.mode.focusRequestId ?? "initial"}:${props.mode.focusPath}`;
    if (consumedFocus.current === focusKey) return;
    if (collapsedFilePaths.has(props.mode.focusPath)) toggleFile(props.mode.focusPath);
    const offset = fileOffsets.current.get(props.mode.focusPath);
    if (offset === undefined) return;
    scrollRef.current?.scrollTo({ y: offset, animated: false });
    consumedFocus.current = focusKey;
  }, [collapsedFilePaths, layoutVersion, props.mode, toggleFile]);

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={styles.content}
      testID="structural-diff-document"
    >
      {props.files.map((file, fileIndex) => (
        <StructuralDiffFile
          key={file.path}
          documentProps={props}
          file={file}
          fileIndex={fileIndex}
          isCollapsed={collapsedFilePaths.has(file.path)}
          isSelected={selectedPath === file.path}
          onActivate={handleActivate}
          onFileLayout={handleFileLayout}
          onSelect={setSelectedPath}
          binaryLabel={t("workspace.git.diff.binaryFile")}
          tooLargeLabel={t("workspace.git.diff.tooLarge")}
        />
      ))}
    </ScrollView>
  );
}

function StructuralDiffFile({
  documentProps,
  file,
  fileIndex,
  isCollapsed,
  isSelected,
  onActivate,
  onFileLayout,
  onSelect,
  binaryLabel,
  tooLargeLabel,
}: {
  documentProps: DiffDocumentProps;
  file: DiffDocumentProps["files"][number];
  fileIndex: number;
  isCollapsed: boolean;
  isSelected: boolean;
  onActivate: (path: string) => void;
  onFileLayout: (path: string, event: LayoutChangeEvent) => void;
  onSelect: (path: string) => void;
  binaryLabel: string;
  tooLargeLabel: string;
}) {
  const document = useMemo(() => createDiffDocumentFromParsedFile(file), [file]);
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => onFileLayout(file.path, event),
    [file.path, onFileLayout],
  );
  const working = documentProps.mode.kind === "working" ? documentProps.mode : null;
  let body = null;
  if (!isCollapsed) {
    if (file.status === "binary" || file.status === "too_large") {
      body = (
        <View style={styles.status} testID={`diff-file-${fileIndex}-body`}>
          <Text style={styles.statusText}>
            {file.status === "binary" ? binaryLabel : tooLargeLabel}
          </Text>
        </View>
      );
    } else {
      body = (
        <DiffViewer
          diffLines={document.lines}
          document={document}
          presentation="structural"
          layout={documentProps.displayPreferences.layout}
          reviewActions={working?.reviewActions}
          wrap={documentProps.displayPreferences.wrapLines}
          embedded
          frame="top"
        />
      );
    }
  }
  return (
    <View onLayout={handleLayout}>
      <FileHeader
        file={file}
        bodyVisible={!isCollapsed}
        showsBodyState={documentProps.mode.kind === "working"}
        isSelected={isSelected}
        interactive={documentProps.mode.kind === "working"}
        workspaceFileDragScope={working?.workspaceFileDragScope}
        onActivate={onActivate}
        onSelect={onSelect}
        onOpenFile={working?.onOpenFile}
        onOpenToSide={working?.onOpenToSide}
        onAddToChat={working?.onAddToChat}
        onCopyPath={working?.onCopyPath}
        onCopyRelativePath={working?.onCopyRelativePath}
        onReveal={working?.onReveal}
        revealTargetName={working?.revealTargetName}
        onDownload={working?.onDownload}
        onDuplicate={working?.onDuplicate}
        onRevert={working?.onRevert}
        testID={`diff-file-${fileIndex}`}
      />
      {body}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  scroll: { flex: 1, minHeight: 0 },
  content: { paddingBottom: theme.spacing[8] },
  status: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: theme.spacing[3],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  statusText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
