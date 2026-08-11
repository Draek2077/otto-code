import { useCallback, useMemo, useRef, type ReactElement, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import type { SelectFieldOption } from "@/components/ui/select-field";
import { isWeb } from "@/constants/platform";
import { ScopeSelect } from "./scope-select";
import type {
  ContextCategoryTotal,
  ContextReport,
  ContextSeverity,
} from "@otto-code/protocol/messages";
import { CATEGORY_LABEL_KEYS, formatPercent, formatTokens, reportSharePercent } from "./format";

/** Mirrors the daemon's presets; the default is never the largest window. */
export const WINDOW_PRESETS: readonly { label: string; tokens: number }[] = [
  { label: "32K", tokens: 32_000 },
  { label: "128K", tokens: 128_000 },
  { label: "200K", tokens: 200_000 },
  { label: "262K", tokens: 262_144 },
  { label: "1M", tokens: 1_000_000 },
];

interface ContextSummaryProps {
  report: ContextReport | null;
  /** No numbers yet and a scan is running. */
  isLoading: boolean;
  /** A scan is running behind numbers already on screen. */
  isRefreshing: boolean;
  /** Why the last scan failed, if it did. Shown rather than silently blanking. */
  error: string | null;
  windowTokens: number;
  onWindowTokensChange: (tokens: number) => void;
  /**
   * The "viewing context for <personality>" selector, rendered beside the
   * window picker. Passed in rather than built here so this panel stays a
   * readout with no knowledge of the roster; both controls answer the same
   * question ("what am I evaluating against"), so they share a row.
   */
  personalitySlot?: ReactNode;
}

/**
 * The health panel. Its job is to answer three questions before the user reads
 * anything else: how much rides every request, what share of the window that
 * is, and how much room is left for the actual conversation.
 */
export function ContextSummary({
  report,
  isLoading,
  isRefreshing,
  error,
  windowTokens,
  onWindowTokensChange,
  personalitySlot,
}: ContextSummaryProps): ReactElement {
  const { t } = useTranslation();

  const scrollRef = useRef<ScrollView>(null);
  const scrollbar = useWebScrollViewScrollbar(scrollRef, { enabled: isWeb });

  const windowOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      WINDOW_PRESETS.map((preset) => ({
        id: String(preset.tokens),
        value: String(preset.tokens),
        label: preset.label,
        testID: `context-window-${preset.label}`,
      })),
    [],
  );
  // A window the presets do not cover is still a window worth naming - a saved
  // setting outliving a preset must not read as "nothing selected".
  const windowLabel =
    WINDOW_PRESETS.find((preset) => preset.tokens === windowTokens)?.label ??
    formatTokens(windowTokens);
  const handleWindowSelect = useCallback(
    (id: string) => onWindowTokensChange(Number(id)),
    [onWindowTokensChange],
  );

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.root}
      contentContainerStyle={styles.content}
      onLayout={scrollbar.onLayout}
      onScroll={scrollbar.onScroll}
      onContentSizeChange={scrollbar.onContentSizeChange}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={!isWeb}
    >
      {/* The pickers lead: every number below them is only meaningful relative
          to the window - and to the personality - you are evaluating against.
          One row, because they are one question asked twice. */}
      <View style={styles.scopeRow}>
        <ScopeSelect
          label={t("contextManagement.summary.window")}
          value={String(windowTokens)}
          displayLabel={windowLabel}
          options={windowOptions}
          onSelect={handleWindowSelect}
          testID="context-window-select"
        />
        {personalitySlot}
      </View>

      {report ? (
        <>
          {/* The cached numbers stay put while a re-scan runs behind them; the
              spinner is the only thing that says the answer may still move. */}
          <View style={styles.titleRow}>
            <Text style={styles.title}>{t("contextManagement.summary.title")}</Text>
            {isRefreshing ? (
              <LoadingSpinner size="small" testID="context-summary-refreshing" />
            ) : null}
          </View>
          <View style={styles.headlineRow}>
            <Text style={severityTextStyle(report.aggregateSeverity)}>
              {formatTokens(report.fixedTotal)}
            </Text>
            <Text style={styles.headlineUnit}>
              {t("contextManagement.summary.ofWindow", {
                percent: formatPercent(reportSharePercent(report)),
              })}
            </Text>
          </View>
          <Text style={styles.workingRoom}>
            {t("contextManagement.summary.workingRoom", {
              room: formatTokens(report.workingRoom),
            })}
          </Text>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t("contextManagement.summary.breakdown")}</Text>
            {report.categoryTotals.length === 0 ? (
              <Text style={styles.muted}>{t("contextManagement.summary.nothingFixed")}</Text>
            ) : (
              report.categoryTotals.map((total) => (
                <CategoryBar key={total.category} total={total} />
              ))
            )}
          </View>

          {report.conditionalTotal > 0 || report.referencedTotal > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>{t("contextManagement.summary.notCounted")}</Text>
              {report.conditionalTotal > 0 ? (
                <Text style={styles.muted}>
                  {t("contextManagement.summary.conditional", {
                    tokens: formatTokens(report.conditionalTotal),
                  })}
                </Text>
              ) : null}
              {report.referencedTotal > 0 ? (
                <Text style={styles.muted}>
                  {t("contextManagement.summary.referenced", {
                    tokens: formatTokens(report.referencedTotal),
                  })}
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* Findings are not here: they live in the sidebar's "Worth fixing"
              tab, which tones amber when it has any. This panel stays a readout.

              Two caveats used to sit here - that the sizes are estimates from
              convention rather than observation, and that this block is exactly
              what providers cache so token cost and money cost diverge. Both
              are true and both still need telling; a permanent paragraph in the
              densest panel in the app was just the wrong place to tell them.
              `report.confidence` still carries the first one on the wire. */}
        </>
      ) : (
        <SummaryPlaceholder isLoading={isLoading} error={error} />
      )}
    </ScrollView>
  );
}

/**
 * What stands in for the numbers before there are any. Telling "still scanning"
 * from "nothing to report" from "the scan failed" is the whole job: all three
 * used to render the same muted line, so a slow scan read as a broken tab and a
 * failed one read as an empty workspace.
 */
function SummaryPlaceholder({
  isLoading,
  error,
}: {
  isLoading: boolean;
  error: string | null;
}): ReactElement {
  const { t } = useTranslation();
  if (isLoading) {
    return (
      <View style={styles.loadingRow} testID="context-summary-loading">
        <LoadingSpinner size="small" />
      </View>
    );
  }
  if (error) {
    return (
      <Text style={styles.error} testID="context-summary-error">
        {t("contextManagement.summary.failed", { error })}
      </Text>
    );
  }
  return <Text style={styles.muted}>{t("contextManagement.summary.empty")}</Text>;
}

function CategoryBar({ total }: { total: ContextCategoryTotal }): ReactElement {
  const { t } = useTranslation();
  const fillStyle = useMemo(
    () => [
      severityBarStyle(total.severity),
      { width: `${Math.min(100, Math.max(1, total.sharePercent))}%` as const },
    ],
    [total.severity, total.sharePercent],
  );
  return (
    <View style={styles.barRow}>
      <View style={styles.barHeader}>
        <Text style={styles.barLabel} numberOfLines={1}>
          {t(CATEGORY_LABEL_KEYS[total.category])}
        </Text>
        <Text style={styles.barValue}>{formatTokens(total.estTokens)}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={fillStyle} />
      </View>
    </View>
  );
}

function severityTextStyle(severity: ContextSeverity) {
  if (severity === "critical") return styles.headlineCritical;
  if (severity === "warn") return styles.headlineWarn;
  return styles.headline;
}

function severityBarStyle(severity: ContextSeverity) {
  if (severity === "critical") return styles.barFillCritical;
  if (severity === "warn") return styles.barFillWarn;
  if (severity === "notice") return styles.barFillNotice;
  return styles.barFill;
}

// The summary is the top of Context Management's compact first screen, so every
// font here takes the +2 compact bump (docs convention; `md` and up stay put).
function bump(size: number) {
  return { xs: size + 2, md: size };
}

const styles = StyleSheet.create((theme) => {
  const headlineBase = {
    fontSize: bump(theme.fontSize["2xl"]),
    fontWeight: "700",
  } as const;
  const barFillBase = {
    height: "100%",
    borderRadius: theme.borderRadius.full,
  } as const;
  return {
    root: {
      flexGrow: 0,
    },
    content: {
      padding: theme.spacing[3],
      gap: theme.spacing[2],
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      marginTop: theme.spacing[2],
    },
    loadingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
    },
    title: {
      color: theme.colors.foreground,
      fontSize: bump(theme.fontSize.sm),
      // Not bold: the number under it is the emphasis, and a bold label
      // competing with a 2xl figure just makes two things shout.
    },
    headlineRow: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: theme.spacing[2],
    },
    headline: { ...headlineBase, color: theme.colors.foreground },
    headlineWarn: { ...headlineBase, color: theme.colors.statusWarning },
    headlineCritical: { ...headlineBase, color: theme.colors.statusDanger },
    headlineUnit: {
      color: theme.colors.mutedForeground,
      fontSize: bump(theme.fontSize.sm),
    },
    workingRoom: {
      color: theme.colors.mutedForeground,
      fontSize: bump(theme.fontSize.sm),
    },
    section: {
      gap: theme.spacing[1],
      marginTop: theme.spacing[2],
    },
    // The two pickers sit side by side and wrap onto separate lines only when
    // the panel is too narrow to hold both.
    scopeRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: theme.spacing[2],
    },
    sectionLabel: {
      color: theme.colors.mutedForeground,
      fontSize: bump(theme.fontSize.xs),
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    barRow: {
      gap: theme.spacing[1],
      marginTop: theme.spacing[1],
    },
    barHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: theme.spacing[2],
    },
    barLabel: {
      flex: 1,
      minWidth: 0,
      color: theme.colors.foreground,
      fontSize: bump(theme.fontSize.sm),
    },
    barValue: {
      color: theme.colors.mutedForeground,
      fontSize: bump(theme.fontSize.sm),
      fontVariant: ["tabular-nums"],
    },
    barTrack: {
      height: 6,
      borderRadius: theme.borderRadius.full,
      backgroundColor: theme.colors.surface2,
      overflow: "hidden",
    },
    barFill: { ...barFillBase, backgroundColor: theme.colors.mutedForeground },
    barFillNotice: { ...barFillBase, backgroundColor: theme.colors.statusInfo },
    barFillWarn: { ...barFillBase, backgroundColor: theme.colors.statusWarning },
    barFillCritical: { ...barFillBase, backgroundColor: theme.colors.statusDanger },
    muted: {
      color: theme.colors.mutedForeground,
      fontSize: bump(theme.fontSize.sm),
    },
    error: {
      color: theme.colors.statusDanger,
      fontSize: bump(theme.fontSize.sm),
    },
  };
});
