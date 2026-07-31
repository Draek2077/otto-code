import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Stop, Terminal, X } from "@/components/icons/material-icons";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { LiveElapsed } from "@/components/live-elapsed";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor } from "@/constants/layout";
import { ChatWidthBounds } from "@/components/chat-width-bounds";
import { ComposerTrackSeamShadow } from "@/composer/track-seam-shadow";
import { COMPOSER_TRACK_LAYERS, ComposerTrackTransition } from "@/composer/track-transition";
import { isNative } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import type { BackgroundShellTaskRow } from "./select";
import {
  formatBackgroundTaskElapsed,
  formatHeaderLabel,
  isBackgroundTaskRowFailed,
  isBackgroundTaskRowRunning,
  partitionBackgroundTaskRows,
  resolveBackgroundTaskRowAction,
  resolveRowLabel,
  type BackgroundTaskRowAction,
} from "./track-presentation";

const ThemedTerminal = withUnistyles(Terminal);
const ThemedStop = withUnistyles(Stop);
const ThemedClear = withUnistyles(X);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
// A failed row reads red throughout: icon, command, and elapsed. The failure is
// the only thing on the row that distinguishes it from a clean finish, so it has
// to be legible at a glance rather than inferred from which group it sits in.
const dangerColorMapping = (theme: Theme) => ({ color: theme.colors.statusDanger });

export interface BackgroundTasksTrackProps {
  rows: BackgroundShellTaskRow[];
  onStopTask: (id: string) => void;
  /** Clear the given rows off the track. Serves every clear control here. */
  onClearTasks: (ids: readonly string[]) => void;
}

const BACKGROUND_TASKS_LIST_MAX_HEIGHT = 200;

export function BackgroundTasksTrack({
  rows,
  onStopTask,
  onClearTasks,
}: BackgroundTasksTrackProps): ReactElement | null {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [completedExpanded, setCompletedExpanded] = useState(false);
  const [failedExpanded, setFailedExpanded] = useState(false);
  // A row the user just stopped stays pinned in the active list instead of
  // instantly tidying into a collapsed group under their pointer.
  const [pinnedIds, setPinnedIds] = useState<ReadonlySet<string>>(() => new Set());

  const toggleExpanded = useCallback(() => {
    setExpanded((current) => !current);
    setPinnedIds((pins) => (pins.size > 0 ? new Set<string>() : pins));
  }, []);
  const toggleCompletedExpanded = useCallback(() => {
    setCompletedExpanded((current) => !current);
  }, []);
  const toggleFailedExpanded = useCallback(() => {
    setFailedExpanded((current) => !current);
  }, []);

  const handleStopTask = useCallback(
    (id: string) => {
      setPinnedIds((pins) => {
        if (pins.has(id)) {
          return pins;
        }
        const next = new Set(pins);
        next.add(id);
        return next;
      });
      onStopTask(id);
    },
    [onStopTask],
  );

  const { active, completed, failed } = useMemo(
    () => partitionBackgroundTaskRows(rows, pinnedIds),
    [rows, pinnedIds],
  );
  const completedIds = useMemo(() => completed.map((row) => row.id), [completed]);
  const failedIds = useMemo(() => failed.map((row) => row.id), [failed]);
  const handleClearCompleted = useCallback(() => {
    onClearTasks(completedIds);
  }, [onClearTasks, completedIds]);
  const handleClearFailed = useCallback(() => {
    onClearTasks(failedIds);
  }, [onClearTasks, failedIds]);

  const surfaceStyle = useMemo(
    () => [styles.surface, expanded && styles.surfaceExpanded],
    [expanded],
  );

  const headerStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType) => [
      styles.header,
      expanded ? styles.headerDivider : styles.headerCollapsed,
      (hovered || pressed) && styles.headerActive,
    ],
    [expanded],
  );

  if (rows.length === 0) {
    return null;
  }

  // Summarize the same partition the list renders, so a pinned row is counted
  // in the group it is actually shown in.
  const headerLabel = formatHeaderLabel({ active, completed, failed });

  return (
    <ComposerTrackTransition layer={COMPOSER_TRACK_LAYERS.backgroundTasks}>
      <View style={styles.outer} testID="background-tasks-track">
        <ChatWidthBounds style={styles.track}>
          <View style={surfaceStyle}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={headerLabel}
              testID="background-tasks-track-header"
              onPress={toggleExpanded}
              style={headerStyle}
            >
              {expanded ? (
                <ThemedChevronDown size={12} uniProps={foregroundMutedColorMapping} />
              ) : (
                <ThemedChevronRight size={12} uniProps={foregroundMutedColorMapping} />
              )}
              <Text style={styles.headerLabel} numberOfLines={1}>
                {headerLabel}
              </Text>
            </Pressable>
            {expanded ? (
              <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
              >
                {active.map((row) => (
                  // Clear targets *this* row's id, not the bulk group list: a
                  // pinned row sits in the active list while still being
                  // terminal, so routing its X through a group handler would
                  // pass a list that never contains it and the X would do
                  // nothing.
                  <BackgroundTaskTrackRow
                    key={row.id}
                    row={row}
                    onStopTask={handleStopTask}
                    onClearTask={onClearTasks}
                  />
                ))}
                {completed.length > 0 ? (
                  <BackgroundTasksGroup
                    rows={completed}
                    flushTop={active.length === 0}
                    expanded={completedExpanded}
                    headerLabel={t("backgroundTasks.completedGroup", { count: completed.length })}
                    clearTooltip={t("backgroundTasks.clearCompletedTooltip")}
                    testIDPrefix="background-tasks-track-completed"
                    onToggle={toggleCompletedExpanded}
                    onClear={handleClearCompleted}
                    onStopTask={handleStopTask}
                    onClearOne={onClearTasks}
                  />
                ) : null}
                {failed.length > 0 ? (
                  <BackgroundTasksGroup
                    rows={failed}
                    flushTop={active.length === 0 && completed.length === 0}
                    expanded={failedExpanded}
                    headerLabel={t("backgroundTasks.failedGroup", { count: failed.length })}
                    clearTooltip={t("backgroundTasks.clearFailedTooltip")}
                    testIDPrefix="background-tasks-track-failed"
                    onToggle={toggleFailedExpanded}
                    onClear={handleClearFailed}
                    onStopTask={handleStopTask}
                    onClearOne={onClearTasks}
                  />
                ) : null}
              </ScrollView>
            ) : null}
            <ComposerTrackSeamShadow />
          </View>
        </ChatWidthBounds>
      </View>
    </ComposerTrackTransition>
  );
}

interface BackgroundTasksGroupProps {
  rows: BackgroundShellTaskRow[];
  /** Nothing rendered above, so drop the separator gap and sit flush. */
  flushTop: boolean;
  expanded: boolean;
  headerLabel: string;
  clearTooltip: string;
  testIDPrefix: string;
  onToggle: () => void;
  onClear: () => void;
  onStopTask: (id: string) => void;
  onClearOne: (ids: readonly string[]) => void;
}

// Finished work tidies itself but stays reachable: terminal rows collapse into
// a "Completed (N)" or "Failed (N)" group (collapsed by default) with a bulk
// "Clear all". One component for both because the two groups differ only in
// their wording and which rows they hold. Failures earn their own group rather
// than a shared one so clearing the noise never clears the signal with it.
// Mirrors subagents/track.tsx's CompletedSubagentsGroup.
function BackgroundTasksGroup({
  rows,
  flushTop,
  expanded,
  headerLabel,
  clearTooltip,
  testIDPrefix,
  onToggle,
  onClear,
  onStopTask,
  onClearOne,
}: BackgroundTasksGroupProps): ReactElement {
  const { t } = useTranslation();
  const clearLabel = t("backgroundTasks.clearCompleted");

  return (
    <View
      style={flushTop ? styles.completedGroupFlush : styles.completedGroup}
      testID={`${testIDPrefix}-group`}
    >
      <View style={styles.completedHeaderRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={headerLabel}
          testID={`${testIDPrefix}-toggle`}
          onPress={onToggle}
          style={styles.completedToggle}
        >
          {expanded ? (
            <ThemedChevronDown size={12} uniProps={foregroundMutedColorMapping} />
          ) : (
            <ThemedChevronRight size={12} uniProps={foregroundMutedColorMapping} />
          )}
          <Text style={styles.completedLabel} numberOfLines={1}>
            {headerLabel}
          </Text>
        </Pressable>
        <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={clearTooltip}
              testID={`${testIDPrefix}-clear`}
              onPress={onClear}
              style={styles.clearButton}
              hitSlop={8}
            >
              <Text style={styles.clearButtonText}>{clearLabel}</Text>
            </Pressable>
          </TooltipTrigger>
          <TooltipContent side="top" align="center" offset={8}>
            <Text style={styles.tooltipText}>{clearTooltip}</Text>
          </TooltipContent>
        </Tooltip>
      </View>
      {expanded
        ? rows.map((row) => (
            <BackgroundTaskTrackRow
              key={row.id}
              row={row}
              onStopTask={onStopTask}
              onClearTask={onClearOne}
            />
          ))
        : null}
    </View>
  );
}

interface BackgroundTaskTrackRowProps {
  row: BackgroundShellTaskRow;
  onStopTask: (id: string) => void;
  onClearTask: (ids: readonly string[]) => void;
}

function BackgroundTaskTrackRow({
  row,
  onStopTask,
  onClearTask,
}: BackgroundTaskTrackRowProps): ReactElement {
  const isCompact = useIsCompactFormFactor();
  const [hovered, setHovered] = useState(false);
  const displayLabel = resolveRowLabel(row);
  const rowAction = resolveBackgroundTaskRowAction(row.status);
  const isRunning = isBackgroundTaskRowRunning(row.status);
  const isFailed = isBackgroundTaskRowFailed(row);
  const frozenElapsed = formatBackgroundTaskElapsed(row);
  const handleStopPress = useCallback(() => {
    onStopTask(row.id);
  }, [onStopTask, row.id]);
  const handleClearPress = useCallback(() => {
    onClearTask([row.id]);
  }, [onClearTask, row.id]);
  const handlePointerEnter = useCallback(() => setHovered(true), []);
  const handlePointerLeave = useCallback(() => setHovered(false), []);
  const actionsVisible = isNative || isCompact || hovered;

  return (
    // Plain View owns hover per docs/hover.md — onPointerEnter/Leave here,
    // separate inner Pressables for the action buttons.
    <View
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      style={hovered ? styles.rowActive : styles.row}
      testID={`background-tasks-track-row-${row.id}`}
    >
      <ThemedTerminal
        size={14}
        uniProps={isFailed ? dangerColorMapping : foregroundMutedColorMapping}
      />
      <Text style={isFailed ? styles.rowLabelFailed : styles.rowLabel} numberOfLines={1}>
        {displayLabel}
      </Text>
      <BackgroundTaskElapsed
        rowId={row.id}
        startedAt={row.createdAt}
        isRunning={isRunning}
        isFailed={isFailed}
        frozenElapsed={frozenElapsed}
      />
      <BackgroundTaskRowActions
        rowId={row.id}
        displayLabel={displayLabel}
        visible={actionsVisible}
        rowAction={rowAction}
        onStopPress={handleStopPress}
        onClearPress={handleClearPress}
      />
    </View>
  );
}

function BackgroundTaskElapsed({
  rowId,
  startedAt,
  isRunning,
  isFailed,
  frozenElapsed,
}: {
  rowId: string;
  startedAt: string;
  isRunning: boolean;
  isFailed: boolean;
  frozenElapsed: string | null;
}): ReactElement | null {
  if (isRunning) {
    return (
      <LiveElapsed
        startedAt={new Date(startedAt)}
        active
        style={styles.rowMeta}
        testID={`background-tasks-track-elapsed-${rowId}`}
      />
    );
  }
  if (!frozenElapsed) {
    return null;
  }
  return (
    <Text
      style={isFailed ? styles.rowMetaFailed : styles.rowMeta}
      numberOfLines={1}
      testID={`background-tasks-track-elapsed-${rowId}`}
    >
      {frozenElapsed}
    </Text>
  );
}

function BackgroundTaskRowActions({
  rowId,
  displayLabel,
  visible,
  rowAction,
  onStopPress,
  onClearPress,
}: {
  rowId: string;
  displayLabel: string;
  visible: boolean;
  rowAction: BackgroundTaskRowAction;
  onStopPress: () => void;
  onClearPress: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <View
      style={visible ? styles.actionClusterVisible : styles.actionClusterHidden}
      pointerEvents={visible ? "auto" : "none"}
    >
      {rowAction === "stop" ? (
        <BackgroundTaskActionButton
          accessibilityLabel={t("backgroundTasks.stopAction", { label: displayLabel })}
          testID={`background-tasks-track-stop-${rowId}`}
          tooltipLabel={t("backgroundTasks.stopTooltip")}
          icon="stop"
          visible={visible}
          onPress={onStopPress}
        />
      ) : (
        <BackgroundTaskActionButton
          accessibilityLabel={t("backgroundTasks.clearAction", { label: displayLabel })}
          testID={`background-tasks-track-clear-${rowId}`}
          tooltipLabel={t("backgroundTasks.clearTooltip")}
          icon="clear"
          visible={visible}
          onPress={onClearPress}
        />
      )}
    </View>
  );
}

type BackgroundTaskActionIcon = "stop" | "clear";

function renderBackgroundTaskActionIcon(
  icon: BackgroundTaskActionIcon,
  isActive: boolean,
): ReactElement {
  const uniProps = isActive ? foregroundColorMapping : foregroundMutedColorMapping;
  if (icon === "stop") {
    return <ThemedStop size={14} uniProps={uniProps} />;
  }
  return <ThemedClear size={14} uniProps={uniProps} />;
}

function BackgroundTaskActionButton({
  accessibilityLabel,
  testID,
  tooltipLabel,
  icon,
  visible,
  onPress,
}: {
  accessibilityLabel: string;
  testID: string;
  tooltipLabel: string;
  icon: BackgroundTaskActionIcon;
  visible: boolean;
  onPress: () => void;
}): ReactElement {
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild disabled={!visible}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          testID={testID}
          onPress={onPress}
          style={styles.actionButton}
          hitSlop={8}
        >
          {({ hovered, pressed }) => renderBackgroundTaskActionIcon(icon, hovered || pressed)}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{tooltipLabel}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  outer: {
    width: "100%",
    alignItems: "center",
    paddingHorizontal: theme.spacing[4],
  },
  track: {
    width: "100%",
    marginBottom: -theme.spacing[4],
  },
  surface: {
    alignSelf: "stretch",
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderBottomWidth: 0,
    borderTopLeftRadius: theme.borderRadius["2xl"],
    borderTopRightRadius: theme.borderRadius["2xl"],
    overflow: "hidden",
  },
  surfaceExpanded: {
    paddingBottom: theme.spacing[4],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  headerCollapsed: {
    paddingBottom: theme.spacing[6],
  },
  headerActive: {
    backgroundColor: theme.colors.surface2,
  },
  headerDivider: {
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  headerLabel: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  scroll: {
    maxHeight: BACKGROUND_TASKS_LIST_MAX_HEIGHT,
  },
  scrollContent: {
    paddingVertical: theme.spacing[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  rowActive: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.surface2,
  },
  rowLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  rowLabelFailed: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.statusDanger,
  },
  rowMeta: {
    flexShrink: 0,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    fontVariant: ["tabular-nums"],
  },
  rowMetaFailed: {
    flexShrink: 0,
    fontSize: theme.fontSize.xs,
    color: theme.colors.statusDanger,
    fontVariant: ["tabular-nums"],
  },
  completedGroup: {
    marginTop: theme.spacing[1],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  // The separator only earns its space when active rows sit above the group.
  completedGroupFlush: {},
  completedHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  completedToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 1,
    minWidth: 0,
  },
  completedLabel: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  clearButton: {
    flexShrink: 0,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  clearButtonText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  actionClusterVisible: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    opacity: 1,
  },
  actionClusterHidden: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    opacity: 0,
  },
  actionButton: {
    padding: theme.spacing[1],
    alignItems: "center",
    justifyContent: "center",
  },
  tooltipText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
  },
}));
