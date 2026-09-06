import { useId, useMemo, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import MaskedView from "@react-native-masked-view/masked-view";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useChatVisualizerBackground } from "@/visualizer/chat-background-context";

function MaskEdge({ bottom = false }: { bottom?: boolean }) {
  const id = useId();
  return (
    <Svg width="100%" height={24}>
      <Defs>
        <LinearGradient id={id} x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0%" stopColor="black" stopOpacity={bottom ? 1 : 0} />
          <Stop offset={bottom ? "75%" : "25%"} stopColor="black" stopOpacity={0.5} />
          <Stop offset="100%" stopColor="black" stopOpacity={bottom ? 0 : 1} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

export function ChatTranscriptMask({ children }: { children: ReactNode }) {
  const enabled = useChatVisualizerBackground();
  const mask = useMemo(
    () => (
      <View style={[styles.container, !enabled && styles.opaque]}>
        {enabled ? (
          <>
            <MaskEdge />
            <View style={[styles.container, styles.opaque]} />
            <MaskEdge bottom />
            <View style={styles.scrollbarGutter} />
          </>
        ) : null}
      </View>
    ),
    [enabled],
  );
  // Never replace/reparent the scroll view when background mode is toggled.
  return (
    <MaskedView style={styles.container} maskElement={mask} testID="chat-transcript-mask">
      {children}
    </MaskedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0 },
  opaque: { backgroundColor: "black" },
  scrollbarGutter: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    width: 8,
    backgroundColor: "black",
  },
});
