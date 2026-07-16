import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
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
import { useHosts } from "@/runtime/host-runtime";
import {
  useActivityStats,
  useActivityStatsFeature,
  type ActivityStatsRollups,
} from "@/hooks/use-activity-stats";
import {
  AlarmClock,
  Bot,
  Brain,
  Clapperboard,
  Download,
  MailReceived,
  Moon,
  Palette,
  Puzzle,
  Send,
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

type RollupWindow = keyof ActivityStatsRollups;

const WINDOW_OPTIONS: SegmentedControlOption<RollupWindow>[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7Days", label: "7 Days" },
  { value: "last30Days", label: "30 Days" },
  { value: "allTime", label: "All Time" },
];

const STAT_TILES: { field: keyof ActivityCounters; label: string; Icon: typeof ThemedSend }[] = [
  { field: "messagesSent", label: "Messages sent", Icon: ThemedSend },
  { field: "messagesReceived", label: "Messages received", Icon: ThemedMailReceived },
  { field: "tokensSent", label: "Tokens sent", Icon: ThemedUpload },
  { field: "tokensReceived", label: "Tokens received", Icon: ThemedDownload },
  { field: "agentsCreated", label: "Agent chats created", Icon: ThemedBot },
  { field: "subagentsInvoked", label: "Sub-agents invoked", Icon: ThemedPuzzle },
  { field: "runsOrchestrated", label: "Orchestrations run", Icon: ThemedClapperboard },
  { field: "backgroundTasksInvoked", label: "Background tasks", Icon: ThemedMoon },
  { field: "thoughts", label: "Thoughts", Icon: ThemedBrain },
  { field: "toolsCalled", label: "Tools called", Icon: ThemedWrench },
  { field: "artifactsCreated", label: "Artifacts created", Icon: ThemedPalette },
  { field: "schedulesExecuted", label: "Schedules executed", Icon: ThemedAlarmClock },
];

export function StatsScreen(): ReactElement {
  const isFocused = useIsFocused();
  if (!isFocused) {
    return <View style={styles.container} />;
  }
  return <StatsScreenContent />;
}

function StatsScreenContent(): ReactElement {
  const hosts = useHosts();
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
              <HostStatsSection key={host.serverId} serverId={host.serverId} />
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

// Target tile width — the grid fits as many columns of ~this size as the
// measured width allows, clamped so 12 tiles always land in 2–4 rows (a few
// wide rows that fill the screen, never one row of small squares).
const TARGET_TILE_WIDTH = 240;
const MIN_COLUMNS = 3;
const MAX_COLUMNS = 6;

function resolveColumns(width: number): number {
  if (width <= 0) {
    return MIN_COLUMNS;
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

function HostStatsSection({ serverId }: { serverId: string }): ReactElement | null {
  const supported = useActivityStatsFeature(serverId);
  const [window, setWindow] = useState<RollupWindow>("today");
  const [gridWidth, setGridWidth] = useState(0);
  const { view } = useActivityStats(serverId);

  const columns = useMemo(() => resolveColumns(gridWidth), [gridWidth]);
  const handleGridLayout = useCallback(
    (event: LayoutChangeEvent) => setGridWidth(event.nativeEvent.layout.width),
    [],
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
    const rows = chunk(STAT_TILES, columns);
    body = (
      <View style={styles.grid} onLayout={handleGridLayout}>
        {rows.map((row) => (
          <View key={row[0]!.field} style={styles.gridRow}>
            {row.map((tile) => (
              <StatTile
                // Keyed by window too: switching windows remounts the tile, so
                // only live data updates (not window changes) flash.
                key={`${window}:${tile.field}`}
                Icon={tile.Icon}
                label={tile.label}
                value={counters[tile.field]}
              />
            ))}
            {/* Pad the final row so tiles keep a consistent width instead of
                stretching to fill the leftover columns. */}
            {Array.from({ length: columns - row.length }, (_, index) => (
              <View key={`spacer:${index}`} style={styles.gridSpacer} />
            ))}
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <SegmentedControl
        size="sm"
        options={WINDOW_OPTIONS}
        value={window}
        onValueChange={setWindow}
        testID="activity-stats-window"
      />
      {body}
    </View>
  );
}

function StatTile({
  Icon,
  label,
  value,
}: {
  Icon: typeof ThemedSend;
  label: string;
  value: number;
}): ReactElement {
  const display = formatTokenCount(value);
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
  inlineMessage: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  // Fill the remaining viewport (scrollContent flexGrow: 1) so the rows stretch
  // to give a few tall rows instead of one row of small squares.
  grid: {
    flex: 1,
    gap: theme.spacing[3],
  },
  gridRow: {
    flex: 1,
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  gridSpacer: {
    flex: 1,
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
