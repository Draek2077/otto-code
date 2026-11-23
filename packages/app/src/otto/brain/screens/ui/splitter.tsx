import { Children, useCallback, useEffect, useMemo, type ReactNode } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { createBrainStyles } from "../theme";
import { isWeb } from "@/constants/platform";
import {
  BRAIN_SPLIT_MAX_RATIO,
  BRAIN_SPLIT_MIN_RATIO,
  normalizeBrainSplitRatio,
} from "../layout-store";

type SplitDirection = "horizontal" | "vertical";
// A full 9px target gives the 1px rule four physical pixels of grab room on
// either side. It is an actual layout band, not hitSlop users have to discover
// beside an invisible hairline.
const SPLITTER_SIZE = 9;
// Match the existing sidebar-resize-handle web CSS lane. These cursor values
// belong to the web renderer and are not declared by native ViewStyle.
const WEB_RESIZE_CURSOR: Record<SplitDirection, object> = {
  horizontal: { cursor: "col-resize" },
  vertical: { cursor: "row-resize" },
};

function clampRatio(value: number) {
  "worklet";
  return Math.min(BRAIN_SPLIT_MAX_RATIO, Math.max(BRAIN_SPLIT_MIN_RATIO, value));
}

/**
 * A two-pane split whose live geometry stays on the UI thread. The persisted
 * ratio is only committed when a drag ends, so tables and detail panes do not
 * re-render for every pointer movement.
 */
export function BrainSplitter({
  direction,
  ratio,
  onRatioChange,
  testID,
  showRule = true,
  children,
}: {
  direction: SplitDirection;
  ratio: number;
  onRatioChange: (ratio: number) => void;
  testID: string;
  /** The benchmark table stack keeps its draggable breathing room without a rule. */
  showRule?: boolean;
  children: ReactNode;
}) {
  const styles = useStyles();
  const [first, second] = Children.toArray(children);
  const containerSize = useSharedValue(0);
  const firstSize = useSharedValue(0);
  const startRatio = useSharedValue(normalizeBrainSplitRatio(ratio));

  const setSizeForRatio = useCallback(
    (nextRatio: number) => {
      if (containerSize.value <= SPLITTER_SIZE) return;
      const available = containerSize.value - SPLITTER_SIZE;
      firstSize.value = normalizeBrainSplitRatio(nextRatio) * available;
    },
    [containerSize, firstSize],
  );

  useEffect(() => {
    setSizeForRatio(ratio);
  }, [ratio, setSizeForRatio]);

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { height, width } = event.nativeEvent.layout;
      if (width <= 0 || height <= 0) return;
      containerSize.value = direction === "horizontal" ? width : height;
      setSizeForRatio(ratio);
    },
    [containerSize, direction, ratio, setSizeForRatio],
  );

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onStart(() => {
          const available = Math.max(1, containerSize.value - SPLITTER_SIZE);
          startRatio.value = clampRatio(firstSize.value / available);
        })
        .onUpdate((event) => {
          const available = Math.max(1, containerSize.value - SPLITTER_SIZE);
          const delta = direction === "horizontal" ? event.translationX : event.translationY;
          firstSize.value = clampRatio(startRatio.value + delta / available) * available;
        })
        .onEnd(() => {
          const available = Math.max(1, containerSize.value - SPLITTER_SIZE);
          runOnJS(onRatioChange)(clampRatio(firstSize.value / available));
        }),
    [containerSize, direction, firstSize, onRatioChange, startRatio],
  );

  const firstPaneStyle = useAnimatedStyle(() =>
    direction === "horizontal" ? { width: firstSize.value } : { height: firstSize.value },
  );
  const row = direction === "horizontal";
  const splitterStyle = [
    styles.divider,
    row ? styles.verticalDivider : styles.horizontalDivider,
    isWeb && WEB_RESIZE_CURSOR[direction],
  ];

  return (
    <View style={[styles.container, row ? styles.row : styles.column]} onLayout={handleLayout}>
      <Animated.View style={[styles.firstPane, firstPaneStyle]}>{first}</Animated.View>
      <GestureDetector gesture={gesture}>
        <View
          style={splitterStyle}
          testID={testID}
          accessibilityRole="adjustable"
          role="separator"
          aria-orientation={row ? "vertical" : "horizontal"}
        >
          {showRule ? (
            <View
              pointerEvents="none"
              style={[styles.rule, row ? styles.verticalRule : styles.horizontalRule]}
            />
          ) : null}
        </View>
      </GestureDetector>
      <View style={styles.secondPane}>{second}</View>
    </View>
  );
}

const useStyles = createBrainStyles((theme) => ({
  container: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  row: {
    flexDirection: "row",
  },
  column: {
    flexDirection: "column",
  },
  firstPane: {
    flexGrow: 0,
    flexShrink: 0,
    minWidth: 0,
    minHeight: 0,
  },
  secondPane: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    minHeight: 0,
  },
  divider: {
    flexShrink: 0,
    position: "relative",
  },
  verticalDivider: {
    width: SPLITTER_SIZE,
  },
  horizontalDivider: {
    height: SPLITTER_SIZE,
  },
  rule: {
    position: "absolute",
    backgroundColor: theme.colors.border,
  },
  verticalRule: {
    width: 1,
    top: 0,
    bottom: 0,
    left: (SPLITTER_SIZE - 1) / 2,
  },
  horizontalRule: {
    height: 1,
    left: 0,
    right: 0,
    top: (SPLITTER_SIZE - 1) / 2,
  },
}));
