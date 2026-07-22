import { useEffect, useMemo, useRef } from "react";
import { Text, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Check } from "@/components/icons/material-icons";
import type { Theme } from "@/styles/theme";
import type { TodoEntry, TodoEntryStatus } from "@/types/stream";

const ThemedTodoCheckIcon = withUnistyles(Check);
const primaryForegroundColorMapping = (theme: Theme) => ({ color: theme.colors.primaryForeground });

// Motion durations for the task list. Kept short so a live check-off reads as
// confirmation, not decoration — the list must never feel busy.
const TODO_PULSE_DURATION = 900;
const TODO_CHECK_DURATION = 260;
const TODO_FLASH_DURATION = 700;
const TODO_PROGRESS_DURATION = 320;

export interface TodoCounts {
  completedCount: number;
  total: number;
  progress: number;
}

export function useTodoCounts(items: TodoEntry[]): TodoCounts {
  return useMemo(() => {
    const total = items.length;
    const completedCount = items.reduce(
      (count, item) => (item.status === "completed" ? count + 1 : count),
      0,
    );
    return { completedCount, total, progress: total > 0 ? completedCount / total : 0 };
  }, [items]);
}

interface TodoStatusMarkerProps {
  status: TodoEntryStatus;
  animationsEnabled: boolean;
}

/**
 * The per-task marker: a filled check when done, a pulsing accent ring for the
 * task the agent is working on right now, a hollow ring for what's queued. The
 * check scales in only on a live transition into completed — never on first
 * mount, so scrolling a finished list back into view doesn't replay it.
 */
function TodoStatusMarker({ status, animationsEnabled }: TodoStatusMarkerProps) {
  const pulse = useSharedValue(status === "in_progress" ? 1 : 0);
  const check = useSharedValue(status === "completed" ? 1 : 0);
  const prevStatus = useRef(status);

  useEffect(() => {
    const justCompleted = status === "completed" && prevStatus.current !== "completed";

    if (status === "completed") {
      if (justCompleted && animationsEnabled) {
        check.value = 0;
        check.value = withTiming(1, {
          duration: TODO_CHECK_DURATION,
          easing: Easing.out(Easing.back(1.7)),
        });
      } else {
        cancelAnimation(check);
        check.value = 1;
      }
    } else {
      cancelAnimation(check);
      check.value = 0;
    }

    if (status === "in_progress" && animationsEnabled) {
      pulse.value = withRepeat(
        withTiming(0, { duration: TODO_PULSE_DURATION, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = status === "in_progress" ? 1 : 0;
    }

    prevStatus.current = status;
  }, [status, animationsEnabled, pulse, check]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: 0.4 + pulse.value * 0.6,
    transform: [{ scale: 0.78 + pulse.value * 0.22 }],
  }));
  const checkStyle = useAnimatedStyle(() => ({
    opacity: check.value,
    transform: [{ scale: check.value }],
  }));

  const completedStyle = useMemo(() => [styles.marker, styles.markerCompleted], []);
  const activeStyle = useMemo(() => [styles.marker, styles.markerActive], []);
  const activeDotStyle = useMemo(() => [styles.markerActiveDot, pulseStyle], [pulseStyle]);
  const pendingStyle = useMemo(() => [styles.marker, styles.markerPending], []);

  if (status === "completed") {
    return (
      <View style={completedStyle}>
        <Animated.View style={checkStyle}>
          <ThemedTodoCheckIcon size={11} uniProps={primaryForegroundColorMapping} />
        </Animated.View>
      </View>
    );
  }

  if (status === "in_progress") {
    return (
      <View style={activeStyle}>
        <Animated.View style={activeDotStyle} />
      </View>
    );
  }

  return <View style={pendingStyle} />;
}

interface TodoTaskRowProps {
  text: string;
  status: TodoEntryStatus;
  animationsEnabled: boolean;
}

function TodoTaskRow({ text, status, animationsEnabled }: TodoTaskRowProps) {
  const flash = useSharedValue(0);
  const prevStatus = useRef(status);

  useEffect(() => {
    if (status === "completed" && prevStatus.current !== "completed" && animationsEnabled) {
      flash.value = 1;
      flash.value = withTiming(0, {
        duration: TODO_FLASH_DURATION,
        easing: Easing.out(Easing.quad),
      });
    }
    prevStatus.current = status;
  }, [status, animationsEnabled, flash]);

  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));
  const flashRowStyle = useMemo(() => [styles.taskFlash, flashStyle], [flashStyle]);

  const textStyle = useMemo(() => {
    if (status === "completed") {
      return [styles.taskText, styles.taskTextCompleted];
    }
    if (status === "pending") {
      return [styles.taskText, styles.taskTextPending];
    }
    return styles.taskText;
  }, [status]);

  return (
    <View style={styles.taskRow}>
      <Animated.View pointerEvents="none" style={flashRowStyle} />
      <TodoStatusMarker status={status} animationsEnabled={animationsEnabled} />
      <Text style={textStyle}>{text}</Text>
    </View>
  );
}

interface TodoProgressBarProps {
  progress: number;
  animationsEnabled: boolean;
}

function TodoProgressBar({ progress, animationsEnabled }: TodoProgressBarProps) {
  const progressWidth = useSharedValue(progress);
  useEffect(() => {
    if (animationsEnabled) {
      progressWidth.value = withTiming(progress, {
        duration: TODO_PROGRESS_DURATION,
        easing: Easing.out(Easing.quad),
      });
    } else {
      cancelAnimation(progressWidth);
      progressWidth.value = progress;
    }
  }, [progress, animationsEnabled, progressWidth]);

  const progressStyle = useAnimatedStyle(() => ({
    width: `${Math.max(0, Math.min(100, progressWidth.value * 100))}%`,
  }));
  const progressFillStyle = useMemo(() => [styles.progressFill, progressStyle], [progressStyle]);

  return (
    <View style={styles.progressTrack}>
      <Animated.View style={progressFillStyle} />
    </View>
  );
}

export interface TodoTaskListProps {
  items: TodoEntry[];
  animationsEnabled: boolean;
  emptyLabel: string;
}

/**
 * The reusable body of a task list — an animated progress bar plus the checkable
 * rows. Callers own the surrounding chrome (the inline card header, or the
 * floating pinned overlay's tinted header + dismiss). Shared so the transcript
 * card and the pinned overlay render one identical, consistent list.
 */
export function TodoTaskList({ items, animationsEnabled, emptyLabel }: TodoTaskListProps) {
  const { progress } = useTodoCounts(items);

  if (items.length === 0) {
    return <Text style={styles.emptyText}>{emptyLabel}</Text>;
  }

  return (
    <>
      <TodoProgressBar progress={progress} animationsEnabled={animationsEnabled} />
      <View style={styles.list}>
        {items.map((item) => (
          <TodoTaskRow
            key={item.id ?? item.text}
            text={item.text}
            status={item.status}
            animationsEnabled={animationsEnabled}
          />
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  progressTrack: {
    height: 3,
    marginHorizontal: theme.spacing[3],
    marginBottom: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.border,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.statusSuccess,
  },
  list: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[2],
  },
  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
    marginHorizontal: -theme.spacing[1],
    borderRadius: theme.borderRadius.base,
    overflow: "hidden",
  },
  taskFlash: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.colors.statusSuccessSurface,
  },
  marker: {
    width: 16,
    height: 16,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  markerCompleted: {
    backgroundColor: theme.colors.statusSuccess,
  },
  markerActive: {
    borderWidth: 1.5,
    borderColor: theme.colors.accent,
  },
  markerActiveDot: {
    width: 7,
    height: 7,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
  },
  markerPending: {
    borderWidth: 1.5,
    borderColor: theme.colors.border,
  },
  taskText: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  taskTextPending: {
    color: theme.colors.foregroundMuted,
  },
  taskTextCompleted: {
    color: theme.colors.foregroundMuted,
    textDecorationLine: "line-through",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
}));
