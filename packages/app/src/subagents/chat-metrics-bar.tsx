import { useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Bot, DollarSign, Download, Upload, Wrench } from "@/components/icons/material-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppSettings } from "@/hooks/use-settings";
import { useSessionStore } from "@/stores/session-store";
import { formatMicroUsd } from "@/components/usage-format";
import { useChatTotals, type ChatTotals } from "./chat-totals";
import { formatCompactTokenCount } from "./track-presentation";
import { useSubagentsForParent } from "./select";

// Icon colors must come through a theme-reactive prop, and `useUnistyles()` is
// banned — wrapping the leaf icons is the sanctioned route (docs/unistyles.md).
const ThemedUpload = withUnistyles(Upload);
const ThemedDownload = withUnistyles(Download);
const ThemedDollarSign = withUnistyles(DollarSign);
const ThemedBot = withUnistyles(Bot);
const ThemedWrench = withUnistyles(Wrench);

interface ChatMetricsBarProps {
  serverId: string;
  agentId: string;
}

/**
 * The chat's own metrics, in one centered icon+number row at the top of the
 * pane — scoped to THIS chat and everything spawned under it, which is the
 * number no surface used to show.
 *
 * Two vocabulary rules it exists to enforce (docs/glossary.md):
 *
 * - **"Total tokens" is lifetime spend.** It is not context-window occupancy,
 *   which lives on the composer's context indicator and in Context Management.
 *   The two share no units and never appear in the same readout.
 * - **Cost is reported, never estimated.** A provider that cannot price its own
 *   work gets no cost segment at all — not a rate-table guess. When only some of
 *   the tree was priced, the figure is prefixed as a floor, because presenting a
 *   floor as a total is the same lie in a smaller font.
 *
 * Off by default (`settings.chatMetricsBar`): it earns its height only for
 * people watching spend.
 */
export function ChatMetricsBar({ serverId, agentId }: ChatMetricsBarProps): ReactElement | null {
  const { settings } = useAppSettings();
  const enabled = settings.chatMetricsBar;
  return enabled ? <ChatMetricsBarContent serverId={serverId} agentId={agentId} /> : null;
}

/**
 * Split from the exported component so the store subscriptions below only ever
 * mount when the bar is switched on — a chat with a busy fan-out would otherwise
 * re-select totals on every agent update for people who never asked for them.
 */
function ChatMetricsBarContent({ serverId, agentId }: ChatMetricsBarProps): ReactElement | null {
  const { t } = useTranslation();
  const totals = useChatTotals({ serverId, agentId });
  const rows = useSubagentsForParent({ serverId, parentAgentId: agentId });
  // COMPAT(cumulativeUsage): an older daemon sends no split and no cost, so the
  // bar shows tokens only. Not a fallback path — cost is simply the capability
  // the host doesn't have yet.
  const hasCostCapability = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.cumulativeUsage === true,
  );

  const toolUseCount = useMemo(
    () => rows.reduce((sum, row) => sum + (row.toolUseCount ?? 0), 0),
    [rows],
  );
  const activeSubagents = useMemo(
    () => rows.filter((row) => row.status === "initializing" || row.status === "running").length,
    [rows],
  );

  if (totals.tokens <= 0) {
    return null;
  }

  const cost = hasCostCapability ? formatChatCost(totals) : null;
  // Input is shown as one figure — fresh, cache-read and cache-write together.
  // The cache split matters for PRICING, which the daemon already did; showing
  // three input numbers in a toolbar would be noise.
  const inputTokens =
    totals.inputTokens + totals.cachedInputTokens + totals.cacheCreationInputTokens;

  return (
    <View style={styles.bar} testID="chat-metrics-bar">
      <View style={styles.row}>
        <Metric
          Icon={ThemedUpload}
          value={formatCompactTokenCount(inputTokens)}
          tooltip={t("chatMetrics.tokensIn")}
          testID="chat-metrics-tokens-in"
        />
        <Metric
          Icon={ThemedDownload}
          value={formatCompactTokenCount(totals.outputTokens)}
          tooltip={t("chatMetrics.tokensOut")}
          testID="chat-metrics-tokens-out"
        />
        <Metric
          value={formatCompactTokenCount(totals.tokens)}
          label={t("chatMetrics.totalTokensLabel")}
          tooltip={t("chatMetrics.totalTokensHint")}
          testID="chat-metrics-total-tokens"
          emphasis
        />
        {cost ? (
          <Metric
            Icon={ThemedDollarSign}
            value={cost.text}
            tooltip={t(cost.tooltipKey)}
            testID="chat-metrics-cost"
          />
        ) : null}
        {rows.length > 0 ? (
          <Metric
            Icon={ThemedBot}
            value={activeSubagents > 0 ? `${activeSubagents}/${rows.length}` : String(rows.length)}
            tooltip={t("chatMetrics.subagentsHint")}
            testID="chat-metrics-subagents"
          />
        ) : null}
        {toolUseCount > 0 ? (
          <Metric
            Icon={ThemedWrench}
            value={String(toolUseCount)}
            tooltip={t("chatMetrics.toolCallsHint")}
            testID="chat-metrics-tools"
          />
        ) : null}
      </View>
    </View>
  );
}

interface ChatCostDisplay {
  text: string;
  tooltipKey: "chatMetrics.costHint" | "chatMetrics.costPartialHint";
}

/**
 * The cost segment, or null when there is nothing honest to show.
 *
 * A `partial` total is rendered with a leading `≥` because some of the tree was
 * unpriced — the number is a floor, and the tooltip says so outright. `none`
 * renders nothing at all: an absent cost is the correct answer for a local
 * model, and inventing one from a rate table is exactly the behavior this
 * feature removes.
 */
export function formatChatCost(totals: ChatTotals): ChatCostDisplay | null {
  if (totals.costUsd === null || totals.costUsd <= 0) {
    return null;
  }
  const formatted = formatMicroUsd(Math.round(totals.costUsd * 1_000_000));
  if (totals.costCoverage === "partial") {
    return { text: `≥ ${formatted}`, tooltipKey: "chatMetrics.costPartialHint" };
  }
  return { text: formatted, tooltipKey: "chatMetrics.costHint" };
}

// The icon arrives as a COMPONENT, not an element: passing JSX through a prop
// hands the parent a fresh object every render (react-perf/jsx-no-jsx-as-prop).
// The Themed* wrappers are module-scope constants, so this reference is stable.
// Typed off one of them rather than hand-written — withUnistyles adds `uniProps`
// and forwards refs, and a hand-rolled signature would drift from that.
type MetricIcon = typeof ThemedUpload;

function Metric({
  Icon,
  value,
  label,
  tooltip,
  testID,
  emphasis,
}: {
  Icon?: MetricIcon;
  value: string | null;
  label?: string;
  tooltip: string;
  testID: string;
  emphasis?: boolean;
}): ReactElement | null {
  if (!value) {
    return null;
  }
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>
        <View style={styles.metric} testID={testID}>
          {Icon ? <Icon size={12} style={styles.icon} /> : null}
          <Text style={emphasis ? styles.valueEmphasis : styles.value} numberOfLines={1}>
            {value}
          </Text>
          {label ? (
            <Text style={styles.label} numberOfLines={1}>
              {label}
            </Text>
          ) : null}
        </View>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={6}>
        <Text style={styles.tooltipText}>{tooltip}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    width: "100%",
    alignItems: "center",
    // A toolbar, not a banner: one hairline rule and no fill, so it reads at the
    // same weight as the browser/editor toolbars rather than as a notification.
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    // Wraps rather than truncating: on a phone the metrics reflow onto a second
    // line instead of silently dropping the ones that matter most.
    flexWrap: "wrap",
    justifyContent: "center",
    gap: theme.spacing[3],
  },
  metric: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  icon: {
    flexShrink: 0,
    color: theme.colors.foregroundMuted,
  },
  value: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    fontVariant: ["tabular-nums"],
  },
  valueEmphasis: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
    fontVariant: ["tabular-nums"],
  },
  label: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
  },
}));
