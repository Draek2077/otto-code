import { useMemo, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Lightbulb } from "@/components/icons/material-icons";
import { useSettings } from "@/hooks/use-settings";
import { useAnimationsEnabled } from "@/hooks/use-animations-enabled";
import {
  COMPOSER_TRACK_FLY_IN_DURATION_MS,
  COMPOSER_TRACK_FLY_OUT_DURATION_MS,
} from "@/constants/animation";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { Theme } from "@/styles/theme";
import type { TasksSuggestedStartMode } from "@otto-code/protocol/messages";
import { CompactSuggestedTasksCard } from "./compact-card";
import type { SuggestedTaskRow } from "./select";
import {
  ALL_MODES,
  BULK_MODES,
  DismissButton,
  MODE_META,
  SplitStartButton,
} from "./start-controls";
import type { SuggestedTaskActions } from "./use-suggested-task-actions";

const ThemedLightbulb = withUnistyles(Lightbulb);

const statusInfoColorMapping = (theme: Theme) => ({ color: theme.colors.statusInfo });

const LIST_MAX_HEIGHT = 300;

export interface SuggestedTasksOverlayProps {
  rows: SuggestedTaskRow[];
  actions: SuggestedTaskActions;
}

// The card rises into place from below when it appears and sinks back down when
// dismissed - the same fly-up / fly-down idiom as the composer detail cards (see
// composer/track-transition.tsx), so every card that pops over the chat reads as
// one motion language. We use Reanimated's FadeInDown/FadeOutDown PRESETS (fade +
// short rise/sink) rather than a custom worklet on purpose: the worklet-function
// form of a layout animation is a no-op on web/Electron, and this overlay is
// most often seen on desktop. Presets play on every platform. Both fire the exit
// before unmount, so the card animates out even though it returns null when the
// queue empties.
const flyIn = FadeInDown.duration(COMPOSER_TRACK_FLY_IN_DURATION_MS);
const flyOut = FadeOutDown.duration(COMPOSER_TRACK_FLY_OUT_DURATION_MS);

// A floating, non-blocking card that pops over the TOP of the chat when an agent
// suggests one or more tasks. The user answers each asynchronously via a split
// button (primary = their default mode, caret = the other modes + Dismiss), or
// closes the whole card with the title-bar X. It never steals composer focus and
// persists until the queue is empty. Mounted inside the chat content container
// (not a Portal) so it stays within bounds - Android hit-testing needs the card
// inside its parent (see docs/floating-panels.md).
//
// On a phone the same queue collapses to a single row (see compact-card.tsx):
// the full card's stacked title + summary + per-row button is wider than a phone
// has to give, and it lands on top of the transcript it is annotating.
export function SuggestedTasksOverlay({
  rows,
  actions,
}: SuggestedTasksOverlayProps): ReactElement | null {
  const enabled = useSettings((settings) => settings.suggestedTasksEnabled);
  // Honors Appearance → Animations: with motion off the card mounts and unmounts
  // instantly (no enter/exit), exactly as the composer detail cards do.
  const animate = useAnimationsEnabled();
  const isCompact = useIsCompactFormFactor();
  const defaultMode = useSettings((settings) => settings.suggestedTasksDefaultMode);
  const allTaskIds = useMemo(() => rows.map((row) => row.taskId), [rows]);
  // Secondary options for a per-row split button: every mode except the default.
  const rowSecondaryModes = useMemo(
    () => ALL_MODES.filter((mode) => mode !== defaultMode),
    [defaultMode],
  );
  // "Start all" can't do in_session, so its primary falls back to new_chat when
  // the user's default is in_session; its caret lists the rest.
  const bulkPrimaryMode: TasksSuggestedStartMode =
    defaultMode === "in_session" ? "new_chat" : defaultMode;
  const bulkSecondaryModes = useMemo(
    () => BULK_MODES.filter((mode) => mode !== bulkPrimaryMode),
    [bulkPrimaryMode],
  );

  // Suppressed on this device, or nothing pending → render nothing.
  if (!enabled || rows.length === 0) {
    return null;
  }
  const showBulk = rows.length >= 2;

  return (
    <Animated.View
      entering={animate ? flyIn : undefined}
      exiting={animate ? flyOut : undefined}
      style={styles.card}
      testID="suggested-tasks-overlay"
    >
      {isCompact ? (
        <CompactSuggestedTasksCard
          rows={rows}
          actions={actions}
          defaultMode={defaultMode}
          rowSecondaryModes={rowSecondaryModes}
          bulkPrimaryMode={bulkPrimaryMode}
          bulkSecondaryModes={bulkSecondaryModes}
        />
      ) : (
        <>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <ThemedLightbulb size={14} uniProps={statusInfoColorMapping} />
              <Text style={styles.headerLabel} numberOfLines={1}>
                {rows.length === 1 ? "Suggested task" : `Suggested tasks (${rows.length})`}
              </Text>
            </View>
            <View style={styles.headerRight}>
              {showBulk ? (
                <SplitStartButton
                  primaryMode={bulkPrimaryMode}
                  secondaryModes={bulkSecondaryModes}
                  primaryLabel="Start all"
                  accessibilityLabel="Start all suggested tasks"
                  testIdBase="suggested-tasks-overlay-start-all"
                  taskIds={allTaskIds}
                  actions={actions}
                />
              ) : null}
              <DismissButton
                taskIds={allTaskIds}
                actions={actions}
                accessibilityLabel={
                  showBulk ? "Dismiss all suggested tasks" : "Dismiss suggested task"
                }
                tooltip={showBulk ? "Dismiss all" : "Dismiss"}
                testID="suggested-tasks-overlay-dismiss-all"
              />
            </View>
          </View>
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
          >
            {rows.map((row) => (
              <SuggestedTaskItem
                key={row.taskId}
                row={row}
                actions={actions}
                defaultMode={defaultMode}
                secondaryModes={rowSecondaryModes}
              />
            ))}
          </ScrollView>
        </>
      )}
    </Animated.View>
  );
}

interface SuggestedTaskItemProps {
  row: SuggestedTaskRow;
  actions: SuggestedTaskActions;
  defaultMode: TasksSuggestedStartMode;
  secondaryModes: readonly TasksSuggestedStartMode[];
}

function SuggestedTaskItem({
  row,
  actions,
  defaultMode,
  secondaryModes,
}: SuggestedTaskItemProps): ReactElement {
  const taskIds = useMemo(() => [row.taskId], [row.taskId]);
  return (
    <View style={styles.task} testID={`suggested-tasks-overlay-row-${row.taskId}`}>
      <View style={styles.taskText}>
        <Text style={styles.taskTitle} numberOfLines={1}>
          {row.title}
        </Text>
        <Text style={styles.taskTldr} numberOfLines={2}>
          {row.tldr}
        </Text>
      </View>
      <SplitStartButton
        primaryMode={defaultMode}
        secondaryModes={secondaryModes}
        primaryLabel={MODE_META[defaultMode].primaryLabel}
        accessibilityLabel={`Start suggested task: ${row.title}`}
        testIdBase={`suggested-tasks-overlay-start-${row.taskId}`}
        taskIds={taskIds}
        actions={actions}
        showDismiss
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Positioning, the PIP inset and the stacking slot all belong to the shared
  // column this card is rendered into (panels/chat-top-overlay-stack.tsx).
  card: {
    width: "100%",
    maxWidth: 460,
    // The card is an offer of work, not a log line, so it takes the info tone
    // from the status-tint family (docs/design.md §12) instead of the neutral
    // panel chrome used elsewhere: a sky ring around a sky-washed interior.
    // Deliberately NOT the theme accent - accent is the CTA colour and already
    // paints the start button below, so an accent card would read as more of
    // the same chrome; and on the monochrome variants accentBright is
    // near-white, which would leave this card with no hue at all. Blue also
    // stays put across all 13 variants, so "a suggestion" always looks like a
    // suggestion.
    //
    // surface2 is the opaque base under the children's alpha washes - the card
    // floats over the stream, so it cannot be washed directly or chat text
    // would show through.
    backgroundColor: theme.colors.surface2,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.statusInfo,
    borderRadius: theme.borderRadius["2xl"],
    overflow: "hidden",
    ...theme.shadow.md,
  },
  header: {
    backgroundColor: theme.colors.statusInfoSurface,
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
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  list: {
    maxHeight: LIST_MAX_HEIGHT,
    // Same wash as the header band, so the card reads as one tinted object;
    // the header separates on its bottom border alone.
    backgroundColor: theme.colors.statusInfoSurface,
  },
  listContent: {
    paddingVertical: theme.spacing[1],
  },
  task: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  taskText: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  taskTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  taskTldr: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    lineHeight: theme.fontSize.xs * 1.4,
  },
}));
