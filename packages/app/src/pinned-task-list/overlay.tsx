import { useEffect, useMemo, type ReactElement } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { CheckSquare, X } from "@/components/icons/material-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAnimationsEnabled } from "@/hooks/use-animations-enabled";
import {
  COMPOSER_TRACK_FLY_IN_DURATION_MS,
  COMPOSER_TRACK_FLY_OUT_DURATION_MS,
} from "@/constants/animation";
import { CHAT_PANE_OVERLAY_Z } from "@/constants/layout";
import { useVisualizerPipInset } from "@/visualizer/use-visualizer-pip-inset";
import { TodoTaskList, useTodoCounts } from "@/components/todo-task-list";
import type { Theme } from "@/styles/theme";
import type { TodoListStreamItem } from "./select";

const ThemedCheckSquare = withUnistyles(CheckSquare);
const ThemedX = withUnistyles(X);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

// Same fly-up / fly-down idiom as the suggested-tasks card and composer detail
// cards, using Reanimated PRESETS (the worklet form is a web/Electron no-op).
const flyIn = FadeInDown.duration(COMPOSER_TRACK_FLY_IN_DURATION_MS);
const flyOut = FadeOutDown.duration(COMPOSER_TRACK_FLY_OUT_DURATION_MS);

// A short beat after the last task completes before auto-dismiss fires, so the
// final check-off is actually seen rather than snatched away mid-animation.
const AUTO_DISMISS_DELAY_MS = 2200;
const LIST_MAX_HEIGHT = 340;

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
 * container (not a Portal) so Android hit-testing stays in bounds — see
 * docs/floating-panels.md, same as the suggested-tasks overlay.
 */
export function PinnedTaskListOverlay({
  item,
  autoDismiss,
  onDismiss,
}: PinnedTaskListOverlayProps): ReactElement {
  const { t } = useTranslation();
  const animate = useAnimationsEnabled();
  const pipInset = useVisualizerPipInset();
  const { completedCount, total } = useTodoCounts(item.items);

  const overlayWrapStyle = useMemo(
    () =>
      pipInset.left > 0 || pipInset.right > 0
        ? [styles.overlayWrap, { paddingLeft: pipInset.left, paddingRight: pipInset.right }]
        : styles.overlayWrap,
    [pipInset],
  );

  const allComplete = total > 0 && completedCount === total;
  useEffect(() => {
    if (!autoDismiss || !allComplete) {
      return;
    }
    const timer = setTimeout(onDismiss, AUTO_DISMISS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [autoDismiss, allComplete, onDismiss]);

  return (
    <View style={overlayWrapStyle} pointerEvents="box-none">
      <Animated.View
        entering={animate ? flyIn : undefined}
        exiting={animate ? flyOut : undefined}
        style={styles.card}
        testID="pinned-task-list-overlay"
      >
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <ThemedCheckSquare size={14} uniProps={foregroundColorMapping} />
            <Text style={styles.headerLabel} numberOfLines={1}>
              {t("message.todo.title")}
            </Text>
            {total > 0 ? (
              <Text style={styles.headerCount}>
                {t("message.todo.progress", { completed: completedCount, total })}
              </Text>
            ) : null}
          </View>
          <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
            <TooltipTrigger asChild>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("message.todo.dismiss")}
                testID="pinned-task-list-overlay-dismiss"
                onPress={onDismiss}
                style={styles.headerDismiss}
                hitSlop={8}
              >
                {({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => (
                  <ThemedX
                    size={16}
                    uniProps={
                      hovered || pressed ? foregroundColorMapping : foregroundMutedColorMapping
                    }
                  />
                )}
              </Pressable>
            </TooltipTrigger>
            <TooltipContent side="top" align="center" offset={8}>
              <Text style={styles.tooltipText}>{t("message.todo.dismiss")}</Text>
            </TooltipContent>
          </Tooltip>
        </View>
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
        >
          <TodoTaskList items={item.items} animationsEnabled={animate} emptyLabel="" />
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  overlayWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    alignItems: "center",
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[3],
    zIndex: CHAT_PANE_OVERLAY_Z.pinnedTaskList,
  },
  card: {
    width: "100%",
    maxWidth: 460,
    // A green (success-tone) ring at the same 1px weight as the usage-alert
    // FlyoutBand, so this reads as the progress/tasks surface — matching the
    // green progress bar inside. surface2 is the opaque float base so chat text
    // never shows through.
    backgroundColor: theme.colors.surface2,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.statusSuccess,
    borderRadius: theme.borderRadius["2xl"],
    overflow: "hidden",
    ...theme.shadow.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[3],
    paddingRight: theme.spacing[2],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 1,
    minWidth: 0,
  },
  headerLabel: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  headerCount: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    fontVariant: ["tabular-nums"],
    flexShrink: 0,
  },
  headerDismiss: {
    padding: theme.spacing[1],
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  list: {
    maxHeight: LIST_MAX_HEIGHT,
  },
  listContent: {
    paddingTop: theme.spacing[1],
  },
  tooltipText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
  },
}));
