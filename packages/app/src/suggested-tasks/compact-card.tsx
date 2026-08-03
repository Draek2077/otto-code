import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, ChevronRight, Lightbulb } from "@/components/icons/material-icons";
import type { Theme } from "@/styles/theme";
import type { TasksSuggestedStartMode } from "@otto-code/protocol/messages";
import type { SuggestedTaskRow } from "./select";
import { DismissButton, MODE_META, SplitStartButton } from "./start-controls";
import type { SuggestedTaskActions } from "./use-suggested-task-actions";

const ThemedLightbulb = withUnistyles(Lightbulb);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const statusInfoColorMapping = (theme: Theme) => ({ color: theme.colors.statusInfo });

// Shorter than the desktop cap for the same reason the checklist is: this card
// floats over the transcript, and on a phone a tall card is a takeover.
const COMPACT_LIST_MAX_HEIGHT = 260;

const EXPANDED_STATE = { expanded: true } as const;
const COLLAPSED_STATE = { expanded: false } as const;

export interface CompactSuggestedTasksCardProps {
  rows: SuggestedTaskRow[];
  actions: SuggestedTaskActions;
  defaultMode: TasksSuggestedStartMode;
  rowSecondaryModes: readonly TasksSuggestedStartMode[];
  bulkPrimaryMode: TasksSuggestedStartMode;
  bulkSecondaryModes: readonly TasksSuggestedStartMode[];
}

/**
 * The phone form of the suggested-task queue: one row deep until the user asks
 * for the detail. The collapsed row says how many offers are waiting and carries
 * the bulk action itself — with several queued, that row *is* "start all", so a
 * user who already trusts the suggestions never has to expand. Tapping the label
 * opens the same per-task rows the desktop card shows, each with its own split
 * button, for a user who wants to pick.
 *
 * With a single suggestion the row degrades to that task: its title as the label
 * and its own start button, since "start all" of one thing is just "start it".
 */
export function CompactSuggestedTasksCard({
  rows,
  actions,
  defaultMode,
  rowSecondaryModes,
  bulkPrimaryMode,
  bulkSecondaryModes,
}: CompactSuggestedTasksCardProps): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const allTaskIds = useMemo(() => rows.map((row) => row.taskId), [rows]);
  const toggle = useCallback(() => {
    setExpanded((previous) => !previous);
  }, []);

  const isBulk = rows.length >= 2;
  // Safe: the overlay renders nothing for an empty queue, so row 0 always exists.
  const singleRow = rows[0];
  const summary = isBulk
    ? `${rows.length} suggested tasks`
    : (singleRow?.title ?? "Suggested task");

  return (
    <>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={expanded ? EXPANDED_STATE : COLLAPSED_STATE}
          accessibilityLabel={summary}
          testID="suggested-tasks-compact-toggle"
          onPress={toggle}
          style={styles.toggle}
        >
          {expanded ? (
            <ThemedChevronDown size={16} uniProps={foregroundMutedColorMapping} />
          ) : (
            <ThemedChevronRight size={16} uniProps={foregroundMutedColorMapping} />
          )}
          <ThemedLightbulb size={14} uniProps={statusInfoColorMapping} />
          <Text style={styles.label} numberOfLines={1}>
            {summary}
          </Text>
        </Pressable>
        <SplitStartButton
          primaryMode={isBulk ? bulkPrimaryMode : defaultMode}
          secondaryModes={isBulk ? bulkSecondaryModes : rowSecondaryModes}
          primaryLabel={isBulk ? "Start all" : MODE_META[defaultMode].primaryLabel}
          accessibilityLabel={
            isBulk ? "Start all suggested tasks" : `Start suggested task: ${summary}`
          }
          testIdBase={
            isBulk
              ? "suggested-tasks-overlay-start-all"
              : `suggested-tasks-overlay-start-${singleRow?.taskId ?? "none"}`
          }
          taskIds={allTaskIds}
          actions={actions}
          showDismiss={!isBulk}
        />
        <DismissButton
          taskIds={allTaskIds}
          actions={actions}
          accessibilityLabel={isBulk ? "Dismiss all suggested tasks" : "Dismiss suggested task"}
          tooltip={isBulk ? "Dismiss all" : "Dismiss"}
          testID="suggested-tasks-overlay-dismiss-all"
        />
      </View>
      {expanded ? (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
        >
          {rows.map((row) => (
            <CompactSuggestedTaskItem
              key={row.taskId}
              row={row}
              actions={actions}
              defaultMode={defaultMode}
              secondaryModes={rowSecondaryModes}
            />
          ))}
        </ScrollView>
      ) : null}
    </>
  );
}

interface CompactSuggestedTaskItemProps {
  row: SuggestedTaskRow;
  actions: SuggestedTaskActions;
  defaultMode: TasksSuggestedStartMode;
  secondaryModes: readonly TasksSuggestedStartMode[];
}

// Stacked rather than side-by-side: at phone width a title, a two-line summary
// and a split button on one line leaves the text about eighty pixels, which
// truncates every suggestion into uselessness. The button drops below instead.
function CompactSuggestedTaskItem({
  row,
  actions,
  defaultMode,
  secondaryModes,
}: CompactSuggestedTaskItemProps): ReactElement {
  const taskIds = useMemo(() => [row.taskId], [row.taskId]);
  return (
    <View style={styles.task} testID={`suggested-tasks-overlay-row-${row.taskId}`}>
      <Text style={styles.taskTitle} numberOfLines={2}>
        {row.title}
      </Text>
      <Text style={styles.taskTldr} numberOfLines={3}>
        {row.tldr}
      </Text>
      <View style={styles.taskActions}>
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
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    backgroundColor: theme.colors.statusInfoSurface,
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  toggle: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  label: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  list: {
    maxHeight: COMPACT_LIST_MAX_HEIGHT,
    // Same wash as the collapsed row, so the card reads as one tinted object.
    backgroundColor: theme.colors.statusInfoSurface,
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  listContent: {
    paddingVertical: theme.spacing[1],
  },
  task: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
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
  taskActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingTop: theme.spacing[1],
  },
}));
