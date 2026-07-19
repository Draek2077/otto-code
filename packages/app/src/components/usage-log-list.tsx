import { useEffect, useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { UsageEvent } from "@otto-code/protocol/messages";
import type { Theme } from "@/styles/theme";
import { formatTokenCount } from "@/components/context-window-meter.utils";
import {
  computeParentRowTotals,
  computeSubagentRowDepths,
  computeUsageRowStamps,
  formatMicroUsd,
  groupUsageRowsByParent,
  USAGE_STAMP_REPEAT,
  usageDayHeaderLabel,
  usageDayKey,
  usageKindLabel,
  usageWindowRange,
  type UsageLogWindow,
  type UsageParentTotals,
} from "@/components/usage-format";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useAppSettings } from "@/hooks/use-settings";
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

// The "when" gutter that leads every ledger row, sized to hold the widest label
// it renders ("12:34 PM"). It sits OUTSIDE the row cards — sub-agent rows indent
// within the remaining width — so the timestamps stay one straight column no
// matter how deep the spawn tree goes. The day header pads by the same amount so
// its text lines up with the row content beside it.
//
// Narrower on compact, where every pixel the gutter takes comes straight out of
// the card. The xs/md split matches useIsCompactFormFactor (xs+sm are compact),
// so the gutter and the row layout switch at the same width.
const TIME_COLUMN_XS = 40;
const TIME_COLUMN_MD = 56;
const TIME_COLUMN_WIDTH = { xs: TIME_COLUMN_XS, md: TIME_COLUMN_MD } as const;

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
// inside the host panel's ScrollView without nested-scroll conflicts;
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
  // Shared with chat message timestamps (Appearance → Time format): clock time,
  // or elapsed for rows recent enough that "how long ago" is the better answer.
  const timestampDisplay = useAppSettings().settings.chatTimestampDisplay;
  // Read once here rather than per row — hundreds of rows each subscribing to
  // the breakpoint would be a lot of listeners for one shared answer.
  const isCompact = useIsCompactFormFactor();
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
        const depths = computeSubagentRowDepths(ordered);
        // Per group, so each day's oldest row keeps a real stamp (the labels
        // anchor to the bottom of a same-time run — see computeUsageRowStamps).
        const stamps = computeUsageRowStamps(ordered, now, timestampDisplay);
        return (
          <View key={group.key} style={styles.dayGroup}>
            <Text style={styles.dayHeader}>{group.label}</Text>
            {ordered.map((event, index) => (
              <UsageLogRow
                key={event.id}
                event={event}
                stamp={stamps[index] ?? ""}
                isCompact={isCompact}
                treeTotals={parentTotals.get(event.id)}
                depth={depths.get(event.id)}
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
  stamp,
  isCompact,
  treeTotals,
  depth,
}: {
  event: UsageEvent;
  /**
   * The gutter label, already deduped against the row below (see
   * computeUsageRowStamps) — so this row may render the repeat marker instead of
   * its own time.
   */
  stamp: string;
  /** Stack the card into full-width lines instead of icon | main | cost. */
  isCompact: boolean;
  /**
   * Whole-tree rollup (this turn + all its sub-agents, any nesting depth) —
   * present only on a chat row that owns sub-agent rows below it.
   */
  treeTotals?: UsageParentTotals;
  /** Spawn-tree nesting for sub-agent rows: 1 = spawned by the chat, 2+ = a
   * sub-agent's sub-agent. Absent on non-sub-agent rows. */
  depth?: number;
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
  // Sub-agent rows indent under the chat turn that spawned them; a sub-agent's
  // own sub-agents indent one level further (visual depth caps at 2 so deep
  // trees stay readable on narrow screens).
  const isSub = event.kind === "subagent";
  const isDeep = isSub && (depth ?? 1) >= 2;
  const cardStyle = useMemo(
    () => [
      styles.card,
      isCompact && styles.cardCompact,
      isSub && styles.cardSub,
      isDeep && styles.cardSubDeep,
    ],
    [isCompact, isSub, isDeep],
  );
  const title = (
    <Text style={styles.rowTitle} numberOfLines={1}>
      {usageKindLabel(event.kind)}
      {meta ? <Text style={styles.rowMeta}>{`  ${meta}`}</Text> : null}
    </Text>
  );

  const tokensLine = (
    <RowTokens event={event} inlineTreeTotals={isCompact ? undefined : treeTotals} />
  );

  const cost = (
    <Text style={hasCost ? styles.rowCost : styles.rowCostMuted}>
      {hasCost ? formatMicroUsd(event.costMicroUsd) : "—"}
    </Text>
  );
  // Hidden when the tree cost is all zeros (token-only providers).
  const treeCost =
    treeTotals && treeTotals.costMicroUsd > 0 ? (
      <Text style={styles.rowTreeTotalCost}>{`Σ ${formatMicroUsd(treeTotals.costMicroUsd)}`}</Text>
    ) : null;

  return (
    <View style={styles.rowWrap}>
      {/* The "when" column, vertically centered against the card beside it and
          outside the card's indentation so it never shifts with nesting. A
          repeat marker is dimmed so the eye skips straight to the next real
          moment in the column. */}
      <Text
        style={stamp === USAGE_STAMP_REPEAT ? styles.rowTimeRepeat : styles.rowTime}
        numberOfLines={1}
      >
        {stamp}
      </Text>
      {/* Compact stacks the card into full-width lines: [icon · title · cost],
          then the figures. Keeping the cost in a side column at this width left
          the title as "C…" and broke "↑ 35k fresh" over three lines. Wide keeps
          the side-by-side card, where the cost column costs nothing. */}
      {isCompact ? (
        <View style={cardStyle}>
          <View style={styles.rowHeader}>
            <Icon size={18} uniProps={mutedColor} />
            <View style={styles.rowHeaderTitle}>{title}</View>
            {cost}
          </View>
          {tokensLine}
          {treeTotals ? (
            <View style={styles.rowTreeLine}>
              <RowTreeTokens totals={treeTotals} />
              {treeCost}
            </View>
          ) : null}
        </View>
      ) : (
        <View style={cardStyle}>
          <Icon size={20} uniProps={mutedColor} />
          <View style={styles.rowMain}>
            {title}
            {tokensLine}
          </View>
          <View style={styles.rowCostLine}>
            {/* Whole-tree cost sits left of the row's own cost, muted so the
                per-turn figure stays the headline. The bullet between them takes
                the line's gap evenly on both sides. */}
            {treeCost}
            {treeCost ? <Text style={styles.rowTreeTotal}>·</Text> : null}
            {cost}
          </View>
        </View>
      )}
    </View>
  );
}

// A row's own token figures: fresh in, cache-read in, out, plus the round count
// and compaction slice when they apply. `inlineTreeTotals` appends the Σ
// whole-tree rollup to the same line — passed only on the wide layout, since
// compact gives the rollup a line of its own.
function RowTokens({
  event,
  inlineTreeTotals,
}: {
  event: UsageEvent;
  inlineTreeTotals?: UsageParentTotals;
}): ReactElement {
  // Split the "in" total into cache-read vs. fresh (full-rate) send. Fresh is the
  // rest of the total; on providers with no cache reads (cachedTokensIn absent)
  // the whole thing reads as fresh, which is the honest picture there.
  const cached = event.cachedTokensIn ?? 0;
  const fresh = Math.max(0, event.tokensIn - cached);
  const compaction = (event.compactionTokensIn ?? 0) + (event.compactionTokensOut ?? 0);
  return (
    <View style={styles.rowTokensLine}>
      <Text style={styles.rowTokensIn}>{`↑ ${formatTokenCount(fresh)} fresh`}</Text>
      {cached > 0 ? (
        <View style={styles.rowTokenSeg}>
          <ThemedLayers size={12} uniProps={mutedColor} />
          <Text style={styles.rowTokens}>{`${formatTokenCount(cached)} cached`}</Text>
        </View>
      ) : null}
      <Text style={styles.rowTokensOut}>{`↓ ${formatTokenCount(event.tokensOut)}`}</Text>
      {/* Round count makes a large cached figure legible: it is the same context
          re-read once per round, not a cache "size". */}
      {event.rounds && event.rounds > 1 ? (
        <Text style={styles.rowTokens}>{`· ${event.rounds} rounds`}</Text>
      ) : null}
      {compaction > 0 ? (
        <Text style={styles.rowCompaction}>{`⤶ ${formatTokenCount(compaction)} compacted`}</Text>
      ) : null}
      {/* Last, so the row's own figures stay primary. The bullet is a direct
          child of the line, so it gets the same columnGap on both sides. */}
      {inlineTreeTotals ? (
        <>
          <Text style={styles.rowTokens}>·</Text>
          <RowTreeTokens totals={inlineTreeTotals} />
        </>
      ) : null}
    </View>
  );
}

// The Σ token rollup on a parent chat row, split fresh/cached/out like the row's
// own figures — a flat sum would bury the cache-read share. Its own component so
// the row's token line stays within the JSX
// depth ceiling now that every row nests inside the time-gutter wrapper.
function RowTreeTokens({ totals }: { totals: UsageParentTotals }): ReactElement {
  return (
    <View style={styles.rowTreeSeg}>
      <Text style={styles.rowTreeTotalIn}>{`Σ ↑ ${formatTokenCount(totals.fresh)} fresh`}</Text>
      {totals.cached > 0 ? (
        <View style={styles.rowTokenSeg}>
          <ThemedLayers size={12} uniProps={mutedColor} />
          <Text style={styles.rowTreeTotal}>{`${formatTokenCount(totals.cached)} cached`}</Text>
        </View>
      ) : null}
      <Text style={styles.rowTreeTotalOut}>{`↓ ${formatTokenCount(totals.out)}`}</Text>
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
  // The date half of "when": every row below it carries only a time, so this is
  // the group's date. Padded past the time gutter to sit over the row cards.
  dayHeader: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    paddingTop: theme.spacing[1],
    paddingLeft: {
      xs: TIME_COLUMN_XS + theme.spacing[2],
      md: TIME_COLUMN_MD + theme.spacing[2],
    },
  },
  totalsBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    // Inset the cost to sit under the rows' cost column: each row is a card with
    // a 1px border + spacing[3] inner padding, so its cost is that far in from
    // the content edge. The bar has no card, so add the same inset here. No
    // matching LEFT inset — the bar summarises the whole range rather than
    // belonging to the rows' time column, and indenting it past the gutter just
    // left it hanging.
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
  // One ledger entry: the fixed time gutter, then the row card. The card grows
  // into whatever is left, so indenting a sub-agent card never moves the gutter.
  rowWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  rowTime: {
    width: TIME_COLUMN_WIDTH,
    flexShrink: 0,
    textAlign: "center",
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  // "Same time as the row above" — faded well back, since its whole job is to
  // hold the column open without competing with the stamps that carry meaning.
  rowTimeRepeat: {
    width: TIME_COLUMN_WIDTH,
    flexShrink: 0,
    textAlign: "center",
    color: theme.colors.foregroundMuted,
    opacity: 0.35,
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  // The row card. Composed rather than spelled out per variant: `cardCompact`
  // restacks it, `cardSub`/`cardSubDeep` add the nesting inset and accent edge.
  card: {
    flex: 1,
    minWidth: 0,
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
  // Compact: full-width lines instead of columns. Nothing competes for the
  // horizontal space, so titles get to be titles and figures stay on one line.
  cardCompact: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: 4,
  },
  // A sub-agent row: inset from the left and marked with an accent edge so it
  // reads as nested under the chat row above it. The inset is much smaller on
  // compact, where a 16px step per level would eat the card.
  cardSub: {
    marginLeft: { xs: theme.spacing[2], md: theme.spacing[4] },
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.borderAccent,
  },
  // A sub-agent's own sub-agent: one more inset step (depth caps at 2 visually).
  cardSubDeep: {
    marginLeft: { xs: theme.spacing[2] * 2, md: theme.spacing[4] * 2 },
  },
  // Compact line 1: icon, title, cost. The title takes the slack; the cost is
  // the only thing allowed to hold its width.
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  rowHeaderTitle: {
    flex: 1,
    minWidth: 0,
  },
  // Compact line 3: the Σ whole-tree rollup, tokens left and cost right, on its
  // own line where it reads as a summary rather than more wrapped figures.
  rowTreeLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    columnGap: theme.spacing[2],
    rowGap: 2,
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
  rowCostLine: {
    flexShrink: 0,
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
}));
