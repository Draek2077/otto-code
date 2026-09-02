import { useCallback, useMemo, type ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Archive, Stop, Unlink } from "@/components/icons/material-icons";
import { getProviderIcon } from "@/components/provider-icons";
import { LiveElapsed } from "@/components/live-elapsed";
import { ComposerTrackActions, ComposerTrackPill, ComposerTrackRow } from "@/composer/tracks";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isNative } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  WorkspaceTabIcon,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-icon";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import type { ClearableSubagentRow } from "./clear-completed-subagents";
import type { SubagentRow } from "./select";
import {
  buildSubagentRowPresentationData,
  formatCompactTokenCount,
  formatSubagentCurrentTool,
  formatSubagentElapsed,
  formatSubagentToolUseCount,
  isSubagentRowRunning,
  partitionSubagentRows,
} from "./track-presentation";
import type { SubagentsTrackProps } from "./track";

const ThemedArchive = withUnistyles(Archive);
const ThemedStop = withUnistyles(Stop);
const ThemedUnlink = withUnistyles(Unlink);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * Paseo's compact presentation over the exact same normalized rows and action
 * functions as Otto's detailed panel. This owns no provider state and has no
 * ingestion path; it is intentionally just a renderer.
 */
export function SubagentsPillTrack(props: SubagentsTrackProps): ReactElement | null {
  const { rows, onClearCompleted } = props;
  const { t } = useTranslation();
  const { active, completed } = useMemo(() => partitionSubagentRows(rows), [rows]);
  const clearRows = useMemo<ClearableSubagentRow[]>(
    () =>
      completed.map((row) => ({
        id: row.id,
        cumulativeTokens: row.kind === "otto" ? row.cumulativeTokens : undefined,
        cumulativeUsage: row.kind === "otto" ? row.cumulativeUsage : undefined,
      })),
    [completed],
  );
  const handleClearCompleted = useCallback(
    () => onClearCompleted(clearRows),
    [clearRows, onClearCompleted],
  );

  if (rows.length === 0) return null;

  const segmentText = t("subagents.pillLabelMany", { count: rows.length });
  const segments = [{ bucket: aggregateBucket(rows), text: segmentText }];
  return (
    <ComposerTrackPill
      testID="subagents-pill-track"
      segments={segments}
      panelTitle={t("subagents.title")}
      accessibilityLabel={t("subagents.title") + `: ${segmentText}`}
    >
      {completed.length > 0 ? (
        <ComposerTrackActions>
          <ComposerTrackRow
            testID="subagents-pill-track-clear-completed"
            accessibilityLabel={t("subagents.clearCompleted")}
            onPress={handleClearCompleted}
          >
            {({ active: isActive }) => (
              <>
                <ThemedArchive
                  size="chromeSm"
                  uniProps={isActive ? foregroundColorMapping : foregroundMutedColorMapping}
                />
                <Text style={styles.actionLabel}>{t("subagents.clearCompleted")}</Text>
              </>
            )}
          </ComposerTrackRow>
        </ComposerTrackActions>
      ) : null}
      {active.map((row) => (
        <SubagentsPillRow key={`${row.kind}:${row.id}`} row={row} {...props} />
      ))}
      {completed.length > 0 ? (
        <Text style={styles.groupLabel}>
          {t("subagents.completedGroup", { count: completed.length })}
        </Text>
      ) : null}
      {completed.map((row) => (
        <SubagentsPillRow key={`${row.kind}:${row.id}`} row={row} {...props} />
      ))}
    </ComposerTrackPill>
  );
}

function aggregateBucket(rows: readonly SubagentRow[]): SidebarStateBucket | null {
  const buckets = new Set(rows.map((row) => buildSubagentRowPresentationData(row).statusBucket));
  if (buckets.has("failed") || buckets.has("attention")) return "failed";
  if (buckets.has("needs_input")) return "needs_input";
  if (buckets.has("running")) return "running";
  return null;
}

function SubagentsPillRow({
  row,
  onOpenSubagent,
  onOpenProviderSubagent,
  onArchiveSubagent,
  onStopSubagent,
  onDetachSubagent,
}: SubagentsTrackProps & { row: SubagentRow }): ReactElement {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const presentation = useMemo<WorkspaceTabPresentation>(
    () => ({
      ...buildSubagentRowPresentationData(row),
      icon: getProviderIcon(row.provider),
      provider: row.provider,
      personalitySpinner: row.kind === "otto" ? (row.personalitySpinner ?? null) : null,
    }),
    [row],
  );
  const label =
    presentation.titleState === "loading" ? t("common.states.loading") : presentation.label;
  const running = isSubagentRowRunning(row.status);
  const tokenLabel = row.kind === "otto" ? formatCompactTokenCount(row.cumulativeTokens) : null;
  const toolUseLabel = row.kind === "otto" ? formatSubagentToolUseCount(row.toolUseCount) : null;
  const currentTool = row.kind === "otto" ? formatSubagentCurrentTool(row.currentTool) : null;
  const elapsed = row.kind === "otto" ? formatSubagentElapsed(row) : null;
  const open = useCallback(() => {
    if (row.kind === "provider") {
      onOpenProviderSubagent(row.parentAgentId, row.id);
    } else {
      onOpenSubagent(row.id);
    }
  }, [onOpenProviderSubagent, onOpenSubagent, row]);
  const archive = useCallback(() => onArchiveSubagent(row.id), [onArchiveSubagent, row.id]);
  const stop = useCallback(() => onStopSubagent(row.id), [onStopSubagent, row.id]);
  const detach = useCallback(() => onDetachSubagent?.(row.id), [onDetachSubagent, row.id]);
  const allowDetach = row.kind === "otto" && row.attend !== "observed" && onDetachSubagent;
  // Provider descriptors intentionally remain read-only here. Their owner may
  // offer a timeline/tab, but they are not independent Otto runtimes to stop,
  // detach, or archive through the managed-agent APIs.
  const allowManagedAction = row.kind === "otto";

  return (
    <ComposerTrackRow
      accessibilityLabel={label}
      testID={`subagents-pill-row-${row.id}`}
      onPress={open}
    >
      {({ active }) => (
        <>
          <WorkspaceTabIcon
            presentation={presentation}
            backdrop={active ? "surface2" : "surface1"}
          />
          <View style={styles.copy}>
            <Text style={styles.rowLabel} numberOfLines={1}>
              {label}
            </Text>
            {presentation.subtitle ? (
              <Text style={styles.subtitle} numberOfLines={1}>
                {presentation.subtitle}
              </Text>
            ) : null}
          </View>
          {running && row.kind === "otto" ? (
            <LiveElapsed startedAt={row.createdAt} active style={styles.meta} />
          ) : null}
          {!running && elapsed ? <Text style={styles.meta}>{elapsed}</Text> : null}
          {tokenLabel ? <Text style={styles.meta}>{tokenLabel}</Text> : null}
          {toolUseLabel ? <Text style={styles.meta}>{toolUseLabel}</Text> : null}
          {currentTool ? (
            <Text style={styles.currentTool} numberOfLines={1}>
              {currentTool}
            </Text>
          ) : null}
          {allowDetach || allowManagedAction ? (
            <View
              style={styles.actions}
              pointerEvents={active || isNative || isCompact ? "auto" : "none"}
            >
              {allowDetach ? (
                <PillAction label={t("subagents.detachTooltip")} icon="detach" onPress={detach} />
              ) : null}
              {allowManagedAction ? (
                <PillAction
                  label={running ? t("subagents.stopTooltip") : t("subagents.archiveTooltip")}
                  icon={running ? "stop" : "archive"}
                  onPress={running ? stop : archive}
                />
              ) : null}
            </View>
          ) : null}
        </>
      )}
    </ComposerTrackRow>
  );
}

function PillAction({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: "archive" | "detach" | "stop";
  onPress: () => void;
}): ReactElement {
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={onPress}
          style={styles.actionButton}
          hitSlop={8}
        >
          {({ hovered, pressed }) => {
            const uniProps =
              hovered || pressed ? foregroundColorMapping : foregroundMutedColorMapping;
            if (icon === "detach") return <ThemedUnlink size="chromeSm" uniProps={uniProps} />;
            if (icon === "stop") return <ThemedStop size="chromeSm" uniProps={uniProps} />;
            return <ThemedArchive size="chromeSm" uniProps={uniProps} />;
          }}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltip}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  actionLabel: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  groupLabel: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  copy: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  rowLabel: { fontSize: theme.fontSize.sm, color: theme.colors.foreground },
  subtitle: { fontSize: theme.fontSize.xs, color: theme.colors.foregroundMuted },
  meta: {
    flexShrink: 0,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    fontVariant: ["tabular-nums"],
  },
  currentTool: {
    flexShrink: 1,
    maxWidth: 110,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  actions: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  actionButton: { padding: theme.spacing[1], alignItems: "center", justifyContent: "center" },
  tooltip: { fontSize: theme.fontSize.xs, color: theme.colors.foreground },
}));
