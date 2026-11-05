import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ResizeHandle } from "@/components/resize-handle";
import { useFileViewStore } from "./view-state";
/** Existing Paseo gesture/resize behavior, with one remembered user proportion. */
export function EditorSplitPreview({
  source,
  preview,
  mode = "split",
}: {
  source: ReactNode;
  preview: ReactNode;
  mode?: import("./view-state").FileViewMode;
}) {
  const [sourceMounted, setSourceMounted] = useState(mode !== "preview");
  useEffect(() => {
    if (mode !== "preview") setSourceMounted(true);
  }, [mode]);
  const ratio = useFileViewStore((state) => state.splitRatio);
  const direction = useFileViewStore((state) => state.splitDirection);
  const setRatio = useFileViewStore((state) => state.setSplitRatio);
  const [measured, setMeasured] = useState(0);
  const [pending, setPending] = useState<number[] | null>(null);
  const sizes = useMemo(() => pending ?? [ratio, 1 - ratio], [ratio, pending]);
  const measure = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      if (width > 0 && height > 0) setMeasured(direction === "horizontal" ? width : height);
    },
    [direction],
  );
  const previewResize = useCallback((_groupId: string, values: number[]) => setPending(values), []);
  const commit = useCallback(
    (_groupId: string, values: number[]) => {
      setPending(null);
      setRatio(values[0]);
    },
    [setRatio],
  );
  const sourceStyle = useMemo(() => ({ flexGrow: sizes[0] }), [sizes]);
  const previewStyle = useMemo(() => ({ flexGrow: sizes[1] }), [sizes]);
  return (
    <View
      style={[styles.frame, direction === "horizontal" ? styles.row : styles.column]}
      onLayout={measure}
      testID="editor-split-preview"
    >
      <View
        style={[
          styles.pane,
          mode === "split" ? sourceStyle : styles.fill,
          mode === "preview" && styles.hidden,
        ]}
        testID="file-split-editor"
      >
        {sourceMounted ? source : null}
      </View>
      {mode === "split" ? (
        <ResizeHandle
          direction={direction}
          groupId="otto-file-preview"
          index={0}
          sizes={sizes}
          containerSize={measured}
          onPreviewResizeSplit={previewResize}
          onResizeSplit={commit}
          testID="file-preview-divider"
        />
      ) : null}
      <View
        style={[
          styles.pane,
          mode === "split" ? previewStyle : styles.fill,
          mode === "editor" && styles.hidden,
        ]}
        testID="file-split-preview"
      >
        {mode !== "editor" ? preview : null}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  frame: { flex: 1, minWidth: 0, minHeight: 0 },
  row: { flexDirection: "row" },
  column: { flexDirection: "column" },
  pane: { flexBasis: 0, minWidth: 0, minHeight: 0, overflow: "hidden" },
  fill: { flexGrow: 1 },
  hidden: { display: "none" },
});
