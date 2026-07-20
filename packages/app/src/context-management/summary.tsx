import { useCallback, useMemo, useRef, type ReactElement } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { isWeb } from "@/constants/platform";
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
  isLoading: boolean;
  windowTokens: number;
  onWindowTokensChange: (tokens: number) => void;
}

/**
 * The health panel. Its job is to answer three questions before the user reads
 * anything else: how much rides every request, what share of the window that
 * is, and how much room is left for the actual conversation.
 */
export function ContextSummary({
  report,
  isLoading,
  windowTokens,
  onWindowTokensChange,
}: ContextSummaryProps): ReactElement {
  const { t } = useTranslation();

  const scrollRef = useRef<ScrollView>(null);
  const scrollbar = useWebScrollViewScrollbar(scrollRef, { enabled: isWeb });

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
      {/* The picker leads: every number below it is only meaningful relative to
          the window you are evaluating against. */}
      <View style={styles.sectionFirst}>
        <Text style={styles.sectionLabel}>{t("contextManagement.summary.window")}</Text>
        <View style={styles.presetRow}>
          {WINDOW_PRESETS.map((preset) => (
            <WindowPreset
              key={preset.label}
              label={preset.label}
              tokens={preset.tokens}
              selected={preset.tokens === windowTokens}
              onSelect={onWindowTokensChange}
            />
          ))}
        </View>
      </View>

      {report ? (
        <>
          <Text style={styles.title}>{t("contextManagement.summary.title")}</Text>
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

              Two caveats used to sit here — that the sizes are estimates from
              convention rather than observation, and that this block is exactly
              what providers cache so token cost and money cost diverge. Both
              are true and both still need telling; a permanent paragraph in the
              densest panel in the app was just the wrong place to tell them.
              `report.confidence` still carries the first one on the wire. */}
        </>
      ) : (
        <Text style={styles.muted}>
          {t(isLoading ? "contextManagement.summary.loading" : "contextManagement.summary.empty")}
        </Text>
      )}
    </ScrollView>
  );
}

interface WindowPresetProps {
  label: string;
  tokens: number;
  selected: boolean;
  onSelect: (tokens: number) => void;
}

function WindowPreset({ label, tokens, selected, onSelect }: WindowPresetProps): ReactElement {
  const handlePress = useCallback(() => onSelect(tokens), [onSelect, tokens]);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      testID={`context-window-${label}`}
      onPress={handlePress}
      style={selected ? styles.presetSelected : styles.preset}
    >
      <Text style={selected ? styles.presetTextSelected : styles.presetText}>{label}</Text>
    </Pressable>
  );
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

const styles = StyleSheet.create((theme) => {
  const headlineBase = {
    fontSize: theme.fontSize["2xl"],
    fontWeight: "700",
  } as const;
  const barFillBase = {
    height: "100%",
    borderRadius: theme.borderRadius.full,
  } as const;
  const presetBase = {
    borderWidth: theme.borderWidth[1],
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  } as const;
  return {
    root: {
      flexGrow: 0,
    },
    content: {
      padding: theme.spacing[3],
      gap: theme.spacing[2],
    },
    title: {
      color: theme.colors.foreground,
      fontSize: theme.fontSize.sm,
      fontWeight: "600",
      marginTop: theme.spacing[2],
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
      fontSize: theme.fontSize.sm,
    },
    workingRoom: {
      color: theme.colors.mutedForeground,
      fontSize: theme.fontSize.sm,
    },
    section: {
      gap: theme.spacing[1],
      marginTop: theme.spacing[2],
    },
    sectionFirst: {
      gap: theme.spacing[1],
    },
    sectionLabel: {
      color: theme.colors.mutedForeground,
      fontSize: theme.fontSize.xs,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    presetRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: theme.spacing[1],
    },
    preset: { ...presetBase, borderColor: theme.colors.border },
    presetSelected: { ...presetBase, borderColor: theme.colors.accent },
    presetText: {
      color: theme.colors.mutedForeground,
      fontSize: theme.fontSize.xs,
    },
    presetTextSelected: {
      color: theme.colors.foreground,
      fontSize: theme.fontSize.xs,
      fontWeight: "600",
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
      fontSize: theme.fontSize.sm,
    },
    barValue: {
      color: theme.colors.mutedForeground,
      fontSize: theme.fontSize.sm,
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
      fontSize: theme.fontSize.sm,
    },
  };
});
