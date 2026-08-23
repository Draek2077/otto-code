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
import {
  resolveTodoEntryStatus,
  resolveTodoEntryText,
  type TodoEntry,
  type TodoEntryStatus,
} from "@/types/stream";

const ThemedTodoCheckIcon = withUnistyles(Check);
const primaryForegroundColorMapping = (theme: Theme) => ({ color: theme.colors.primaryForeground });

// Motion durations for the task list. Kept short so a live check-off reads as
// confirmation, not decoration - the list must never feel busy.
const TODO_PULSE_DURATION = 900;
const TODO_CHECK_DURATION = 260;
const TODO_FLASH_DURATION = 700;
const TODO_PROGRESS_DURATION = 320;

/**
 * The three states a whole checklist can be in, as read at a glance from a
 * collapsed row: nothing picked up yet, work underway, everything done.
 */
export type TodoPhase = "empty" | "partial" | "done";

export interface TodoCounts {
  completedCount: number;
  inProgressCount: number;
  total: number;
  progress: number;
  phase: TodoPhase;
}

function resolveTodoPhase(completedCount: number, inProgressCount: number, total: number) {
  if (total > 0 && completedCount === total) {
    return "done" as const;
  }
  if (completedCount === 0 && inProgressCount === 0) {
    return "empty" as const;
  }
  return "partial" as const;
}

export function useTodoCounts(items: TodoEntry[]): TodoCounts {
  return useMemo(() => {
    const total = items.length;
    let completedCount = 0;
    let inProgressCount = 0;
    for (const item of items) {
      const status = resolveTodoEntryStatus(item);
      if (status === "completed") {
        completedCount += 1;
      } else if (status === "in_progress") {
        inProgressCount += 1;
      }
    }
    return {
      completedCount,
      inProgressCount,
      total,
      progress: total > 0 ? completedCount / total : 0,
      phase: resolveTodoPhase(completedCount, inProgressCount, total),
    };
  }, [items]);
}

interface TodoSummaryMarkerProps {
  phase: TodoPhase;
  animationsEnabled: boolean;
}

/**
 * One glyph standing in for an entire checklist - what the collapsed compact
 * card shows instead of the rows. A hollow ring while nothing has started, a
 * pulsing accent dot while the agent is partway through, a filled success check
 * once every task is done. Larger than the per-row {@link TodoStatusMarker}
 * because on a phone it is the only status the user gets until they expand.
 */
export function TodoSummaryMarker({ phase, animationsEnabled }: TodoSummaryMarkerProps) {
  const pulse = useSharedValue(phase === "partial" ? 1 : 0);

  useEffect(() => {
    if (phase === "partial" && animationsEnabled) {
      pulse.value = withRepeat(
        withTiming(0, { duration: TODO_PULSE_DURATION, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = phase === "partial" ? 1 : 0;
    }
  }, [phase, animationsEnabled, pulse]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: 0.4 + pulse.value * 0.6,
    transform: [{ scale: 0.7 + pulse.value * 0.3 }],
  }));

  const doneStyle = useMemo(() => [styles.summaryMarker, styles.summaryMarkerDone], []);
  const partialStyle = useMemo(() => [styles.summaryMarker, styles.summaryMarkerPartial], []);
  const emptyStyle = useMemo(() => [styles.summaryMarker, styles.summaryMarkerEmpty], []);
  const partialDotStyle = useMemo(() => [styles.summaryMarkerPartialDot, pulseStyle], [pulseStyle]);

  if (phase === "done") {
    return (
      <View style={doneStyle}>
        <ThemedTodoCheckIcon size={12} uniProps={primaryForegroundColorMapping} />
      </View>
    );
  }

  if (phase === "partial") {
    return (
      <View style={partialStyle}>
        <Animated.View style={partialDotStyle} />
      </View>
    );
  }

  return <View style={emptyStyle} />;
}

interface TodoStatusMarkerProps {
  status: TodoEntryStatus;
  animationsEnabled: boolean;
}

/**
 * The per-task marker: a filled check when done, a pulsing accent ring for the
 * task the agent is working on right now, a hollow ring for what's queued. The
 * check scales in only on a live transition into completed - never on first
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

export interface TodoTaskListProgressProps {
  items: TodoEntry[];
  animationsEnabled: boolean;
}

/** An animated checklist progress bar that can stay visible while rows are collapsed. */
export function TodoTaskListProgress({ items, animationsEnabled }: TodoTaskListProgressProps) {
  const { progress } = useTodoCounts(items);
  return <TodoProgressBar progress={progress} animationsEnabled={animationsEnabled} />;
}

export interface TodoTaskListProps {
  items: TodoEntry[];
  animationsEnabled: boolean;
  emptyLabel: string;
  showProgress?: boolean;
}

/**
 * The reusable body of a task list - an animated progress bar plus the checkable
 * rows. Callers own the surrounding chrome (the inline card header, or the
 * floating pinned overlay's tinted header + dismiss). Shared so the transcript
 * card and the pinned overlay render one identical, consistent list.
 */
export function TodoTaskList({
  items,
  animationsEnabled,
  emptyLabel,
  showProgress = true,
}: TodoTaskListProps) {
  if (items.length === 0) {
    return <Text style={styles.emptyText}>{emptyLabel}</Text>;
  }

  return (
    <>
      {showProgress ? (
        <TodoTaskListProgress items={items} animationsEnabled={animationsEnabled} />
      ) : null}
      <View style={styles.list}>
        {items.map((item) => (
          <TodoTaskRow
            key={item.id ?? item.text}
            text={resolveTodoEntryText(item)}
            status={resolveTodoEntryStatus(item)}
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
  // The collapsed-card summary glyph. Sized for a touch row rather than a list
  // line, so it stays legible as the only progress signal on a phone.
  summaryMarker: {
    width: 18,
    height: 18,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  summaryMarkerDone: {
    backgroundColor: theme.colors.statusSuccess,
  },
  summaryMarkerPartial: {
    borderWidth: 1.5,
    borderColor: theme.colors.accent,
  },
  summaryMarkerPartialDot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
  },
  summaryMarkerEmpty: {
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
