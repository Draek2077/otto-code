import { useMemo, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { CHAT_PANE_OVERLAY_Z } from "@/constants/layout";
import { useVisualizerPipInset } from "@/visualizer/use-visualizer-pip-inset";

export interface ChatTopOverlayStackProps {
  children: ReactNode;
}

/**
 * The single absolutely-positioned column that all top-anchored chat overlays
 * live in — today the suggested-task card and the pinned task checklist.
 *
 * They used to own an absolute wrap each, both pinned to `top: 0`, ordered by
 * separate z-index slots. That never ordered anything: two boxes at the same
 * origin means the higher z simply covers the lower one, so whenever an agent
 * suggested work while a checklist was live, one of the two vanished. On a phone
 * that is the normal case, not a corner — the checklist is up almost the whole
 * time an agent is working. Laying them out in one column is the fix; order in
 * the column is the priority, and both stay visible.
 *
 * The stack also owns the Visualizer PIP inset, since it is the thing that has
 * to physically move out of the PIP's way (see use-visualizer-pip-inset for why
 * z-index cannot solve that one either).
 */
export function ChatTopOverlayStack({ children }: ChatTopOverlayStackProps) {
  const pipInset = useVisualizerPipInset();
  const stackStyle = useMemo(
    () =>
      pipInset.left > 0 || pipInset.right > 0
        ? [styles.stack, { paddingLeft: pipInset.left, paddingRight: pipInset.right }]
        : styles.stack,
    [pipInset],
  );

  return (
    <View style={stackStyle} pointerEvents="box-none">
      {children}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  stack: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[3],
    zIndex: CHAT_PANE_OVERLAY_Z.chatTopStack,
  },
}));
