import type { UsageEvent } from "@otto-code/protocol/messages";
import { formatTokenCount } from "@/components/context-window-meter.utils";
import { formatClockTime } from "@/utils/time";

// Cluster ledger rows by the chat they belong to (agentId) so a chat's own turns
// and its sub-agents render as one block instead of interleaving with other
// chats' rows by raw timestamp; then, within a cluster, arrange sub-agent rows
// as the SPAWN TREE a human expects: each sub-agent under the chat turn that
// spawned it (via `startedAt` — async sub-agents routinely SETTLE turns later,
// so settle-time adjacency scatters a single fan-out across turns), and each
// nested sub-agent directly under its spawning sub-agent (via
// `parentSubagentKey`). Rows predating those fields keep the old adjacency
// behavior. Clusters themselves stay newest-first (first appearance = newest,
// since the input is already sorted); a row with no agentId is its own
// singleton. Pure re-ordering — the same rows come back, so day grouping and
// totals are unaffected. See [[subagent-real-accounting]] (block 6).
export function groupUsageRowsByParent(events: UsageEvent[]): UsageEvent[] {
  const order: string[] = [];
  const buckets = new Map<string, UsageEvent[]>();
  for (const event of events) {
    const key = event.agentId ?? `row:${event.id}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
      order.push(key);
    }
    bucket.push(event);
  }
  return order.flatMap((key) => orderClusterAsSpawnTree(buckets.get(key) ?? []));
}

/**
 * Arrange one chat cluster (newest-first rows) as its spawn tree: non-sub-agent
 * rows keep their order; each chat row is followed by the sub-agents it spawned
 * (oldest spawn first — the order the fan-out was launched), each of those
 * followed by its own children, recursively.
 */
function orderClusterAsSpawnTree(rows: UsageEvent[]): UsageEvent[] {
  const subs = rows.filter((row) => row.kind === "subagent");
  if (subs.length === 0) {
    return rows;
  }
  const nonSubs = rows.filter((row) => row.kind !== "subagent");
  const { subByKey, childrenByKey, roots } = indexSubagentTree(subs);
  const resolveOwnerId = makeOwnerResolver(rows, subByKey);

  const rootsByOwner = new Map<string | null, UsageEvent[]>();
  for (const root of roots) {
    const owner = resolveOwnerId(root, new Set());
    const group = rootsByOwner.get(owner) ?? [];
    group.push(root);
    rootsByOwner.set(owner, group);
  }

  // Two rows can share one subagentKey (a continued stream books a second row);
  // emit a key's children once, after its first-emitted row.
  const emittedChildrenOf = new Set<string>();
  const emitTree = (row: UsageEvent, out: UsageEvent[]): void => {
    out.push(row);
    if (!row.subagentKey || emittedChildrenOf.has(row.subagentKey)) {
      return;
    }
    emittedChildrenOf.add(row.subagentKey);
    for (const child of [...(childrenByKey.get(row.subagentKey) ?? [])].sort(spawnOrder)) {
      emitTree(child, out);
    }
  };

  const out: UsageEvent[] = [];
  // Sub-agents with no owning turn in the cluster (no chat rows at all) lead,
  // keeping their input order.
  for (const root of rootsByOwner.get(null) ?? []) {
    emitTree(root, out);
  }
  for (const row of nonSubs) {
    out.push(row);
    if (row.kind === "chat") {
      for (const root of [...(rootsByOwner.get(row.id) ?? [])].sort(spawnOrder)) {
        emitTree(root, out);
      }
    }
  }
  return out;
}

// Oldest spawn first (launch order). Rows without startedAt (older daemons)
// sort equal, so the stable sort keeps their input order intact.
function spawnOrder(a: UsageEvent, b: UsageEvent): number {
  return (a.startedAt ?? Number.MAX_SAFE_INTEGER) - (b.startedAt ?? Number.MAX_SAFE_INTEGER);
}

/** Parent/child edges among the cluster's sub-agent rows: key → first row
 * carrying it, key → children, and the roots (no in-cluster parent). */
function indexSubagentTree(subs: UsageEvent[]): {
  subByKey: Map<string, UsageEvent>;
  childrenByKey: Map<string, UsageEvent[]>;
  roots: UsageEvent[];
} {
  const subByKey = new Map<string, UsageEvent>();
  for (const sub of subs) {
    if (sub.subagentKey && !subByKey.has(sub.subagentKey)) {
      subByKey.set(sub.subagentKey, sub);
    }
  }
  const childrenByKey = new Map<string, UsageEvent[]>();
  const roots: UsageEvent[] = [];
  for (const sub of subs) {
    const parentKey = sub.parentSubagentKey;
    const parent = parentKey ? subByKey.get(parentKey) : undefined;
    if (parentKey && parent && parent.id !== sub.id) {
      const siblings = childrenByKey.get(parentKey) ?? [];
      siblings.push(sub);
      childrenByKey.set(parentKey, siblings);
    } else {
      roots.push(sub);
    }
  }
  return { subByKey, childrenByKey, roots };
}

/**
 * Which chat turn row owns a sub-agent row: the first turn that ended at or
 * after its spawn (`startedAt`; turn rows are booked at turn end), falling back
 * to the newest turn when the spawning turn isn't booked yet. A child follows
 * its parent sub-agent wherever THAT landed, so a family never splits across
 * turns. Rows predating `startedAt` attach to the chat row directly above them
 * in the newest-first list (the old behavior). Cycle-guarded and memoized.
 */
function makeOwnerResolver(
  rows: UsageEvent[],
  subByKey: Map<string, UsageEvent>,
): (row: UsageEvent, chain: Set<string>) => string | null {
  const chatsOldestFirst = rows.filter((row) => row.kind === "chat").toReversed();
  const legacyOwnerId = new Map<string, string>();
  {
    let lastChatId: string | undefined;
    for (const row of rows) {
      if (row.kind === "chat") {
        lastChatId = row.id;
      } else if (row.kind === "subagent" && row.startedAt === undefined && lastChatId) {
        legacyOwnerId.set(row.id, lastChatId);
      }
    }
  }
  const directOwnerId = (row: UsageEvent): string | null => {
    if (row.startedAt === undefined) {
      return legacyOwnerId.get(row.id) ?? null;
    }
    for (const chat of chatsOldestFirst) {
      if (chat.at >= row.startedAt) {
        return chat.id;
      }
    }
    const newest = chatsOldestFirst[chatsOldestFirst.length - 1];
    return newest ? newest.id : null;
  };
  const ownerMemo = new Map<string, string | null>();
  const resolveOwnerId = (row: UsageEvent, chain: Set<string>): string | null => {
    const memoized = ownerMemo.get(row.id);
    if (memoized !== undefined) {
      return memoized;
    }
    let owner: string | null = null;
    const parent =
      row.parentSubagentKey && !chain.has(row.id) ? subByKey.get(row.parentSubagentKey) : undefined;
    if (parent && parent.id !== row.id) {
      chain.add(row.id);
      owner = resolveOwnerId(parent, chain);
    } else {
      owner = directOwnerId(row);
    }
    ownerMemo.set(row.id, owner);
    return owner;
  };
  return resolveOwnerId;
}

/**
 * Nesting depth for each sub-agent row (row id → depth): 1 for a sub-agent
 * spawned by the chat itself, 2 for a sub-agent's sub-agent, and so on —
 * following `parentSubagentKey` links to rows actually present in the list.
 * Rows without tree fields (older daemons) read as depth 1. Cycle-guarded.
 */
export function computeSubagentRowDepths(events: UsageEvent[]): Map<string, number> {
  const byKey = new Map<string, UsageEvent>();
  for (const event of events) {
    if (event.kind === "subagent" && event.subagentKey && !byKey.has(event.subagentKey)) {
      byKey.set(event.subagentKey, event);
    }
  }
  const depths = new Map<string, number>();
  const depthOf = (event: UsageEvent, chain: Set<string>): number => {
    const memoized = depths.get(event.id);
    if (memoized !== undefined) {
      return memoized;
    }
    let depth = 1;
    const parent =
      event.parentSubagentKey && !chain.has(event.id)
        ? byKey.get(event.parentSubagentKey)
        : undefined;
    if (parent && parent.id !== event.id) {
      chain.add(event.id);
      depth = depthOf(parent, chain) + 1;
    }
    depths.set(event.id, depth);
    return depth;
  };
  for (const event of events) {
    if (event.kind === "subagent") {
      depthOf(event, new Set());
    }
  }
  return depths;
}

/**
 * Whole-tree rollup for a chat row that has sub-agent children in the log,
 * split the same fresh/cached/out way as the rows themselves — a flat token
 * total would bury the cache-read share, which is billed at a fraction of
 * fresh input and can dwarf it.
 */
export interface UsageParentTotals {
  /** Fresh (full-rate) input tokens of the turn plus all its sub-agents. */
  fresh: number;
  /** Cache-read input tokens of the turn plus all its sub-agents. */
  cached: number;
  /** Output tokens of the turn plus all its sub-agents. */
  out: number;
  /** Summed spend of the turn plus all its sub-agents, integer micro-USD. */
  costMicroUsd: number;
}

function addEventToParentTotals(entry: UsageParentTotals, event: UsageEvent): void {
  const cached = event.cachedTokensIn ?? 0;
  entry.fresh += Math.max(0, event.tokensIn - cached);
  entry.cached += cached;
  entry.out += event.tokensOut;
  entry.costMicroUsd += event.costMicroUsd;
}

// Whole-tree totals for the chat rows that own sub-agent rows. Takes the
// ALREADY-GROUPED order from groupUsageRowsByParent (cluster-contiguous,
// newest-first) and attributes each sub-agent row to the nearest preceding chat
// row with the same agentId — the same relationship the indented nesting shows,
// since a sub-agent settles during its parent turn. Nested sub-agents (subs of
// subs, any depth) all carry the OWNING chat's agentId, so they roll up into the
// same parent turn without any tree walk. Returns totals keyed by the parent
// row's id, only for chat rows with at least one attributed sub-agent; the
// totals include the parent row's own figures. A sub-agent whose parent turn row
// isn't in the list (outside the range/page) attributes nowhere.
export function computeParentRowTotals(
  orderedEvents: UsageEvent[],
): Map<string, UsageParentTotals> {
  const totals = new Map<string, UsageParentTotals>();
  const lastChatRowIdByAgent = new Map<string, string>();
  const parentSelf = new Map<string, UsageParentTotals>();
  for (const event of orderedEvents) {
    if (event.agentId === undefined) continue;
    if (event.kind === "subagent") {
      const parentId = lastChatRowIdByAgent.get(event.agentId);
      if (parentId === undefined) continue;
      let entry = totals.get(parentId);
      if (!entry) {
        const self = parentSelf.get(parentId) ?? { fresh: 0, cached: 0, out: 0, costMicroUsd: 0 };
        entry = { ...self };
        totals.set(parentId, entry);
      }
      addEventToParentTotals(entry, event);
    } else if (event.kind === "chat") {
      lastChatRowIdByAgent.set(event.agentId, event.id);
      const self: UsageParentTotals = { fresh: 0, cached: 0, out: 0, costMicroUsd: 0 };
      addEventToParentTotals(self, event);
      parentSelf.set(event.id, self);
    }
  }
  return totals;
}

/** Integer micro-USD → a compact price string ($0 / <$0.01 / $1.23 / $1.2k). */
export function formatMicroUsd(microUsd: number): string {
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

/** Human label for a usage ledger row's `kind` (unknown kinds title-cased). */
export function usageKindLabel(kind: string): string {
  switch (kind) {
    case "chat":
      return "Chat";
    case "subagent":
      return "Sub-agent";
    case "generation":
      return "Generation";
    case "compaction":
      return "Compaction";
    default:
      return kind.length > 0 ? kind.charAt(0).toUpperCase() + kind.slice(1) : "Activity";
  }
}

/**
 * The Metrics time-range windows, shared with the Summary tab's rollups
 * (`keyof ActivityStatsRollups`). Kept as a standalone union here so the log's
 * client-side range filter doesn't couple to the activity-stats hook.
 */
export type UsageLogWindow = "today" | "yesterday" | "last7Days" | "last30Days" | "allTime";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Local midnight (epoch ms) for the calendar day containing `atMs`. */
export function startOfLocalDay(atMs: number): number {
  const d = new Date(atMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Half-open epoch-ms range `[start, end)` for a Metrics window, so the log can
 * filter its rows the same way the Summary tab buckets counters. "today" and the
 * rolling windows run up to now (`end: Infinity`); "yesterday" is a bounded day.
 */
export function usageWindowRange(
  window: UsageLogWindow,
  nowMs: number,
): { start: number; end: number } {
  const startToday = startOfLocalDay(nowMs);
  switch (window) {
    case "today":
      return { start: startToday, end: Infinity };
    case "yesterday":
      return { start: startToday - DAY_MS, end: startToday };
    case "last7Days":
      return { start: startToday - 6 * DAY_MS, end: Infinity };
    case "last30Days":
      return { start: startToday - 29 * DAY_MS, end: Infinity };
    case "allTime":
      return { start: Number.NEGATIVE_INFINITY, end: Infinity };
  }
}

/** Stable per-day key (local midnight) for grouping ledger rows. */
export function usageDayKey(atMs: number): number {
  return startOfLocalDay(atMs);
}

/**
 * Day-header label for a group of ledger rows: "Today" / "Yesterday" for the two
 * most recent days, otherwise "Wed, Jul 16" (with the year appended when it isn't
 * the current one). Manual formatting avoids Intl gaps on older native runtimes.
 */
export function usageDayHeaderLabel(atMs: number, nowMs: number): string {
  const startEvent = startOfLocalDay(atMs);
  const startToday = startOfLocalDay(nowMs);
  if (startEvent === startToday) return "Today";
  if (startEvent === startToday - DAY_MS) return "Yesterday";
  const d = new Date(atMs);
  const base = `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === new Date(nowMs).getFullYear() ? base : `${base}, ${d.getFullYear()}`;
}

/**
 * How a ledger row's left-gutter timestamp reads for rows recent enough that
 * elapsed time is the more useful answer. Mirrors the `chatTimestampDisplay`
 * appearance setting, which drives both surfaces.
 */
export type UsageTimestampDisplay = "absolute" | "relative";

/**
 * The left-gutter timestamp for a ledger row. The day header above the group
 * already answers "which day", so the gutter never repeats it — it answers
 * "when within that day": clock time ("3:42 PM").
 *
 * Today's rows are the exception: when the viewer prefers relative timestamps
 * they read as elapsed instead ("3m", "2h"), which is what you want while work
 * is still landing. Past days always take clock time — "5d" says nothing the day
 * header hasn't already said, and pairing it with the header gives the
 * date-and-time reading without printing the date on every row.
 */
export function formatUsageEventStamp(
  atMs: number,
  nowMs: number,
  display: UsageTimestampDisplay,
): string {
  if (display === "relative" && startOfLocalDay(atMs) === startOfLocalDay(nowMs)) {
    return formatUsageEventAge(atMs, nowMs);
  }
  return formatClockTime(new Date(atMs));
}

/**
 * Stands in for a gutter timestamp already carried by a neighbouring row.
 * Repeating "3:42 PM" down a burst of rows is noise — the column should only
 * ever mark where time actually moved.
 */
export const USAGE_STAMP_REPEAT = "-";

/**
 * Gutter labels for a run of ledger rows, in the order they render. Rows sharing
 * a stamp collapse to a single label on the LAST of them, every row above it
 * showing {@link USAGE_STAMP_REPEAT}.
 *
 * Last, not first, because the list runs newest-first: reading down the column
 * walks backwards in time, so the bottom row of a same-minute run is where that
 * minute *began*. Labelling the top row would date the block by its final event
 * and leave the moment it actually started unmarked.
 *
 * Takes the ALREADY-ORDERED rows (spawn-tree order, not raw time) — the
 * comparison that matters is with the row physically below. Callers pass one day
 * group at a time, so a group's last row always keeps its stamp.
 */
export function computeUsageRowStamps(
  orderedEvents: UsageEvent[],
  nowMs: number,
  display: UsageTimestampDisplay,
): string[] {
  const stamps = orderedEvents.map((event) => formatUsageEventStamp(event.at, nowMs, display));
  return stamps.map((stamp, index) => (stamp === stamps[index + 1] ? USAGE_STAMP_REPEAT : stamp));
}

/** Short relative time for a ledger row's `at` (epoch ms), e.g. "3m", "2h", "5d". */
export function formatUsageEventAge(atMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - atMs) / 1000));
  if (seconds < 60) {
    return "now";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
