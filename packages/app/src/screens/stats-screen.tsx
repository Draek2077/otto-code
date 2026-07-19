import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { ScrollView, Text, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useIsFocused } from "@react-navigation/native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { ActivityCounters } from "@otto-code/protocol/messages";
import type { Theme } from "@/styles/theme";
import { MenuHeader } from "@/components/headers/menu-header";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { formatTokenCount } from "@/components/context-window-meter.utils";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHosts } from "@/runtime/host-runtime";
import {
  useActivityStats,
  useActivityStatsFeature,
  useResetActivityStats,
  useUsageCostCategoriesFeature,
  type ActivityStatsRollups,
} from "@/hooks/use-activity-stats";
import { useUsageLogFeature } from "@/hooks/use-usage-log";
import { UsageLogList, UsageTotalsBar, type UsageTotals } from "@/components/usage-log-list";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/utils/confirm-dialog";
import {
  AlarmClock,
  Bot,
  Brain,
  Clapperboard,
  DollarSign,
  Download,
  MailReceived,
  MessageSquare,
  Moon,
  Palette,
  Puzzle,
  Scissors,
  Send,
  Sparkles,
  Trash2,
  Upload,
  Wrench,
} from "@/components/icons/material-icons";

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ThemedSend = withUnistyles(Send);
const ThemedMailReceived = withUnistyles(MailReceived);
const ThemedUpload = withUnistyles(Upload);
const ThemedDownload = withUnistyles(Download);
const ThemedBot = withUnistyles(Bot);
const ThemedPuzzle = withUnistyles(Puzzle);
const ThemedClapperboard = withUnistyles(Clapperboard);
const ThemedMoon = withUnistyles(Moon);
const ThemedBrain = withUnistyles(Brain);
const ThemedWrench = withUnistyles(Wrench);
const ThemedPalette = withUnistyles(Palette);
const ThemedAlarmClock = withUnistyles(AlarmClock);
const ThemedDollarSign = withUnistyles(DollarSign);
const ThemedMessageSquare = withUnistyles(MessageSquare);
const ThemedScissors = withUnistyles(Scissors);
const ThemedSparkles = withUnistyles(Sparkles);

type RollupWindow = keyof ActivityStatsRollups;
type TileFormat = "count" | "tokens" | "usd";

interface TileDef {
  key: string;
  label: string;
  Icon: typeof ThemedSend;
  value: number;
  format: TileFormat;
}

const WINDOW_OPTIONS: SegmentedControlOption<RollupWindow>[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7Days", label: "7 Days" },
  { value: "last30Days", label: "30 Days" },
  { value: "allTime", label: "All Time" },
];

type MetricsTab = "summary" | "log";

const TAB_OPTIONS: SegmentedControlOption<MetricsTab>[] = [
  { value: "summary", label: "Summary" },
  { value: "log", label: "Log" },
];

// LEFT column — non-token activity counters. tokensSent/tokensReceived moved to
// the right (Usage & Cost) column; artifactsCreated + schedulesExecuted get their
// own bottom row (see buildLeftColumn).
const LEFT_MAIN_TILES: { field: keyof ActivityCounters; label: string; Icon: typeof ThemedSend }[] =
  [
    { field: "messagesSent", label: "Messages sent", Icon: ThemedSend },
    { field: "messagesReceived", label: "Messages received", Icon: ThemedMailReceived },
    { field: "agentsCreated", label: "Agent chats created", Icon: ThemedBot },
    { field: "subagentsInvoked", label: "Sub-agents invoked", Icon: ThemedPuzzle },
    { field: "runsOrchestrated", label: "Orchestrations run", Icon: ThemedClapperboard },
    { field: "backgroundTasksInvoked", label: "Background tasks", Icon: ThemedMoon },
    { field: "thoughts", label: "Thoughts", Icon: ThemedBrain },
    { field: "toolsCalled", label: "Tools called", Icon: ThemedWrench },
  ];

const LEFT_BOTTOM_TILES: {
  field: keyof ActivityCounters;
  label: string;
  Icon: typeof ThemedSend;
}[] = [
  { field: "artifactsCreated", label: "Artifacts created", Icon: ThemedPalette },
  { field: "schedulesExecuted", label: "Schedules executed", Icon: ThemedAlarmClock },
];

function countTile(
  field: keyof ActivityCounters,
  label: string,
  Icon: typeof ThemedSend,
  counters: ActivityCounters,
): TileDef {
  return { key: field, label, Icon, value: counters[field], format: "count" };
}

// RIGHT column top row — the two headline totals, kept alone (2-up) so they read
// big: everything in, everything out.
function buildTotalsTiles(counters: ActivityCounters): TileDef[] {
  return [
    {
      key: "tokensIn",
      label: "Tokens in",
      Icon: ThemedUpload,
      value: counters.tokensSent,
      format: "tokens",
    },
    {
      key: "tokensOut",
      label: "Tokens out",
      Icon: ThemedDownload,
      value: counters.tokensReceived,
      format: "tokens",
    },
  ];
}

// The real money spent — shown ONLY when a provider actually billed for it
// (`costMicroUsd > 0`), never as a misleading "$0" for token-only providers
// (LM Studio, etc.). Rendered as a single full-width tile so money reads as the
// headline it is, separate from the token totals above and the token breakdown
// below (mixing a USD figure into a token grid would muddy both).
function buildCostTiles(counters: ActivityCounters): TileDef[] {
  return [
    {
      key: "cost",
      label: "Real cost",
      Icon: ThemedDollarSign,
      value: counters.costMicroUsd,
      format: "usd",
    },
  ];
}

// RIGHT column breakdown — ONE partition of the total tokens, by *why they were
// spent*, so a user staring at "30M tokens" can see where it came from. These
// four buckets are disjoint and sum to the grand total (compaction is backed out
// of the turn buckets at the increment site, generations ride their own path):
//   your conversations + sub-agents they spawned + background auto-text + context
//   compaction = everything.
// Deliberately NOT a provider split — "Claude vs other" re-slices the same tokens
// a second way and reads as $0/"other" noise for anyone not on Claude. Token-
// denominated because tokens are the one unit every provider reports honestly.
// Only rendered when the daemon populates these (gated).
function buildBreakdownTiles(counters: ActivityCounters): TileDef[] {
  return [
    {
      key: "mainChat",
      label: "Your conversations",
      Icon: ThemedMessageSquare,
      value: counters.mainChatTokensIn + counters.mainChatTokensOut,
      format: "tokens",
    },
    {
      key: "subagents",
      label: "Sub-agents",
      Icon: ThemedPuzzle,
      value: counters.subagentTokensIn + counters.subagentTokensOut,
      format: "tokens",
    },
    {
      key: "generations",
      label: "Background generations",
      Icon: ThemedSparkles,
      value: counters.generationsTokensIn + counters.generationsTokensOut,
      format: "tokens",
    },
    {
      key: "compaction",
      label: "Context compaction",
      Icon: ThemedScissors,
      value: counters.compactionTokensIn + counters.compactionTokensOut,
      format: "tokens",
    },
  ];
}

function buildLeftColumn(counters: ActivityCounters): { main: TileDef[]; bottom: TileDef[] } {
  return {
    main: LEFT_MAIN_TILES.map((tile) => countTile(tile.field, tile.label, tile.Icon, counters)),
    bottom: LEFT_BOTTOM_TILES.map((tile) => countTile(tile.field, tile.label, tile.Icon, counters)),
  };
}

function formatMicroUsd(microUsd: number): string {
  const usd = microUsd / 1_000_000;
  if (usd <= 0) {
    return "$0";
  }
  if (usd < 0.01) {
    return "<$0.01";
  }
  if (usd < 1000) {
    return `$${usd.toFixed(2)}`;
  }
  return `$${formatTokenCount(Math.round(usd))}`;
}

function formatTileValue(value: number, format: TileFormat): string {
  if (format === "usd") {
    return formatMicroUsd(value);
  }
  // "count" and "tokens" both abbreviate large numbers (1.2k); kept as distinct
  // formats so a future currency/precision change is a one-line switch.
  return formatTokenCount(value);
}

export function StatsScreen(): ReactElement {
  const isFocused = useIsFocused();
  if (!isFocused) {
    return <View style={styles.container} />;
  }
  return <StatsScreenContent />;
}

function StatsScreenContent(): ReactElement {
  const hosts = useHosts();
  // Log-tab range totals, reported up by each host's UsageLogList so they can be
  // pinned below the scroll region instead of scrolling away at the list's end.
  // Keyed by serverId; a host drops out when it leaves the Log tab (reports null).
  const [logTotals, setLogTotals] = useState<Record<string, UsageTotals>>({});
  const handleLogTotals = useCallback((serverId: string, totals: UsageTotals | null) => {
    setLogTotals((prev) => {
      if (totals === null) {
        if (!(serverId in prev)) return prev;
        const next = { ...prev };
        delete next[serverId];
        return next;
      }
      // Dedup by value: the reporter re-fires with a fresh object each render
      // (totals are recomputed from a per-render `now`), so bail out when nothing
      // actually changed — otherwise this would re-render in a loop.
      const existing = prev[serverId];
      if (
        existing &&
        existing.count === totals.count &&
        existing.fresh === totals.fresh &&
        existing.cached === totals.cached &&
        existing.out === totals.out &&
        existing.cost === totals.cost
      ) {
        return prev;
      }
      return { ...prev, [serverId]: totals };
    });
  }, []);

  const pinned = useMemo(
    () =>
      hosts
        .map((host) => ({ host, totals: logTotals[host.serverId] }))
        .filter((entry): entry is { host: (typeof hosts)[number]; totals: UsageTotals } =>
          Boolean(entry.totals),
        ),
    [hosts, logTotals],
  );

  return (
    <View style={styles.container}>
      <MenuHeader title="Metrics" />
      {hosts.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.message}>No hosts connected</Text>
        </View>
      ) : (
        <View style={styles.body}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {hosts.map((host) => (
              <HostStatsSection
                key={host.serverId}
                serverId={host.serverId}
                onLogTotals={handleLogTotals}
              />
            ))}
          </ScrollView>
          {pinned.length > 0 && (
            <View style={styles.pinnedTotals}>
              {pinned.map(({ host, totals }) => (
                <UsageTotalsBar
                  key={host.serverId}
                  totals={totals}
                  label={hosts.length > 1 ? host.label : undefined}
                />
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// Responsive grid for the "boring" stat tiles — fits up to 3 per row, dropping to
// 2 when the (half-screen) column is narrow. Tiles stay small so the special rows
// (artifacts/schedules on the left, tokens in/out on the right) that keep just 2
// tiles read as bigger and draw the eye. An incomplete last row is CENTERED, not
// left-aligned with a dead cell on the right (see TileGrid's edge spacers).
const TARGET_TILE_WIDTH = 200;
const MIN_COLUMNS = 2;
const MAX_COLUMNS = 3;

function resolveColumns(width: number): number {
  if (width <= 0) {
    return MAX_COLUMNS;
  }
  const fitted = Math.floor(width / TARGET_TILE_WIDTH);
  return Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, fitted));
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
}

function HostStatsSection({
  serverId,
  onLogTotals,
}: {
  serverId: string;
  onLogTotals: (serverId: string, totals: UsageTotals | null) => void;
}): ReactElement | null {
  const supported = useActivityStatsFeature(serverId);
  const costCategoriesSupported = useUsageCostCategoriesFeature(serverId);
  const logSupported = useUsageLogFeature(serverId);
  const isCompact = useIsCompactFormFactor();
  const [window, setWindow] = useState<RollupWindow>("today");
  const [tab, setTab] = useState<MetricsTab>("summary");
  const { view } = useActivityStats(serverId);
  const { reset, canReset, isResetting } = useResetActivityStats(serverId);
  const handleTotals = useCallback(
    (totals: UsageTotals | null) => onLogTotals(serverId, totals),
    [onLogTotals, serverId],
  );

  const handleReset = useCallback(async () => {
    const confirmed = await confirmDialog({
      title: "Reset metrics?",
      message:
        "Permanently clears all usage stats and the activity log for this host, starting fresh. This can't be undone.",
      confirmLabel: "Reset",
      destructive: true,
    });
    if (confirmed) {
      await reset();
    }
  }, [reset]);

  const columnsStyle = useMemo(
    () => [styles.columns, isCompact && styles.columnsStacked],
    [isCompact],
  );

  if (!supported) {
    return null;
  }

  let body: ReactElement;
  if (view.kind === "loading") {
    body = <Text style={styles.inlineMessage}>Loading stats…</Text>;
  } else if (view.kind === "error") {
    body = <Text style={styles.inlineMessage}>{view.message}</Text>;
  } else {
    const counters = view.rollups[window];
    const left = buildLeftColumn(counters);
    body = (
      <View style={columnsStyle}>
        <StatColumn title="Activity" subtitle="What you did">
          <TileGrid tiles={left.main} window={window} />
          {/* artifactsCreated + schedulesExecuted share their own bottom row. */}
          <FixedRow tiles={left.bottom} window={window} />
        </StatColumn>
        <View style={isCompact ? styles.dividerHorizontal : styles.dividerVertical} />
        <StatColumn title="Usage & Cost" subtitle="Where the tokens went">
          <FixedRow tiles={buildTotalsTiles(counters)} window={window} />
          {counters.costMicroUsd > 0 && (
            <FixedRow tiles={buildCostTiles(counters)} window={window} />
          )}
          {costCategoriesSupported ? (
            <TileGrid tiles={buildBreakdownTiles(counters)} window={window} />
          ) : (
            <Text style={styles.inlineMessage}>
              Update the host to see the usage & cost breakdown.
            </Text>
          )}
        </StatColumn>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      {/* Tabs + range filter are centered across the full width. Reset is
          popped out of the flow (absolutely pinned right) so it doesn't skew
          that centering. The range selector is shared by both tabs — it buckets
          the Summary rollups and filters the Log's rows to the same window. */}
      <View style={styles.controlsRow}>
        <View style={styles.controlsCenter}>
          {logSupported && (
            <SegmentedControl
              size="sm"
              options={TAB_OPTIONS}
              value={tab}
              onValueChange={setTab}
              testID="metrics-tab"
            />
          )}
          <SegmentedControl
            size="sm"
            options={WINDOW_OPTIONS}
            value={window}
            onValueChange={setWindow}
            testID="activity-stats-window"
          />
        </View>
        {canReset && (
          <View style={styles.resetPinned}>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={Trash2}
              onPress={handleReset}
              loading={isResetting}
              testID="metrics-reset"
            >
              Reset
            </Button>
          </View>
        )}
      </View>
      {logSupported && tab === "log" ? (
        <UsageLogList serverId={serverId} window={window} onTotalsChange={handleTotals} />
      ) : (
        body
      )}
    </View>
  );
}

function StatColumn({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}): ReactElement {
  return (
    <View style={styles.column}>
      <View style={styles.columnHeader}>
        <Text style={styles.columnTitle}>{title}</Text>
        <Text style={styles.columnSubtitle}>{subtitle}</Text>
      </View>
      {children}
    </View>
  );
}

// A responsive grid that measures its own width and fits 2–3 tiles per row. An
// incomplete last row is centered: half the empty span becomes a flex spacer on
// each side, so the leftover tiles keep their natural 1/n width (not stretched)
// and sit centered instead of hugging the left with a hole on the right.
function TileGrid({ tiles, window }: { tiles: TileDef[]; window: RollupWindow }): ReactElement {
  const [gridWidth, setGridWidth] = useState(0);
  const columns = useMemo(() => resolveColumns(gridWidth), [gridWidth]);
  const handleGridLayout = useCallback(
    (event: LayoutChangeEvent) => setGridWidth(event.nativeEvent.layout.width),
    [],
  );
  const rows = chunk(tiles, columns);
  return (
    <View style={styles.grid} onLayout={handleGridLayout}>
      {rows.map((row) => {
        const empty = columns - row.length;
        // empty is 1 or 2 (max 3 cols): a single empty cell splits into two
        // half-spacers, two empties into two full ones — always symmetric.
        const edgeStyle = empty === 1 ? styles.gridSpacerHalf : styles.gridSpacer;
        return (
          <View key={row[0]!.key} style={styles.gridRow}>
            {empty > 0 && <View style={edgeStyle} />}
            {row.map((tile) => (
              <StatTile
                // Keyed by window too: switching windows remounts the tile, so
                // only live data updates (not window changes) flash.
                key={`${window}:${tile.key}`}
                Icon={tile.Icon}
                label={tile.label}
                value={tile.value}
                format={tile.format}
              />
            ))}
            {empty > 0 && <View style={edgeStyle} />}
          </View>
        );
      })}
    </View>
  );
}

// A single row that always keeps its tiles together (the token-totals row and the
// artifacts/schedules row), never reflowed by width.
function FixedRow({ tiles, window }: { tiles: TileDef[]; window: RollupWindow }): ReactElement {
  return (
    <View style={styles.gridRow}>
      {tiles.map((tile) => (
        <StatTile
          key={`${window}:${tile.key}`}
          Icon={tile.Icon}
          label={tile.label}
          value={tile.value}
          format={tile.format}
        />
      ))}
    </View>
  );
}

function StatTile({
  Icon,
  label,
  value,
  format = "count",
}: {
  Icon: typeof ThemedSend;
  label: string;
  value: number;
  // A USD cost tile needs its own formatter; "count"/"tokens" both abbreviate.
  format?: TileFormat;
}): ReactElement {
  const display = formatTileValue(value, format);
  const previousDisplay = useRef<string | null>(null);
  const flash = useSharedValue(0);

  // Brief highlight when the *displayed* value changes (raw-count changes that
  // round to the same formatted string would flash invisibly). First render
  // never flashes — only live updates after mount do.
  useEffect(() => {
    if (previousDisplay.current !== null && previousDisplay.current !== display) {
      flash.value = withSequence(
        withTiming(1, { duration: 150 }),
        withTiming(0, { duration: 650 }),
      );
    }
    previousDisplay.current = display;
  }, [display, flash]);

  const flashAnimatedStyle = useAnimatedStyle(() => ({ opacity: flash.value * 0.28 }));
  const flashStyles = useMemo(() => [styles.tileFlash, flashAnimatedStyle], [flashAnimatedStyle]);

  return (
    <View style={styles.tile}>
      <Animated.View pointerEvents="none" style={flashStyles} />
      <Icon size={30} uniProps={foregroundMutedColorMapping} />
      <Text style={styles.tileValue}>{display}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[6],
    padding: theme.spacing[6],
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.lg,
    textAlign: "center",
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  // Fixed range-totals bar under the scroll region — stays put while the log
  // scrolls (the Log tab's totals, not a row at the list's end). Horizontal
  // padding mirrors scrollContent so it lines up with the rows above.
  pinnedTotals: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingTop: theme.spacing[3],
    // 1px shorter than the top so the bar's total height trims by a pixel.
    paddingBottom: theme.spacing[3] - 1,
    gap: theme.spacing[3],
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[6],
    gap: theme.spacing[6],
  },
  section: {
    flex: 1,
    gap: theme.spacing[3],
  },
  // Positioning context for the popped-out Reset button. The centered cluster
  // fills the row; Reset is absolutely pinned right so it never shifts center.
  controlsRow: {
    position: "relative",
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  // The tabs + range filter cluster: centered across the full width, both at
  // natural width sitting side by side, wrapping to a second line only when the
  // row is too narrow to hold them.
  controlsCenter: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  // Reset lifted out of the flow so it doesn't count toward centering the tabs
  // and filter — pinned to the top-right of the controls row.
  resetPinned: {
    position: "absolute",
    right: 0,
    top: 0,
  },
  inlineMessage: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  // Two columns side by side (Activity | Usage & Cost); stacked on compact.
  columns: {
    flex: 1,
    flexDirection: "row",
    gap: theme.spacing[4],
  },
  columnsStacked: {
    flexDirection: "column",
  },
  column: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[3],
  },
  columnHeader: {
    alignItems: "center",
    gap: 2,
    paddingBottom: theme.spacing[1],
  },
  columnTitle: {
    color: theme.colors.foreground,
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  columnSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
    textAlign: "center",
  },
  // The seam between the two sides — vertical when side-by-side, a horizontal
  // rule when the columns stack on compact.
  dividerVertical: {
    width: 1,
    alignSelf: "stretch",
    backgroundColor: theme.colors.border,
  },
  dividerHorizontal: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginVertical: theme.spacing[1],
  },
  grid: {
    gap: theme.spacing[3],
  },
  gridRow: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  gridSpacer: {
    flex: 1,
  },
  gridSpacerHalf: {
    flex: 0.5,
  },
  tile: {
    flex: 1,
    minHeight: 120,
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing[4],
    gap: theme.spacing[1],
    alignItems: "center",
    justifyContent: "center",
  },
  // Accent overlay animated via opacity only — absolutely positioned, so the
  // update flash never shifts layout.
  tileFlash: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.accent,
  },
  tileValue: {
    color: theme.colors.foreground,
    fontSize: 22,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    textAlign: "center",
  },
  tileLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
    textAlign: "center",
  },
}));
