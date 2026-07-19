import type { UsageEvent } from "@otto-code/protocol/messages";
import { formatTokenCount } from "@/components/context-window-meter.utils";

// Cluster ledger rows by the chat they belong to (agentId) so a chat's own turns
// and its sub-agents render as one block — the sub-agent rows nesting under it —
// instead of interleaving with other chats' rows by raw timestamp. A sub-agent
// settles DURING its parent turn (the parent's row is newer), so keeping each
// cluster in the input's newest-first order lands the chat row above its
// sub-agents. Clusters themselves stay newest-first (first appearance = newest,
// since the input is already sorted); a row with no agentId is its own singleton.
// Pure re-ordering — the same rows come back, so day grouping and totals are
// unaffected. See [[subagent-real-accounting]] (block 6).
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
  return order.flatMap((key) => buckets.get(key) ?? []);
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
