import { useEffect, type ReactElement } from "react";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useAnimationsEnabled } from "@/hooks/use-animations-enabled";
import {
  COMPOSER_TRACK_FLY_IN_DURATION_MS,
  COMPOSER_TRACK_FLY_OUT_DURATION_MS,
} from "@/constants/animation";
import { useTodoCounts } from "@/components/todo-task-list";
import { CompactPinnedTaskListCard } from "./compact-card";
import type { TodoListStreamItem } from "./select";

// Same fly-up / fly-down idiom as the suggested-tasks card and composer detail
// cards, using Reanimated PRESETS (the worklet form is a web/Electron no-op).
const flyIn = FadeInDown.duration(COMPOSER_TRACK_FLY_IN_DURATION_MS);
const flyOut = FadeOutDown.duration(COMPOSER_TRACK_FLY_OUT_DURATION_MS);

// A short beat after the last task completes before auto-dismiss fires, so the
// final check-off is actually seen rather than snatched away mid-animation.
const AUTO_DISMISS_DELAY_MS = 2200;
export interface PinnedTaskListOverlayProps {
  item: TodoListStreamItem;
  autoDismiss: boolean;
  onDismiss: () => void;
}

/**
 * The live task checklist, floated and pinned to the top of the chat so it stays
 * in view while the agent works instead of scrolling away inline. The same
 * checkable body as the transcript card (components/todo-task-list); the user
 * closes it with the title-bar X, or it self-closes once every task is done when
 * "auto-dismiss" is on (General → Chats). Mounted inside the chat content
 * container (not a Portal) so Android hit-testing stays in bounds - see
 * docs/floating-panels.md, same as the suggested-tasks overlay.
 */
export function PinnedTaskListOverlay({
  item,
  autoDismiss,
  onDismiss,
}: PinnedTaskListOverlayProps): ReactElement {
  const animate = useAnimationsEnabled();
  const { completedCount, total } = useTodoCounts(item.items);

  const allComplete = total > 0 && completedCount === total;
  useEffect(() => {
    if (!autoDismiss || !allComplete) {
      return;
    }
    const timer = setTimeout(onDismiss, AUTO_DISMISS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [autoDismiss, allComplete, onDismiss]);

  return (
    <Animated.View
      entering={animate ? flyIn : undefined}
      exiting={animate ? flyOut : undefined}
      style={styles.card}
      testID="pinned-task-list-overlay"
    >
      <CompactPinnedTaskListCard item={item} animationsEnabled={animate} onDismiss={onDismiss} />
    </Animated.View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Positioning, the PIP inset and the stacking slot all belong to the shared
  // column this card is rendered into (panels/chat-top-overlay-stack.tsx).
  card: {
    width: "100%",
    maxWidth: 460,
    // A green (success-tone) ring at the same 1px weight as the usage-alert
    // FlyoutBand, so this reads as the progress/tasks surface - matching the
    // green progress bar inside. surface2 is the opaque float base so chat text
    // never shows through.
    backgroundColor: theme.colors.surface2,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.statusSuccess,
    borderRadius: theme.borderRadius["2xl"],
    overflow: "hidden",
    ...theme.shadow.md,
  },
}));
