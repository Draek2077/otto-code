import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { headerIconSlotStyle } from "@/components/headers/header-toggle-button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { ProviderUsageTooltipSection } from "@/provider-usage/tooltip-section";
import { useProviderUsage } from "@/provider-usage/use-provider-usage";
import { useAgentContextUsage } from "@/hooks/use-agent-context-usage";
import type { AgentContextUsage } from "@otto-code/protocol/messages";
import { formatTokenCount } from "./context-window-meter.utils";

interface ContextWindowMeterProps {
  maxTokens: number | null;
  usedTokens: number | null;
  totalCostUsd?: number | null;
  serverId?: string;
  agentId?: string | null;
  /** The Otto provider key, e.g. "claude", "gemini", "codex" */
  provider?: string | null;
  /** Reserve the meter footprint and show a loading ring while usage is pending. */
  pending?: boolean;
}

const SVG_SIZE = 14;
const CENTER = SVG_SIZE / 2;
const RADIUS = 6;
const STROKE_WIDTH = 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function isValidMaxTokens(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isValidUsedTokens(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function getUsagePercentage(maxTokens: number, usedTokens: number): number | null {
  if (!isValidMaxTokens(maxTokens) || !isValidUsedTokens(usedTokens)) {
    return null;
  }
  return (usedTokens / maxTokens) * 100;
}

function clampPercentage(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function formatSessionCost(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  if (value < 0.01) {
    return `$${value.toFixed(4)}`;
  }
  return `$${value.toFixed(2)}`;
}

function getMeterColors(
  percentage: number,
  theme: ReturnType<typeof useUnistyles>["theme"],
): { progress: string; track: string } {
  const track = theme.colors.surface3;
  if (percentage >= 60) {
    return { progress: theme.colors.destructive, track };
  }
  if (percentage >= 40) {
    return { progress: theme.colors.palette.amber[500], track };
  }
  return { progress: theme.colors.palette.green[500], track };
}

function formatCategoryPercentage(tokens: number, maxTokens: number): string {
  return `${((tokens / maxTokens) * 100).toFixed(1)}%`;
}

function ContextBreakdownRow({
  name,
  tokens,
  percentage,
  filled,
}: {
  name: string;
  tokens: number;
  percentage: string;
  filled: boolean;
}) {
  return (
    <View style={styles.breakdownRow}>
      <View style={filled ? styles.breakdownSwatchFilled : styles.breakdownSwatchEmpty} />
      <Text style={styles.breakdownName} numberOfLines={1}>
        {name}
      </Text>
      <Text style={styles.breakdownTokens}>{formatTokenCount(tokens)}</Text>
      <Text style={styles.breakdownPercentage}>{percentage}</Text>
    </View>
  );
}

// The context makeup: what the window is currently filled with, one row per
// provider-reported category, then free space and deferred (uncounted) content.
function ContextBreakdownList({ usage }: { usage: AgentContextUsage }) {
  const { t } = useTranslation();
  if (usage.maxTokens <= 0) {
    return null;
  }
  const counted = usage.categories
    .filter((category) => !category.isDeferred)
    .sort((a, b) => b.tokens - a.tokens);
  const deferred = usage.categories.filter((category) => category.isDeferred);
  const freeTokens = Math.max(0, usage.maxTokens - usage.totalTokens);
  return (
    <View style={styles.breakdownList}>
      {counted.map((category) => (
        <ContextBreakdownRow
          key={category.name}
          name={category.name}
          tokens={category.tokens}
          percentage={formatCategoryPercentage(category.tokens, usage.maxTokens)}
          filled
        />
      ))}
      <ContextBreakdownRow
        name={t("contextWindow.freeSpace")}
        tokens={freeTokens}
        percentage={formatCategoryPercentage(freeTokens, usage.maxTokens)}
        filled={false}
      />
      {deferred.map((category) => (
        <ContextBreakdownRow
          key={category.name}
          name={category.name}
          tokens={category.tokens}
          percentage="—"
          filled={false}
        />
      ))}
    </View>
  );
}

// Mirrors the provider-usage window bars so the popup reads as one usage panel.
function ContextUsageBar({ percentage, color }: { percentage: number; color: string }) {
  const fillStyle = useMemo(
    () => [styles.barFill, { width: `${percentage}%` as const, backgroundColor: color }],
    [percentage, color],
  );
  return (
    <View style={styles.barTrack}>
      <View style={fillStyle} />
    </View>
  );
}

export function ContextWindowMeter({
  maxTokens,
  usedTokens,
  totalCostUsd,
  serverId,
  agentId,
  provider,
  pending = false,
}: ContextWindowMeterProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  // react-native-svg needs explicit dimensions — unistyles breakpoint styles
  // don't reach the <svg> element on web, leaving it 0×0. Match compactUp():
  // doubled on compact form factors.
  const isCompact = useIsCompactFormFactor();
  const svgSize = isCompact ? SVG_SIZE * 2 : SVG_SIZE;
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const { view: providerUsageView, refresh: refreshProviderUsage } = useProviderUsage(
    serverId ?? null,
    { enabled: isPopupOpen },
  );
  const { usage: contextUsage, refresh: refreshContextUsage } = useAgentContextUsage(
    serverId ?? null,
    agentId ?? null,
    { enabled: isPopupOpen },
  );
  const percentage =
    maxTokens !== null && usedTokens !== null ? getUsagePercentage(maxTokens, usedTokens) : null;
  const handlePopupOpenChange = useCallback(
    (nextOpen: boolean) => {
      setIsPopupOpen(nextOpen);
      if (nextOpen) {
        void refreshProviderUsage();
        void refreshContextUsage();
      }
    },
    [refreshProviderUsage, refreshContextUsage],
  );
  const triggerStyle = useCallback(
    ({ hovered, pressed, open }: { hovered: boolean; pressed: boolean; open: boolean }) => [
      headerIconSlotStyle.slot,
      styles.container,
      hovered || pressed || open ? headerIconSlotStyle.slotHovered : null,
    ],
    [],
  );

  // No usage yet: reserve the footprint with a track-only ring while a session is
  // active so the real ring fades in without shifting siblings. Render nothing when
  // no usage is expected.
  if (percentage === null || maxTokens === null || usedTokens === null) {
    if (!pending) {
      return null;
    }
    return (
      <View style={pendingContainerStyle}>
        <Svg
          width={svgSize}
          height={svgSize}
          viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
          style={styles.svg}
          aria-hidden
        >
          <Circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke={theme.colors.surface3}
            strokeWidth={STROKE_WIDTH}
          />
        </Svg>
      </View>
    );
  }

  const clampedPercentage = clampPercentage(percentage);
  const roundedPercentage = Math.round(percentage);
  const dashOffset = CIRCUMFERENCE - (clampedPercentage / 100) * CIRCUMFERENCE;
  const colors = getMeterColors(clampedPercentage, theme);
  const formattedSessionCost =
    typeof totalCostUsd === "number" ? formatSessionCost(totalCostUsd) : null;

  return (
    <DropdownMenu open={isPopupOpen} onOpenChange={handlePopupOpenChange}>
      <DropdownMenuTrigger
        style={triggerStyle}
        accessibilityRole="button"
        testID="context-window-meter"
        accessibilityLabel={t("contextWindow.accessibility", {
          percentage: roundedPercentage,
        })}
      >
        <Svg
          width={svgSize}
          height={svgSize}
          viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
          style={styles.svg}
          aria-hidden
        >
          <Circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke={colors.track}
            strokeWidth={STROKE_WIDTH}
          />
          <Circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke={colors.progress}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
          />
        </Svg>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="center" offset={8} minWidth={220}>
        <View style={styles.popupContent}>
          <Text style={styles.popupTitle}>
            {t("contextWindow.title", { percentage: roundedPercentage })}
          </Text>
          <ContextUsageBar percentage={clampedPercentage} color={colors.progress} />
          <View style={styles.barEndsRow}>
            <Text style={styles.popupDetail}>{formatTokenCount(usedTokens)}</Text>
            <Text style={styles.popupDetail}>{formatTokenCount(maxTokens)}</Text>
          </View>
          {contextUsage ? <ContextBreakdownList usage={contextUsage} /> : null}
          {formattedSessionCost ? (
            <Text style={styles.popupDetail}>
              {t("contextWindow.sessionCost", { cost: formattedSessionCost })}
            </Text>
          ) : null}
          <ProviderUsageTooltipSection view={providerUsageView} activeProviderId={provider} />
        </View>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  svg: {
    transform: [{ rotate: "-90deg" }],
  },
  popupContent: {
    gap: theme.spacing[1.5],
    padding: theme.spacing[3],
  },
  popupTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  barTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.surface3,
    overflow: "hidden",
  },
  barFill: {
    height: 4,
    borderRadius: 2,
  },
  barEndsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  popupDetail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: theme.fontSize.xs * 1.4,
  },
  breakdownList: {
    gap: theme.spacing[1],
    marginTop: theme.spacing[1],
  },
  breakdownRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  breakdownSwatchFilled: {
    width: 8,
    height: 8,
    borderRadius: 2,
    backgroundColor: theme.colors.accent,
  },
  breakdownSwatchEmpty: {
    width: 8,
    height: 8,
    borderRadius: 2,
    backgroundColor: theme.colors.surface3,
  },
  breakdownName: {
    flexGrow: 1,
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    lineHeight: theme.fontSize.xs * 1.4,
  },
  breakdownTokens: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: theme.fontSize.xs * 1.4,
  },
  breakdownPercentage: {
    minWidth: 40,
    textAlign: "right",
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    lineHeight: theme.fontSize.xs * 1.4,
    fontWeight: theme.fontWeight.medium,
  },
}));

const pendingContainerStyle = [headerIconSlotStyle.slot, styles.container];
