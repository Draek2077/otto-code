import { useEffect, useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { UsageEvent } from "@otto-code/protocol/messages";
import type { Theme } from "@/styles/theme";
import { formatTokenCount } from "@/components/context-window-meter.utils";
import {
  computeParentRowTotals,
  formatMicroUsd,
  formatUsageEventAge,
  groupUsageRowsByParent,
  usageDayHeaderLabel,
  usageDayKey,
  usageKindLabel,
  usageWindowRange,
  type UsageLogWindow,
  type UsageParentTotals,
} from "@/components/usage-format";
import { useUsageLog } from "@/hooks/use-usage-log";
import {
  Layers,
  MessageSquare,
  Puzzle,
  Scissors,
  Server,
  Sparkles,
} from "@/components/icons/material-icons";

const ThemedMessageSquare = withUnistyles(MessageSquare);
const ThemedPuzzle = withUnistyles(Puzzle);
const ThemedSparkles = withUnistyles(Sparkles);
const ThemedScissors = withUnistyles(Scissors);
const ThemedServer = withUnistyles(Server);
const ThemedLayers = withUnistyles(Layers);

const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function kindIcon(kind: string): typeof ThemedMessageSquare {
  switch (kind) {
    case "chat":
      return ThemedMessageSquare;
    case "subagent":
      return ThemedPuzzle;
    case "generation":
      return ThemedSparkles;
    case "compaction":
      return ThemedScissors;
    default:
      return ThemedServer;
  }
}

interface DayGroup {
  key: number;
  label: string;
  events: UsageEvent[];
}

export interface UsageTotals {
  count: number;
  fresh: number;
  cached: number;
  out: number;
  cost: number;
}

// Bucket the (already newest-first) rows into contiguous local-day groups,
// preserving order so the newest day heads the list and rows stay chronological
// within it. Same-day rows are adjacent in the source, so a running group works.
function groupByDay(events: UsageEvent[], now: number): DayGroup[] {
  const groups: DayGroup[] = [];
  let current: DayGroup | null = null;
  for (const event of events) {
    const key = usageDayKey(event.at);
    if (!current || current.key !== key) {
      current = { key, label: usageDayHeaderLabel(event.at, now), events: [] };
      groups.push(current);
    }
    current.events.push(event);
  }
  return groups;
}

function computeTotals(events: UsageEvent[]): UsageTotals {
  let fresh = 0;
  let cached = 0;
  let out = 0;
  let cost = 0;
  for (const event of events) {
    const c = event.cachedTokensIn ?? 0;
    cached += c;
    fresh += Math.max(0, event.tokensIn - c);
    out += event.tokensOut;
    cost += event.costMicroUsd;
  }
  return { count: events.length, fresh, cached, out, cost };
}

// The itemized usage ledger — the scrollable rows behind the Metrics tiles
// (usage-ledger). Renders as plain mapped rows (not a FlatList) so it composes
// inside the Metrics screen's outer ScrollView without nested-scroll conflicts;
// the page size is capped at 200 rows, well within a cheap map. `window` mirrors
// the Summary tab's range selector, filtered client-side over the loaded page.
// The range totals are NOT rendered here — they're reported up via
// `onTotalsChange` so the Metrics screen can pin them below its scroll region
// (a fixed screen-bottom bar, not a row that scrolls away with the list).
export function UsageLogList({
  serverId,
  window,
  onTotalsChange,
}: {
  serverId: string;
  window: UsageLogWindow;
  onTotalsChange?: (totals: UsageTotals | null) => void;
}): ReactElement {
  const { view } = useUsageLog(serverId);
  const now = Date.now();

  const filtered = useMemo(() => {
    if (view.kind !== "ready") return [];
    const { start, end } = usageWindowRange(window, now);
    return view.data.events.filter((event) => event.at >= start && event.at < end);
  }, [view, window, now]);
  const groups = useMemo(() => groupByDay(filtered, now), [filtered, now]);
  const totals = useMemo(() => computeTotals(filtered), [filtered]);

  // Publish totals to the screen (null = nothing to pin: still loading, errored,
  // or the range is empty). This re-fires with a fresh object each render (totals
  // derive from a per-render `now`); the screen dedups by value so it doesn't
  // loop. Clear on unmount so switching to the Summary tab or leaving the screen
  // retracts the pinned bar.
  const ready = view.kind === "ready" && totals.count > 0;
  useEffect(() => {
    onTotalsChange?.(ready ? totals : null);
  }, [onTotalsChange, ready, totals]);
  useEffect(() => {
    return () => onTotalsChange?.(null);
  }, [onTotalsChange]);

  if (view.kind === "loading") {
    return <Text style={styles.message}>Loading activity…</Text>;
  }
  if (view.kind === "error") {
    return <Text style={styles.message}>{view.message}</Text>;
  }
  if (view.data.events.length === 0) {
    return (
      <Text style={styles.message}>
        No activity recorded yet. Rows appear here as agents run, generate titles, and compact.
      </Text>
    );
  }
  if (filtered.length === 0) {
    return <Text style={styles.message}>No activity in this range.</Text>;
  }

  return (
    <View style={styles.list}>
      {groups.map((group) => {
        // Cluster the day's rows by chat, then roll each chat turn's sub-agents
        // up into whole-tree totals shown on the parent row only.
        const ordered = groupUsageRowsByParent(group.events);
        const parentTotals = computeParentRowTotals(ordered);
        return (
          <View key={group.key} style={styles.dayGroup}>
            <Text style={styles.dayHeader}>{group.label}</Text>
            {ordered.map((event) => (
              <UsageLogRow
                key={event.id}
                event={event}
                now={now}
                treeTotals={parentTotals.get(event.id)}
              />
            ))}
          </View>
        );
      })}
      {view.data.hasMore && (
        <Text style={styles.more}>Showing the most recent 200 activities.</Text>
      )}
    </View>
  );
}

// Range totals for the current window: how many provider interactions it holds
// and what they moved, split the same fresh/cached/out way as a row. Rendered by
// the Metrics screen in a fixed bar below the scroll region (not inside the list),
// so it stays visible while the log scrolls. `label` names the host when more than
// one is shown at once.
export function UsageTotalsBar({
  totals,
  label,
}: {
  totals: UsageTotals;
  label?: string;
}): ReactElement {
  const hasCost = totals.cost > 0;
  return (
    <View style={styles.totalsBar}>
      <View style={styles.totalsMain}>
        <Text style={styles.totalsCount}>
          {label ? `${label} · ` : ""}
          {totals.count === 1 ? "1 interaction" : `${totals.count} interactions`}
        </Text>
        <View style={styles.rowTokensLine}>
          <Text style={styles.totalsTokensIn}>{`↑ ${formatTokenCount(totals.fresh)} fresh`}</Text>
          {totals.cached > 0 ? (
            <View style={styles.rowTokenSeg}>
              <ThemedLayers size={12} uniProps={mutedColor} />
              <Text style={styles.totalsTokens}>{`${formatTokenCount(totals.cached)} cached`}</Text>
            </View>
          ) : null}
          <Text style={styles.totalsTokensOut}>{`↓ ${formatTokenCount(totals.out)}`}</Text>
        </View>
      </View>
      {/* Cost pushed to the right, insetter matching the rows' cost column. */}
      {hasCost ? <Text style={styles.totalsCost}>{formatMicroUsd(totals.cost)}</Text> : null}
    </View>
  );
}

function UsageLogRow({
  event,
  now,
  treeTotals,
}: {
  event: UsageEvent;
  now: number;
  /**
   * Whole-tree rollup (this turn + all its sub-agents, any nesting depth) —
   * present only on a chat row that owns sub-agent rows below it.
   */
  treeTotals?: UsageParentTotals;
}): ReactElement {
  const Icon = kindIcon(event.kind);
  const meta = useMemo(() => {
    const parts: string[] = [];
    if (event.model) parts.push(event.model);
    else if (event.provider) parts.push(event.provider);
    if (event.subtype) parts.push(event.subtype);
    return parts.join(" · ");
  }, [event.model, event.provider, event.subtype]);

  const hasCost = event.costMicroUsd > 0;
  const compaction = (event.compactionTokensIn ?? 0) + (event.compactionTokensOut ?? 0);
  // Split the "in" total into cache-read vs. fresh (full-rate) send. Fresh is the
  // rest of the total; on providers with no cache reads (cachedTokensIn absent)
  // the whole thing reads as fresh, which is the honest picture there.
  const cached = event.cachedTokensIn ?? 0;
  const fresh = Math.max(0, event.tokensIn - cached);
  // Sub-agent rows indent under the chat that spawned them (grouped by agentId
  // upstream), so a delegated turn's cost reads as belonging to its parent chat.
  const indented = event.kind === "subagent";

  return (
    <View style={indented ? styles.rowIndented : styles.row}>
      <Icon size={20} uniProps={mutedColor} />
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {usageKindLabel(event.kind)}
          {meta ? <Text style={styles.rowMeta}>{`  ${meta}`}</Text> : null}
        </Text>
        <View style={styles.rowTokensLine}>
          <Text style={styles.rowTokensIn}>{`↑ ${formatTokenCount(fresh)} fresh`}</Text>
          {cached > 0 ? (
            <View style={styles.rowTokenSeg}>
              <ThemedLayers size={12} uniProps={mutedColor} />
              <Text style={styles.rowTokens}>{`${formatTokenCount(cached)} cached`}</Text>
            </View>
          ) : null}
          <Text style={styles.rowTokensOut}>{`↓ ${formatTokenCount(event.tokensOut)}`}</Text>
          {/* Round count makes a large cached figure legible: it is the same
              context re-read once per round, not a cache "size". */}
          {event.rounds && event.rounds > 1 ? (
            <Text style={styles.rowTokens}>{`· ${event.rounds} rounds`}</Text>
          ) : null}
          {compaction > 0 ? (
            <Text
              style={styles.rowCompaction}
            >{`⤶ ${formatTokenCount(compaction)} compacted`}</Text>
          ) : null}
          {/* Whole-tree token totals (turn + all its sub-agents), split the
              same fresh/cached/out way as the row's own figures — a flat sum
              would bury the cache-read share. Last so the row's own figures
              stay primary. */}
          {treeTotals ? (
            <>
              {/* Bullet sets the rollup off from the row's own token stats. As a
                  direct child of the line it gets the same columnGap on both
                  sides, keeping the spacing even. */}
              <Text style={styles.rowTokens}>·</Text>
              <View style={styles.rowTreeSeg}>
                <Text
                  style={styles.rowTreeTotalIn}
                >{`Σ ↑ ${formatTokenCount(treeTotals.fresh)} fresh`}</Text>
                {treeTotals.cached > 0 ? (
                  <View style={styles.rowTokenSeg}>
                    <ThemedLayers size={12} uniProps={mutedColor} />
                    <Text style={styles.rowTreeTotal}>
                      {`${formatTokenCount(treeTotals.cached)} cached`}
                    </Text>
                  </View>
                ) : null}
                <Text
                  style={styles.rowTreeTotalOut}
                >{`↓ ${formatTokenCount(treeTotals.out)}`}</Text>
              </View>
            </>
          ) : null}
        </View>
      </View>
      <View style={styles.rowRight}>
        <View style={styles.rowCostLine}>
          {/* Whole-tree cost sits left of the row's own cost, muted so the
              per-turn figure stays the headline. Hidden when the tree cost is
              all zeros (token-only providers). */}
          {treeTotals && treeTotals.costMicroUsd > 0 ? (
            <>
              <Text
                style={styles.rowTreeTotalCost}
              >{`Σ ${formatMicroUsd(treeTotals.costMicroUsd)}`}</Text>
              {/* Bullet sets the rollup off from the row's own cost; the line's
                  4px gap spaces it evenly from both figures. */}
              <Text style={styles.rowTreeTotal}>·</Text>
            </>
          ) : null}
          <Text style={hasCost ? styles.rowCost : styles.rowCostMuted}>
            {hasCost ? formatMicroUsd(event.costMicroUsd) : "—"}
          </Text>
        </View>
        <Text style={styles.rowAge}>{formatUsageEventAge(event.at, now)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    gap: theme.spacing[2],
  },
  dayGroup: {
    gap: theme.spacing[2],
  },
  dayHeader: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    paddingTop: theme.spacing[1],
  },
  totalsBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    // Inset the cost to sit under the rows' cost column: each row is a card with
    // a 1px border + spacing[3] inner padding, so its cost is that far in from
    // the content edge. The bar has no card, so add the same inset here.
    paddingRight: theme.spacing[3] + 1,
  },
  totalsMain: {
    flexShrink: 1,
    minWidth: 0,
    gap: 4,
  },
  totalsCount: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
  },
  totalsTokens: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  totalsTokensIn: {
    color: theme.colors.usageIn,
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  totalsTokensOut: {
    color: theme.colors.usageOut,
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  totalsCost: {
    flexShrink: 0,
    color: theme.colors.usageCost,
    fontSize: 12,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[4],
  },
  more: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
    textAlign: "center",
    paddingTop: theme.spacing[2],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
  },
  // A sub-agent row: same card, inset from the left and marked with an accent
  // edge so it reads as nested under the chat row above it.
  rowIndented: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    marginLeft: theme.spacing[4],
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.borderAccent,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  rowMeta: {
    color: theme.colors.foregroundMuted,
    fontWeight: "400",
  },
  rowTokensLine: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: theme.spacing[2],
    rowGap: 2,
  },
  rowTokenSeg: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  // Cached tokens, round counts, and the separator bullets — the neutral half of
  // the token line. The tinted variants below carry the fresh-in/out figures.
  rowTokens: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  rowTokensIn: {
    color: theme.colors.usageIn,
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  rowTokensOut: {
    color: theme.colors.usageOut,
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  rowCompaction: {
    color: theme.colors.foregroundMuted,
  },
  rowRight: {
    alignItems: "flex-end",
    gap: 2,
  },
  rowCostLine: {
    flexDirection: "row",
    alignItems: "baseline",
    // Even space between the Σ rollup, its bullet, and the row's own cost,
    // matching the token line's segment spacing.
    gap: theme.spacing[2],
  },
  // The Σ token-rollup segment: same internal spacing as the token line's own
  // segments so the rollup doesn't read tighter than the row figures.
  rowTreeSeg: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: theme.spacing[2],
  },
  // Whole-tree rollup figures (Σ tokens / Σ cost) on a parent chat row — muted
  // and tabular so they read as a summary beside the row's own numbers.
  rowTreeTotal: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  // Tinted rollup figures: same weight/size as `rowTreeTotal`, hued to match the
  // row's own in/out/cost figures so a parent row's Σ reads as the same columns.
  rowTreeTotalIn: {
    color: theme.colors.usageIn,
    fontSize: 12,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  rowTreeTotalOut: {
    color: theme.colors.usageOut,
    fontSize: 12,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  rowTreeTotalCost: {
    color: theme.colors.usageCost,
    fontSize: 12,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  rowCost: {
    color: theme.colors.usageCost,
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  rowCostMuted: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  rowAge: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
}));
