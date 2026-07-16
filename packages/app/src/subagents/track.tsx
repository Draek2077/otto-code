import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Stop,
  Unlink,
} from "@/components/icons/material-icons";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { getProviderIcon } from "@/components/provider-icons";
import { LiveElapsed } from "@/components/live-elapsed";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor } from "@/constants/layout";
import { ChatWidthBounds } from "@/components/chat-width-bounds";
import { isNative } from "@/constants/platform";
import {
  WorkspaceTabIcon,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-presentation";
import type { Theme } from "@/styles/theme";
import type { ClearableSubagentRow } from "./clear-completed-subagents";
import type { SubagentRow } from "./select";
import {
  buildSubagentRowPresentationData,
  formatCompactTokenCount,
  formatHeaderLabel,
  formatSubagentElapsed,
  isSubagentRowRunning,
  partitionSubagentRows,
  resolveSubagentRowAction,
  type SubagentRowAction,
} from "./track-presentation";

const ThemedArchive = withUnistyles(Archive);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedStop = withUnistyles(Stop);
const ThemedUnlink = withUnistyles(Unlink);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

export interface SubagentsTrackProps {
  rows: SubagentRow[];
  onOpenSubagent: (id: string) => void;
  onArchiveSubagent: (id: string) => void;
  onStopSubagent: (id: string) => void;
  onClearCompleted: (rows: readonly ClearableSubagentRow[]) => void;
  onDetachSubagent?: (id: string) => void;
  // Tokens from rows already cleared out of this track, added into the header
  // total so the honest fan-out cost survives the clear. See
  // subagents/cleared-subagent-tokens-store.ts.
  clearedTokens?: number;
}

const SUBAGENTS_LIST_MAX_HEIGHT = 200;

function buildRowPresentation(row: SubagentRow): WorkspaceTabPresentation {
  return {
    ...buildSubagentRowPresentationData(row),
    icon: getProviderIcon(row.provider),
    // Personality-spawned subagents keep their identity colors on the glyph
    // and busy loader; rows without one fall back to the plain themed icon.
    personalitySpinner: row.personalitySpinner ?? null,
    provider: row.provider,
  };
}

export function SubagentsTrack({
  rows,
  onOpenSubagent,
  onArchiveSubagent,
  onStopSubagent,
  onClearCompleted,
  onDetachSubagent,
  clearedTokens = 0,
}: SubagentsTrackProps): ReactElement | null {
  const [expanded, setExpanded] = useState(false);
  const [completedExpanded, setCompletedExpanded] = useState(false);
  // Rows the user just stopped stay pinned in the active list instead of
  // instantly tidying into the collapsed Completed group under their pointer.
  // Toggling the track open/closed is the natural boundary that unpins them.
  const [pinnedIds, setPinnedIds] = useState<ReadonlySet<string>>(() => new Set());

  const toggleExpanded = useCallback(() => {
    setExpanded((current) => !current);
    setPinnedIds((pins) => (pins.size > 0 ? new Set<string>() : pins));
  }, []);
  const toggleCompletedExpanded = useCallback(() => {
    setCompletedExpanded((current) => !current);
  }, []);

  const handleStopSubagent = useCallback(
    (id: string) => {
      setPinnedIds((pins) => {
        if (pins.has(id)) {
          return pins;
        }
        const next = new Set(pins);
        next.add(id);
        return next;
      });
      onStopSubagent(id);
    },
    [onStopSubagent],
  );

  const { active, completed } = useMemo(
    () => partitionSubagentRows(rows, pinnedIds),
    [rows, pinnedIds],
  );
  const completedClearRows = useMemo<ClearableSubagentRow[]>(
    () => completed.map((row) => ({ id: row.id, cumulativeTokens: row.cumulativeTokens })),
    [completed],
  );
  const handleClearCompleted = useCallback(() => {
    onClearCompleted(completedClearRows);
  }, [onClearCompleted, completedClearRows]);

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

  const headerLabel = formatHeaderLabel({ active, completed }, clearedTokens);

  return (
    <View style={styles.outer} testID="subagents-track">
      <ChatWidthBounds style={styles.track}>
        <View style={surfaceStyle}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={headerLabel}
            testID="subagents-track-header"
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
                <SubagentsTrackRow
                  key={row.id}
                  row={row}
                  onOpenSubagent={onOpenSubagent}
                  onArchiveSubagent={onArchiveSubagent}
                  onStopSubagent={handleStopSubagent}
                  onDetachSubagent={onDetachSubagent}
                />
              ))}
              {completed.length > 0 ? (
                <CompletedSubagentsGroup
                  rows={completed}
                  flushTop={active.length === 0}
                  expanded={completedExpanded}
                  onToggle={toggleCompletedExpanded}
                  onClear={handleClearCompleted}
                  onOpenSubagent={onOpenSubagent}
                  onArchiveSubagent={onArchiveSubagent}
                  onStopSubagent={handleStopSubagent}
                  onDetachSubagent={onDetachSubagent}
                />
              ) : null}
            </ScrollView>
          ) : null}
        </View>
      </ChatWidthBounds>
    </View>
  );
}

interface CompletedSubagentsGroupProps {
  rows: SubagentRow[];
  /** No active rows above — drop the separator gap so the group sits flush. */
  flushTop: boolean;
  expanded: boolean;
  onToggle: () => void;
  onClear: () => void;
  onOpenSubagent: (id: string) => void;
  onArchiveSubagent: (id: string) => void;
  onStopSubagent: (id: string) => void;
  onDetachSubagent?: (id: string) => void;
}

// Finished work tidies itself but stays reachable: terminal, non-attention rows
// collapse into a "Completed (N)" group (collapsed by default) with a bulk
// "Clear all completed". See docs/agent-lifecycle.md (Item 6).
function CompletedSubagentsGroup({
  rows,
  flushTop,
  expanded,
  onToggle,
  onClear,
  onOpenSubagent,
  onArchiveSubagent,
  onStopSubagent,
  onDetachSubagent,
}: CompletedSubagentsGroupProps): ReactElement {
  const { t } = useTranslation();
  const headerLabel = t("subagents.completedGroup", { count: rows.length });
  const clearLabel = t("subagents.clearCompleted");

  return (
    <View
      style={flushTop ? styles.completedGroupFlush : styles.completedGroup}
      testID="subagents-track-completed-group"
    >
      <View style={styles.completedHeaderRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={headerLabel}
          testID="subagents-track-completed-toggle"
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
              accessibilityLabel={clearLabel}
              testID="subagents-track-clear-completed"
              onPress={onClear}
              style={styles.clearButton}
              hitSlop={8}
            >
              <Text style={styles.clearButtonText}>{clearLabel}</Text>
            </Pressable>
          </TooltipTrigger>
          <TooltipContent side="top" align="center" offset={8}>
            <Text style={styles.tooltipText}>{t("subagents.clearCompletedTooltip")}</Text>
          </TooltipContent>
        </Tooltip>
      </View>
      {expanded
        ? rows.map((row) => (
            <SubagentsTrackRow
              key={row.id}
              row={row}
              onOpenSubagent={onOpenSubagent}
              onArchiveSubagent={onArchiveSubagent}
              onStopSubagent={onStopSubagent}
              onDetachSubagent={onDetachSubagent}
            />
          ))
        : null}
    </View>
  );
}

interface SubagentsTrackRowProps {
  row: SubagentRow;
  onOpenSubagent: (id: string) => void;
  onArchiveSubagent: (id: string) => void;
  onStopSubagent: (id: string) => void;
  onDetachSubagent?: (id: string) => void;
}

function SubagentsTrackRow({
  row,
  onOpenSubagent,
  onArchiveSubagent,
  onStopSubagent,
  onDetachSubagent,
}: SubagentsTrackRowProps): ReactElement {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [hovered, setHovered] = useState(false);
  const presentation = useMemo(() => buildRowPresentation(row), [row]);
  const displayLabel =
    presentation.titleState === "loading" ? t("common.states.loading") : presentation.label;
  const rowAction = resolveSubagentRowAction(row.status);
  const tokenLabel = formatCompactTokenCount(row.cumulativeTokens);
  const isRunning = isSubagentRowRunning(row.status);
  const frozenElapsed = formatSubagentElapsed(row);
  const handlePress = useCallback(() => {
    onOpenSubagent(row.id);
  }, [onOpenSubagent, row.id]);
  const handleArchivePress = useCallback(() => {
    onArchiveSubagent(row.id);
  }, [onArchiveSubagent, row.id]);
  const handleStopPress = useCallback(() => {
    onStopSubagent(row.id);
  }, [onStopSubagent, row.id]);
  const handleDetachPress = useCallback(() => {
    onDetachSubagent?.(row.id);
  }, [onDetachSubagent, row.id]);
  const handlePointerEnter = useCallback(() => setHovered(true), []);
  const handlePointerLeave = useCallback(() => setHovered(false), []);
  const actionsAlwaysVisible = isNative || isCompact;
  const actionsVisible = actionsAlwaysVisible || hovered;
  // Observed subagents have no runtime to detach — hide the action for them.
  const detachHandler = row.attend === "observed" ? undefined : onDetachSubagent;

  return (
    // Wrapper View handles hover so moving the pointer between the row and
    // the archive button doesn't drop the hover state — the same pattern
    // used by sidebar workspace rows.
    <View onPointerEnter={handlePointerEnter} onPointerLeave={handlePointerLeave}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={displayLabel}
        testID={`subagents-track-row-${row.id}`}
        onPress={handlePress}
      >
        {({ pressed }) => (
          <View style={hovered || pressed ? styles.rowActive : styles.row}>
            <WorkspaceTabIcon presentation={presentation} active />
            <Text style={styles.rowLabel} numberOfLines={1}>
              {displayLabel}
            </Text>
            <SubagentElapsed
              rowId={row.id}
              startedAt={row.createdAt}
              isRunning={isRunning}
              frozenElapsed={frozenElapsed}
            />
            {tokenLabel ? (
              <Text
                style={styles.rowTokens}
                numberOfLines={1}
                testID={`subagents-track-tokens-${row.id}`}
              >
                {tokenLabel}
              </Text>
            ) : null}
            <SubagentRowActions
              rowId={row.id}
              displayLabel={displayLabel}
              visible={actionsVisible}
              rowAction={rowAction}
              onDetachPress={detachHandler ? handleDetachPress : undefined}
              onArchivePress={handleArchivePress}
              onStopPress={handleStopPress}
            />
          </View>
        )}
      </Pressable>
    </View>
  );
}

// Elapsed run time — a live ticker while the subagent works, then frozen at its
// createdAt→updatedAt duration once terminal. The Claude background-task panel's
// clearest liveness signal; here it complements the token readout.
// See projects/subagent-liveness/subagent-liveness.md (liveness signals).
function SubagentElapsed({
  rowId,
  startedAt,
  isRunning,
  frozenElapsed,
}: {
  rowId: string;
  startedAt: Date;
  isRunning: boolean;
  frozenElapsed: string | null;
}): ReactElement | null {
  if (isRunning) {
    return (
      <LiveElapsed
        startedAt={startedAt}
        active
        style={styles.rowMeta}
        testID={`subagents-track-elapsed-${rowId}`}
      />
    );
  }
  if (!frozenElapsed) {
    return null;
  }
  return (
    <Text style={styles.rowMeta} numberOfLines={1} testID={`subagents-track-elapsed-${rowId}`}>
      {frozenElapsed}
    </Text>
  );
}

function SubagentRowActions({
  rowId,
  displayLabel,
  visible,
  rowAction,
  onDetachPress,
  onArchivePress,
  onStopPress,
}: {
  rowId: string;
  displayLabel: string;
  visible: boolean;
  rowAction: SubagentRowAction;
  onDetachPress?: () => void;
  onArchivePress: () => void;
  onStopPress: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <View
      style={visible ? styles.actionClusterVisible : styles.actionClusterHidden}
      pointerEvents={visible ? "auto" : "none"}
    >
      {onDetachPress ? (
        <SubagentActionButton
          accessibilityLabel={t("subagents.detachAction", { label: displayLabel })}
          testID={`subagents-track-detach-${rowId}`}
          tooltipLabel={t("subagents.detachTooltip")}
          icon="detach"
          visible={visible}
          onPress={onDetachPress}
        />
      ) : null}
      {rowAction === "stop" ? (
        // Running/initializing: Stop transitions to terminal, keeps the row.
        <SubagentActionButton
          accessibilityLabel={t("subagents.stopAction", { label: displayLabel })}
          testID={`subagents-track-stop-${rowId}`}
          tooltipLabel={t("subagents.stopTooltip")}
          icon="stop"
          visible={visible}
          onPress={onStopPress}
        />
      ) : (
        // Terminal: Archive drops the row from the track.
        <SubagentActionButton
          accessibilityLabel={t("subagents.archiveAction", { label: displayLabel })}
          testID={`subagents-track-archive-${rowId}`}
          tooltipLabel={t("subagents.archiveTooltip")}
          icon="archive"
          visible={visible}
          onPress={onArchivePress}
        />
      )}
    </View>
  );
}

type SubagentActionIcon = "archive" | "detach" | "stop";

function renderSubagentActionIcon(icon: SubagentActionIcon, isActive: boolean): ReactElement {
  const uniProps = isActive ? foregroundColorMapping : foregroundMutedColorMapping;
  if (icon === "detach") {
    return <ThemedUnlink size={14} uniProps={uniProps} />;
  }
  if (icon === "stop") {
    return <ThemedStop size={14} uniProps={uniProps} />;
  }
  return <ThemedArchive size={14} uniProps={uniProps} />;
}

function SubagentActionButton({
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
  icon: SubagentActionIcon;
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
          {({ hovered, pressed }) => renderSubagentActionIcon(icon, hovered || pressed)}
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
    maxHeight: SUBAGENTS_LIST_MAX_HEIGHT,
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
  rowTokens: {
    flexShrink: 0,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    fontVariant: ["tabular-nums"],
  },
  rowMeta: {
    flexShrink: 0,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
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
