import { useCallback, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import {
  FlatList,
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
} from "react-native";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { isWeb } from "@/constants/platform";
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
const taskKey = (row: SuggestedTaskRow) => row.taskId;

export interface CompactSuggestedTasksCardProps {
  modelControl?: ReactNode;
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
 * the bulk action itself - with several queued, that row *is* "start all", so a
 * user who already trusts the suggestions never has to expand. Tapping the label
 * opens the same per-task rows the desktop card shows, each with its own split
 * button, for a user who wants to pick.
 *
 * With a single suggestion the row degrades to that task: its title as the label
 * and its own start button, since "start all" of one thing is just "start it".
 */
export function CompactSuggestedTasksCard({
  modelControl,
  rows,
  actions,
  defaultMode,
  rowSecondaryModes,
  bulkPrimaryMode,
  bulkSecondaryModes,
}: CompactSuggestedTasksCardProps): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [compact, setCompact] = useState(true);
  const handleHeaderLayout = useCallback((event: LayoutChangeEvent) => {
    setCompact(event.nativeEvent.layout.width < 440);
  }, []);
  const scrollRef = useRef<FlatList<SuggestedTaskRow>>(null);
  const scrollbar = useWebScrollViewScrollbar(scrollRef, { enabled: isWeb && expanded });
  const renderTask = useCallback(
    ({ item }: ListRenderItemInfo<SuggestedTaskRow>) => (
      <CompactSuggestedTaskItem
        row={item}
        actions={actions}
        defaultMode={defaultMode}
        secondaryModes={rowSecondaryModes}
      />
    ),
    [actions, defaultMode, rowSecondaryModes],
  );
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
      <View style={[styles.row, compact && styles.rowCompact]} onLayout={handleHeaderLayout}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={expanded ? EXPANDED_STATE : COLLAPSED_STATE}
          accessibilityLabel={summary}
          testID="suggested-tasks-compact-toggle"
          onPress={toggle}
          style={[styles.toggle, compact && styles.toggleCompact]}
        >
          {expanded ? (
            <ThemedChevronDown size="md" uniProps={foregroundMutedColorMapping} />
          ) : (
            <ThemedChevronRight size="md" uniProps={foregroundMutedColorMapping} />
          )}
          <ThemedLightbulb size="sm" uniProps={statusInfoColorMapping} />
          <Text style={styles.label} numberOfLines={1}>
            {summary}
          </Text>
        </Pressable>
        <View style={[styles.controls, compact && styles.controlsCompact]}>
          <View style={styles.modelControl} testID="suggested-task-model-picker">
            {modelControl}
          </View>
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
        </View>
        <View style={styles.dismiss}>
          <DismissButton
            taskIds={allTaskIds}
            actions={actions}
            accessibilityLabel={isBulk ? "Dismiss all suggested tasks" : "Dismiss suggested task"}
            tooltip={isBulk ? "Dismiss all" : "Dismiss"}
            testID="suggested-tasks-overlay-dismiss-all"
          />
        </View>
      </View>
      {expanded ? (
        <View style={styles.listFrame}>
          <FlatList
            ref={scrollRef}
            data={rows}
            keyExtractor={taskKey}
            renderItem={renderTask}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            onLayout={scrollbar.onLayout}
            onScroll={scrollbar.onScroll}
            onContentSizeChange={scrollbar.onContentSizeChange}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={!isWeb}
            nestedScrollEnabled
          />
          {scrollbar.overlay}
        </View>
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

// Keep the action beside the wrapping title; the summary owns the full row below.
function CompactSuggestedTaskItem({
  row,
  actions,
  defaultMode,
  secondaryModes,
}: CompactSuggestedTaskItemProps): ReactElement {
  const taskIds = useMemo(() => [row.taskId], [row.taskId]);
  return (
    <View style={styles.task} testID={`suggested-tasks-overlay-row-${row.taskId}`}>
      <View style={styles.taskHeading}>
        <Text style={styles.taskTitle}>{row.title}</Text>
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
      <Text style={styles.taskTldr}>{row.tldr}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  controls: {
    flexDirection: "row",
    flexBasis: 216,
    marginRight: theme.iconSize.md + theme.spacing[2] + theme.spacing[2],
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    maxWidth: "100%",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  controlsCompact: { flexBasis: "auto", width: "100%", marginRight: 0 },
  rowCompact: { flexDirection: "column", alignItems: "stretch" },
  toggleCompact: {
    paddingRight: theme.iconSize.md + theme.spacing[2] + theme.spacing[2],
  },
  dismiss: { position: "absolute", right: theme.spacing[2], top: theme.spacing[2] },
  // The model name never participates in the row's intrinsic width or wrap gate.
  modelControl: { flexBasis: 108, flexGrow: 1, flexShrink: 1, minWidth: 0, maxWidth: 180 },
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
    flexGrow: 1,
    flexShrink: 1,
    maxWidth: "100%",
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
  listFrame: {
    maxHeight: COMPACT_LIST_MAX_HEIGHT,
    // Same wash as the collapsed row, so the card reads as one tinted object.
    backgroundColor: theme.colors.statusInfoSurface,
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  list: { maxHeight: COMPACT_LIST_MAX_HEIGHT },
  listContent: {
    paddingVertical: theme.spacing[1],
  },
  task: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    gap: theme.spacing[1],
  },
  taskTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  taskTldr: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    lineHeight: theme.fontSize.xs * 1.4,
  },
  taskHeading: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
}));
