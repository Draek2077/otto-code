import { useMemo, useState } from "react";
import { ActivityIndicator, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useFetchQuery } from "@/data/query";
import type { SheetHeader } from "@/components/adaptive-modal-sheet";
import type { SegmentedControlOption } from "@/components/ui/segmented-control";
import { TabbedModalSheet } from "@/components/ui/tabbed-modal-sheet";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { themeColorRef } from "@/styles/theme-color-ref";
import type { Theme } from "@/styles/theme";
import type { BrainEvals, BrainHostStatus } from "@otto-code/protocol/messages";

// ---------------------------------------------------------------------------
// The "watch it like the TUI" dashboard. Two panes over the two brain RPCs:
// a LIVE status feed (polled ~2s while the sheet is open) and a periodic EVALS
// snapshot. The status/evals sub-objects are opaque passthrough records in the
// protocol (telemetry, scheduler, recent, rankings, variance), so every field
// is read defensively — optional access with sensible fallbacks — rather than
// assuming a typed shape.
//
// v1 polls with react-query. A websocket push feed (subscribe_brain_status +
// brain_status_changed) is the later optimization; it lands with its consumers.
// ---------------------------------------------------------------------------

const STATUS_REFRESH_MS = 2000;
const EVALS_STALE_MS = 15_000;

type BrainDashboardTab = "live" | "evals";

interface BrainDashboardSheetProps {
  serverId: string;
  visible: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Defensive readers for the opaque passthrough records
// ---------------------------------------------------------------------------

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function readNumber(record: UnknownRecord | null | undefined, ...keys: string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function readString(record: UnknownRecord | null | undefined, ...keys: string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatGiB(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(Math.round(value));
}

function formatSeconds(seconds: number): string {
  return seconds >= 60 ? `${(seconds / 60).toFixed(1)}m` : `${seconds.toFixed(1)}s`;
}

function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

function formatEndpoint(status: BrainHostStatus): string | null {
  const host = status.displayHost ?? status.host;
  if (!host || !status.port) {
    return null;
  }
  return `${status.secure ? "https" : "http"}://${host}:${status.port}`;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

// ---------------------------------------------------------------------------
// Data hooks
// ---------------------------------------------------------------------------

function brainDashboardStatusKey(serverId: string): readonly [string, string] {
  return ["brain-dashboard-status", serverId] as const;
}

function brainDashboardEvalsKey(serverId: string): readonly [string, string] {
  return ["brain-dashboard-evals", serverId] as const;
}

// Live status: refetches ~2s while the sheet is mounted + visible, gated on the
// host being connected and declaring the brainStatus capability.
function useBrainStatusLive(serverId: string, enabled: boolean) {
  const client = useHostRuntimeClient(serverId);
  return useFetchQuery({
    queryKey: brainDashboardStatusKey(serverId),
    enabled: enabled && Boolean(client),
    dataShape: "value",
    staleTimeMs: STATUS_REFRESH_MS,
    refetchInterval: enabled ? STATUS_REFRESH_MS : false,
    queryFn: async () => {
      if (!client) {
        throw new Error("Local brain host is unavailable");
      }
      return client.brainHostStatus();
    },
  });
}

// Evals: a periodic snapshot, not a live feed. Fetched when the evals tab is
// active and allowed to go stale between opens.
function useBrainEvals(serverId: string, enabled: boolean) {
  const client = useHostRuntimeClient(serverId);
  return useFetchQuery({
    queryKey: brainDashboardEvalsKey(serverId),
    enabled: enabled && Boolean(client),
    dataShape: "value",
    staleTimeMs: EVALS_STALE_MS,
    queryFn: async () => {
      if (!client) {
        throw new Error("Local brain host is unavailable");
      }
      return client.brainEvalsGet();
    },
  });
}

// ---------------------------------------------------------------------------
// VRAM ring (SVG). Mirrors context-window-meter: strokes ride the `style` prop
// so the `themeColorRef` var() refs resolve as real CSS, and the theme colors
// are mapped through a `withUnistyles` wrapper so only the ring repaints.
// ---------------------------------------------------------------------------

const RING_SIZE = 72;
const RING_CENTER = RING_SIZE / 2;
const RING_RADIUS = 30;
const RING_STROKE = 8;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const RING_ROTATE_TRANSFORM = `rotate(-90 ${RING_CENTER} ${RING_CENTER})`;

function strokeStyleProps(stroke: string): { style: { stroke: string } } {
  return { style: { stroke } };
}

function VramRingInner({
  used,
  total,
  trackColor,
  fillColor,
}: {
  used: number;
  total: number;
  trackColor: string;
  fillColor: string;
}) {
  const percent = clampPercent((used / total) * 100);
  const dashOffset = RING_CIRCUMFERENCE - (percent / 100) * RING_CIRCUMFERENCE;
  return (
    <View style={styles.ring}>
      <Svg
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        aria-hidden
      >
        <G transform={RING_ROTATE_TRANSFORM}>
          <Circle
            cx={RING_CENTER}
            cy={RING_CENTER}
            r={RING_RADIUS}
            fill="none"
            strokeWidth={RING_STROKE}
            {...strokeStyleProps(trackColor)}
          />
          <Circle
            cx={RING_CENTER}
            cy={RING_CENTER}
            r={RING_RADIUS}
            fill="none"
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            {...strokeStyleProps(fillColor)}
          />
        </G>
      </Svg>
      <View style={styles.ringCenter}>
        <Text style={styles.ringPercent}>{Math.round(percent)}%</Text>
      </View>
    </View>
  );
}

// `useUnistyles()` is banned (docs/unistyles.md); the ring's theme colors are
// mapped as props so only this wrapper re-renders on theme change.
const VramRing = withUnistyles(VramRingInner, (theme: Theme) => ({
  trackColor: themeColorRef(theme, "surface3"),
  fillColor: themeColorRef(theme, "accent"),
}));

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string | null }) {
  return (
    <View style={styles.statTile}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      {hint ? (
        <Text style={styles.statHint} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// LIVE STATUS pane
// ---------------------------------------------------------------------------

type VerdictKey = "ok" | "reasoningOnly" | "truncated" | "failed" | "warning";

interface VerdictMeta {
  key: VerdictKey;
  label: string;
  fill: StyleProp<ViewStyle>;
}

function VerdictBar({
  label,
  count,
  fraction,
  fill,
}: {
  label: string;
  count: number;
  fraction: number;
  fill: StyleProp<ViewStyle>;
}) {
  const widthPercent = clampPercent(fraction * 100);
  const fillStyle = useMemo(
    () => [styles.verdictFill, fill, { width: `${widthPercent}%` as const }],
    [fill, widthPercent],
  );
  return (
    <View style={styles.verdictRow}>
      <Text style={styles.verdictLabel} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.verdictTrack}>
        <View style={fillStyle} />
      </View>
      <Text style={styles.verdictCount}>{formatCount(count)}</Text>
    </View>
  );
}

function TelemetryPanel({ status }: { status: BrainHostStatus }) {
  const telemetry = asRecord(status.telemetry);
  const counts: Record<VerdictKey, number> = {
    ok: readNumber(telemetry, "ok") ?? 0,
    reasoningOnly: readNumber(telemetry, "reasoningOnly", "reasoning_only") ?? 0,
    truncated: readNumber(telemetry, "truncated") ?? 0,
    failed: readNumber(telemetry, "failed") ?? 0,
    warning: readNumber(telemetry, "warning") ?? 0,
  };
  const requests = readNumber(telemetry, "requests", "total");
  const anyVerdict = VERDICTS.some((verdict) => counts[verdict.key] > 0);

  // Bars are shares of all requests when the total is known; otherwise shares of
  // the largest single verdict so the panel still reads.
  const denominator =
    requests && requests > 0
      ? requests
      : Math.max(1, ...VERDICTS.map((verdict) => counts[verdict.key]));

  return (
    <View style={styles.card}>
      <View style={styles.telemetryHeader}>
        <SectionLabel>Requests</SectionLabel>
        <Text style={styles.telemetryTotal}>{requests != null ? formatCount(requests) : "—"}</Text>
      </View>
      {anyVerdict ? (
        <View style={styles.verdictList}>
          {VERDICTS.map((verdict) => (
            <VerdictBar
              key={verdict.key}
              label={verdict.label}
              count={counts[verdict.key]}
              fraction={counts[verdict.key] / denominator}
              fill={verdict.fill}
            />
          ))}
        </View>
      ) : (
        <Text style={styles.mutedText}>No requests served yet.</Text>
      )}
    </View>
  );
}

function StatusHero({ status }: { status: BrainHostStatus }) {
  const running = status.running === true;
  const stateLabel = status.state ?? (running ? "Running" : "Stopped");
  const model = status.model ?? status.modelId ?? null;
  const endpoint = formatEndpoint(status);
  return (
    <View style={styles.card}>
      <View style={styles.heroTopRow}>
        <View style={running ? STATUS_PILL_RUNNING_STYLE : STATUS_PILL_STOPPED_STYLE}>
          <View style={running ? styles.statusDotRunning : styles.statusDotStopped} />
          <Text style={running ? styles.statusTextRunning : styles.statusTextStopped}>
            {stateLabel}
          </Text>
        </View>
        {status.version ? <Text style={styles.mutedText}>v{status.version}</Text> : null}
      </View>
      {model ? (
        <Text style={styles.heroModel} numberOfLines={1}>
          {model}
        </Text>
      ) : null}
      {endpoint ? (
        <Text style={styles.heroEndpoint} numberOfLines={1}>
          {endpoint}
        </Text>
      ) : null}
    </View>
  );
}

function LiveStatusPane({
  status,
  loading,
  connected,
}: {
  status: BrainHostStatus | null;
  loading: boolean;
  connected: boolean;
}) {
  if (!connected) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.mutedText}>Connect to the host to watch the local brain.</Text>
      </View>
    );
  }
  if (!status) {
    return (
      <View style={styles.emptyState}>
        <ActivityIndicator size="small" />
        <Text style={styles.mutedText}>{loading ? "Loading status…" : "No status yet."}</Text>
      </View>
    );
  }

  const vramUsed = readNumber(asRecord(status), "vramBytes");
  // No VRAM total is guaranteed by the protocol; read a few likely passthrough
  // keys and fall back to a used-only stat tile when none is present.
  const vramTotal = readNumber(
    asRecord(status),
    "vramTotalBytes",
    "vramCapacityBytes",
    "totalVramBytes",
    "vramLimitBytes",
    "vramMaxBytes",
  );
  const loadSeconds = readNumber(asRecord(status), "loadSeconds");
  const warningMessage = readString(asRecord(status), "warning");

  return (
    <View style={styles.paneContent}>
      <StatusHero status={status} />

      <View style={styles.statRow}>
        {vramUsed != null && vramTotal != null && vramTotal > 0 ? (
          <View style={styles.ringTile}>
            <VramRing used={vramUsed} total={vramTotal} />
            <View style={styles.ringTileText}>
              <Text style={styles.statLabel}>VRAM</Text>
              <Text style={styles.statValue} numberOfLines={1}>
                {formatGiB(vramUsed)}
              </Text>
              <Text style={styles.statHint} numberOfLines={1}>
                of {formatGiB(vramTotal)}
              </Text>
            </View>
          </View>
        ) : (
          <StatTile label="VRAM" value={vramUsed != null ? formatGiB(vramUsed) : "—"} />
        )}
        <StatTile
          label="Load time"
          value={loadSeconds != null ? formatSeconds(loadSeconds) : "—"}
        />
      </View>

      <TelemetryPanel status={status} />

      {warningMessage ? (
        <View style={styles.warningCard}>
          <Text style={styles.warningText}>{warningMessage}</Text>
        </View>
      ) : null}
      {status.lastError ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{status.lastError}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// EVALS pane
// ---------------------------------------------------------------------------

interface RankedRow {
  id: string;
  name: string;
  overallPercent: number;
  runs: number;
  grade: string | null;
  rank: number;
}

function readRankings(evals: BrainEvals | null): RankedRow[] {
  if (!evals) return [];
  return evals.rankings
    .map((raw, index): RankedRow => {
      const overall = readNumber(raw, "overall");
      const rank = readNumber(raw, "rank");
      const name = readString(raw, "displayName", "id") ?? "Unknown model";
      return {
        id: readString(raw, "id") ?? name,
        name,
        // overall is reported 0..1.
        overallPercent: overall != null ? clampPercent(overall * 100) : 0,
        runs: readNumber(raw, "runs") ?? 0,
        grade: readString(raw, "grade"),
        rank: rank != null ? rank : index + 1,
      };
    })
    .sort((a, b) => a.rank - b.rank || b.overallPercent - a.overallPercent);
}

interface VarianceRow {
  key: string;
  name: string;
  count: number;
  mean: number | null;
  std: number | null;
}

function readVariance(evals: BrainEvals | null): VarianceRow[] {
  if (!evals) return [];
  return evals.variance.map((raw, index): VarianceRow => {
    const model = asRecord(raw.model);
    const overall = asRecord(raw.overall);
    const name = readString(model, "displayName") ?? readString(raw, "model") ?? "Unknown model";
    const configKey = readString(raw, "configKey");
    return {
      key: `${name}:${configKey ?? index}`,
      name,
      count: readNumber(raw, "count") ?? 0,
      mean: readNumber(overall, "mean"),
      std: readNumber(overall, "std"),
    };
  });
}

function RankingBar({ row }: { row: RankedRow }) {
  const fillStyle = useMemo(
    () => [styles.rankFill, { width: `${clampPercent(row.overallPercent)}%` as const }],
    [row.overallPercent],
  );
  return (
    <View style={styles.rankRow}>
      <View style={styles.rankHeader}>
        <View style={styles.rankBadge}>
          <Text style={styles.rankBadgeText}>#{row.rank}</Text>
        </View>
        <Text style={styles.rankName} numberOfLines={1}>
          {row.name}
        </Text>
        <Text style={styles.rankPercent}>{row.overallPercent.toFixed(1)}%</Text>
      </View>
      <View style={styles.rankTrack}>
        <View style={fillStyle} />
      </View>
      <View style={styles.rankMetaRow}>
        <Text style={styles.rankMeta}>{row.grade ? `Grade ${row.grade}` : "Ungraded"}</Text>
        <Text style={styles.rankMeta}>
          {row.runs} {row.runs === 1 ? "run" : "runs"}
        </Text>
      </View>
    </View>
  );
}

function VarianceTable({ rows }: { rows: VarianceRow[] }) {
  if (rows.length === 0) return null;
  return (
    <View style={styles.card}>
      <SectionLabel>Variance</SectionLabel>
      <View style={styles.varianceHeaderRow}>
        <Text style={VARIANCE_MODEL_HEAD_STYLE}>Model</Text>
        <Text style={VARIANCE_NUM_HEAD_STYLE}>Runs</Text>
        <Text style={VARIANCE_NUM_HEAD_STYLE}>Mean</Text>
        <Text style={VARIANCE_NUM_HEAD_STYLE}>Spread</Text>
      </View>
      {rows.map((row) => (
        <View key={row.key} style={styles.varianceRow}>
          <Text style={VARIANCE_MODEL_CELL_STYLE} numberOfLines={1}>
            {row.name}
          </Text>
          <Text style={VARIANCE_NUM_CELL_STYLE}>{row.count}</Text>
          <Text style={VARIANCE_NUM_CELL_STYLE}>
            {row.mean != null ? formatPercent(row.mean) : "—"}
          </Text>
          <Text style={VARIANCE_NUM_CELL_STYLE}>
            {row.std != null ? `± ${(row.std * 100).toFixed(1)}` : "—"}
          </Text>
        </View>
      ))}
    </View>
  );
}

function EvalsPane({
  evals,
  loading,
  connected,
}: {
  evals: BrainEvals | null;
  loading: boolean;
  connected: boolean;
}) {
  const rankings = useMemo(() => readRankings(evals), [evals]);
  const variance = useMemo(() => readVariance(evals), [evals]);

  if (!connected) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.mutedText}>Connect to the host to view benchmark results.</Text>
      </View>
    );
  }
  if (!evals && loading) {
    return (
      <View style={styles.emptyState}>
        <ActivityIndicator size="small" />
        <Text style={styles.mutedText}>Loading evals…</Text>
      </View>
    );
  }
  if (!evals || evals.runCount === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>No benchmark runs yet.</Text>
        <Text style={styles.mutedText}>Run `otto brain bench` to rank your local models.</Text>
      </View>
    );
  }

  return (
    <View style={styles.paneContent}>
      <View style={styles.card}>
        <View style={styles.telemetryHeader}>
          <SectionLabel>Model rankings</SectionLabel>
          <Text style={styles.mutedText}>
            {evals.runCount} {evals.runCount === 1 ? "run" : "runs"}
          </Text>
        </View>
        {rankings.length > 0 ? (
          <View style={styles.rankList}>
            {rankings.map((row) => (
              <RankingBar key={row.id} row={row} />
            ))}
          </View>
        ) : (
          <Text style={styles.mutedText}>No ranked models yet.</Text>
        )}
      </View>
      <VarianceTable rows={variance} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------

export function BrainDashboardSheet({ serverId, visible, onClose }: BrainDashboardSheetProps) {
  const [activeTab, setActiveTab] = useState<BrainDashboardTab>("live");
  const isConnected = useHostRuntimeIsConnected(serverId);
  const statusSupported = useHostFeature(serverId, "brainStatus");
  const canQuery = visible && isConnected && statusSupported;

  const statusQuery = useBrainStatusLive(serverId, canQuery);
  const evalsQuery = useBrainEvals(serverId, canQuery && activeTab === "evals");

  const tabs = useMemo<SegmentedControlOption<BrainDashboardTab>[]>(
    () => [
      { value: "live", label: "Live status", testID: "brain-dashboard-tab-live" },
      { value: "evals", label: "Evals", testID: "brain-dashboard-tab-evals" },
    ],
    [],
  );
  const header = useMemo<SheetHeader>(() => ({ title: "Local brain dashboard" }), []);

  return (
    <TabbedModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      tabsTestID="brain-dashboard-tabs"
      testID="brain-dashboard-sheet"
    >
      {activeTab === "live" ? (
        <LiveStatusPane
          status={statusQuery.data ?? null}
          loading={statusQuery.isLoading}
          connected={isConnected && statusSupported}
        />
      ) : (
        <EvalsPane
          evals={evalsQuery.data ?? null}
          loading={evalsQuery.isLoading}
          connected={isConnected && statusSupported}
        />
      )}
    </TabbedModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  paneContent: {
    gap: theme.spacing[4],
  },
  card: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  sectionLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  mutedText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[8],
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  // Status hero -------------------------------------------------------------
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  heroModel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  heroEndpoint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    borderRadius: theme.borderRadius.full,
  },
  statusPillRunning: {
    backgroundColor: "rgba(74, 222, 128, 0.1)",
  },
  statusPillStopped: {
    backgroundColor: "rgba(161, 161, 170, 0.1)",
  },
  statusDotRunning: {
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.palette.green[400],
  },
  statusDotStopped: {
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.foregroundMuted,
  },
  statusTextRunning: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.palette.green[400],
  },
  statusTextStopped: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  // Stat tiles --------------------------------------------------------------
  statRow: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  statTile: {
    flex: 1,
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing[4],
    gap: theme.spacing[1],
    justifyContent: "center",
  },
  statLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  statValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
  },
  statHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  ringTile: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing[4],
  },
  ringTileText: {
    flexShrink: 1,
    gap: theme.spacing[1],
  },
  ring: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  ringCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  ringPercent: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  // Telemetry / verdicts ----------------------------------------------------
  telemetryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  telemetryTotal: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  verdictList: {
    gap: theme.spacing[2],
  },
  verdictRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  verdictLabel: {
    width: 104,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  verdictTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.surface3,
    overflow: "hidden",
  },
  verdictFill: {
    height: 8,
    borderRadius: 4,
  },
  verdictCount: {
    minWidth: 44,
    textAlign: "right",
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    fontVariant: ["tabular-nums"],
  },
  fillOk: {
    backgroundColor: theme.colors.statusSuccess,
  },
  fillReasoning: {
    backgroundColor: theme.colors.statusInfo,
  },
  fillTruncated: {
    backgroundColor: theme.colors.statusWarning,
  },
  fillFailed: {
    backgroundColor: theme.colors.statusDanger,
  },
  fillWarning: {
    backgroundColor: theme.colors.statusMerged,
  },
  // Warning / error ---------------------------------------------------------
  warningCard: {
    backgroundColor: theme.colors.statusWarningSurface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3],
  },
  warningText: {
    color: theme.colors.statusWarningStrong,
    fontSize: theme.fontSize.sm,
  },
  errorCard: {
    backgroundColor: theme.colors.statusDangerSurface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3],
  },
  errorText: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
  // Rankings ----------------------------------------------------------------
  rankList: {
    gap: theme.spacing[3],
  },
  rankRow: {
    gap: theme.spacing[1.5],
  },
  rankHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  rankBadge: {
    minWidth: 28,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
    alignItems: "center",
  },
  rankBadgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    fontVariant: ["tabular-nums"],
  },
  rankName: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  rankPercent: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    fontVariant: ["tabular-nums"],
  },
  rankTrack: {
    height: 10,
    borderRadius: 4,
    backgroundColor: theme.colors.surface3,
    overflow: "hidden",
  },
  rankFill: {
    height: 10,
    borderRadius: 4,
    backgroundColor: theme.colors.accent,
  },
  rankMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  rankMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  // Variance table ----------------------------------------------------------
  varianceHeaderRow: {
    flexDirection: "row",
    gap: theme.spacing[2],
    paddingBottom: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  varianceHeadCell: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  varianceRow: {
    flexDirection: "row",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
  },
  varianceCell: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  varianceModelCol: {
    flex: 1,
  },
  varianceNumCol: {
    width: 56,
    textAlign: "right",
  },
}));

// Verdict → fill mapping. Declared after `styles` so the fill style objects
// exist; the TUI surfaces these same verdicts. Each fill carries a status hue,
// always paired with its label + count (never color alone).
const VERDICTS: VerdictMeta[] = [
  { key: "ok", label: "OK", fill: styles.fillOk },
  { key: "reasoningOnly", label: "Reasoning only", fill: styles.fillReasoning },
  { key: "truncated", label: "Truncated", fill: styles.fillTruncated },
  { key: "failed", label: "Failed", fill: styles.fillFailed },
  { key: "warning", label: "Warning", fill: styles.fillWarning },
];

const STATUS_PILL_RUNNING_STYLE = [styles.statusPill, styles.statusPillRunning];
const STATUS_PILL_STOPPED_STYLE = [styles.statusPill, styles.statusPillStopped];
const VARIANCE_MODEL_HEAD_STYLE = [styles.varianceHeadCell, styles.varianceModelCol];
const VARIANCE_NUM_HEAD_STYLE = [styles.varianceHeadCell, styles.varianceNumCol];
const VARIANCE_MODEL_CELL_STYLE = [styles.varianceCell, styles.varianceModelCol];
const VARIANCE_NUM_CELL_STYLE = [styles.varianceCell, styles.varianceNumCol];
