import { useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
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

function HostStatsSection({ serverId }: { serverId: string }): ReactElement | null {
  const supported = useActivityStatsFeature(serverId);
  const [window, setWindow] = useState<RollupWindow>("today");
  const { view } = useActivityStats(serverId);

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
    body = (
      <View style={styles.grid}>
        {STAT_TILES.map((tile) => (
          <StatTile
            key={tile.field}
            Icon={tile.Icon}
            label={tile.label}
            value={counters[tile.field]}
          />
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
  return (
    <View style={styles.tile}>
      <Icon size={30} uniProps={foregroundMutedColorMapping} />
      <Text style={styles.tileValue}>{formatTokenCount(value)}</Text>
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
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[6],
    gap: theme.spacing[6],
  },
  section: {
    gap: theme.spacing[3],
  },
  inlineMessage: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  tile: {
    minWidth: 140,
    flexGrow: 1,
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing[4],
    gap: theme.spacing[1],
    alignItems: "center",
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
