import { useMemo } from "react";
import { View, type ViewStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { SurfaceBackdrop } from "@/styles/surface-backdrop";
import { STATUS_RING_FRAME_SIZE } from "@/components/status-ring/geometry";
import { STATUS_INDICATOR_FILLED_DOT_SIZE } from "@/utils/status-indicator-geometry";
import type { Theme } from "@/styles/theme";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { ChatSpinner } from "./spinner";
import { workspaceActivityBlue } from "./palette";

export interface ActivityRingProps {
  backdrop?: SurfaceBackdrop | null;
  centerStyle?: ViewStyle;
  centerBucket?: SidebarStateBucket;
}
const blue = (theme: Theme) => ({
  glowA: workspaceActivityBlue(theme.colorScheme === "dark"),
  glowB: workspaceActivityBlue(theme.colorScheme === "dark"),
});
const StatusSpinner = withUnistyles(ChatSpinner);
/** Released blue plasma activity ring, with an independently colored semantic center. */
export function ChatActivityRing({
  backdrop,
  centerStyle,
  centerBucket = "running",
}: ActivityRingProps) {
  const compact = useIsCompactFormFactor();
  const size = STATUS_RING_FRAME_SIZE * (compact ? 2 : 1);
  const frame = useMemo(() => ({ width: size, height: size }), [size]);
  const dot = useMemo(
    () => ({
      width: STATUS_INDICATOR_FILLED_DOT_SIZE * (compact ? 2 : 1),
      height: STATUS_INDICATOR_FILLED_DOT_SIZE * (compact ? 2 : 1),
    }),
    [compact],
  );
  return (
    <View style={[styles.frame, frame, backdrop ? styles[backdrop] : undefined]}>
      <View style={styles.ring} pointerEvents="none">
        <StatusSpinner size={size} uniProps={blue} />
      </View>
      <View
        testID="otto-activity-center-dot"
        style={[styles.dot, dot, styles[centerBucket], centerStyle]}
      />
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  frame: { alignItems: "center", justifyContent: "center", borderRadius: theme.borderRadius.full },
  ring: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  dot: {
    borderRadius: theme.borderRadius.full,
    backgroundColor: workspaceActivityBlue(theme.colorScheme === "dark"),
  },
  needs_input: { backgroundColor: theme.colors.statusWarning },
  failed: { backgroundColor: theme.colors.statusDanger },
  attention: { backgroundColor: theme.colors.statusSuccess },
  running: { backgroundColor: workspaceActivityBlue(theme.colorScheme === "dark") },
  done: { backgroundColor: theme.colors.foregroundExtraMuted },
  surface0: { backgroundColor: theme.colors.surface0 },
  surface1: { backgroundColor: theme.colors.surface1 },
  surface2: { backgroundColor: theme.colors.surface2 },
  surfaceSidebar: { backgroundColor: theme.colors.surfaceSidebar },
  surfaceSidebarHover: { backgroundColor: theme.colors.surfaceSidebarHover },
  surfaceSidebarSelected: { backgroundColor: theme.colors.surfaceSidebarSelected },
}));
