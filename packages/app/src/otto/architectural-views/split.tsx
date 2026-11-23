import { useCallback, useMemo, useState, type ReactNode } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { Children } from "react";
import { ResizeHandle } from "@/components/resize-handle";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { StyleSheet } from "react-native-unistyles";
import { useViewLayout, normalizeViewSplit } from "./layout";
export function ViewAuthoringSplit({ children }: { children: ReactNode }) {
  const [chat, preview] = Children.toArray(children);
  const sizes = useViewLayout((state) => state.splitSizes),
    setSizes = useViewLayout((state) => state.setSplitSizes);
  const [pending, setPending] = useState<number[] | null>(null),
    [width, setWidth] = useState(0);
  const effective = pending ?? sizes;
  const left = useMemo(() => inlineUnistylesStyle({ flexGrow: effective[0] }), [effective]);
  const right = useMemo(() => inlineUnistylesStyle({ flexGrow: effective[1] }), [effective]);
  const measure = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    if (next > 0) setWidth(next);
  }, []);
  const move = useCallback(
    (_group: string, value: number[]) => setPending(normalizeViewSplit(value)),
    [],
  );
  const finish = useCallback(
    (_group: string, value: number[]) => {
      setPending(null);
      setSizes(value);
    },
    [setSizes],
  );
  return (
    <View style={splitStyles.row} onLayout={measure}>
      <View style={[splitStyles.pane, left]} testID="architectural-view-authoring-chat">
        {chat}
      </View>
      <ResizeHandle
        direction="horizontal"
        groupId="architectural-view-authoring"
        index={0}
        sizes={effective}
        containerSize={width}
        onPreviewResizeSplit={move}
        onResizeSplit={finish}
        testID="architectural-view-authoring-splitter"
      />
      <View style={[splitStyles.pane, right]} testID="architectural-view-authoring-preview">
        {preview}
      </View>
    </View>
  );
}
const splitStyles = StyleSheet.create({
  row: { flex: 1, minHeight: 0, minWidth: 0, flexDirection: "row" },
  pane: { flexBasis: 0, minWidth: 0, minHeight: 0, overflow: "hidden" },
});
