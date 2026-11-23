import { useCallback, useMemo } from "react";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { PanelsLeftRight } from "lucide-react-native";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { usePaneContext } from "@/panels/pane-context";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import type { Theme } from "@/styles/theme";
import { useFileViewMode, useFileViewStore, type FileViewMode } from "./view-state";
const SplitIcon = withUnistyles(PanelsLeftRight);
const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
export function useEditorFileMode(path: string, renderable: boolean, forceSource: boolean) {
  const pane = usePaneContext();
  const state = useFileViewMode({
    persistenceKey: buildWorkspaceTabPersistenceKey(pane),
    path,
    defaultMode: renderable ? "preview" : "editor",
  });
  return { ...state, mode: forceSource || !renderable ? ("editor" as const) : state.mode };
}
export function EditorViewControls({
  mode,
  onChange,
}: {
  mode: FileViewMode;
  onChange(mode: FileViewMode): void;
}) {
  const direction = useFileViewStore((state) => state.splitDirection);
  const setDirection = useFileViewStore((state) => state.setSplitDirection);
  const toggleDirection = useCallback(
    () => setDirection(direction === "horizontal" ? "vertical" : "horizontal"),
    [direction, setDirection],
  );
  const options = useMemo(
    () => [
      { value: "editor" as const, label: "Source", testID: "file-mode-source" },
      { value: "split" as const, label: "Split", testID: "file-mode-split" },
      { value: "preview" as const, label: "Preview", testID: "file-mode-preview" },
    ],
    [],
  );
  return (
    <View style={styles.controls}>
      {mode === "split" ? (
        <ToolbarButton
          label={
            direction === "horizontal"
              ? "Stack preview below source"
              : "Place preview beside source"
          }
          onPress={toggleDirection}
          testID="editor-split-direction"
        >
          <SplitIcon size={14} uniProps={iconColor} />
        </ToolbarButton>
      ) : null}
      <SegmentedControl
        size="xs"
        value={mode}
        onValueChange={onChange}
        options={options}
        testID="file-preview-mode"
      />
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  controls: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
}));
