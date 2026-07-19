import { describe, expect, it } from "vitest";
import type { UsageEvent } from "@otto-code/protocol/messages";
import {
  computeParentRowTotals,
  computeSubagentRowDepths,
  computeUsageRowStamps,
  formatUsageEventStamp,
  groupUsageRowsByParent,
  USAGE_STAMP_REPEAT,
  startOfLocalDay,
  usageDayHeaderLabel,
  usageWindowRange,
  type UsageLogWindow,
} from "./usage-format";

// A fixed "now": 2026-07-18 (a Saturday) at 15:30 local time. All expectations
// below are relative to this, so the test is deterministic regardless of when it
// runs. Local-time math is intentional (the log groups by the viewer's calendar).
const now = new Date(2026, 6, 18, 15, 30, 0).getTime();
const dayMs = 24 * 60 * 60 * 1000;
const startToday = startOfLocalDay(now);

describe("usageWindowRange", () => {
  it("bounds 'today' from local midnight to now-and-beyond", () => {
    const { start, end } = usageWindowRange("today", now);
    expect(start).toBe(startToday);
    expect(end).toBe(Infinity);
  });

  it("bounds 'yesterday' to the prior calendar day only", () => {
    const { start, end } = usageWindowRange("yesterday", now);
    expect(start).toBe(startToday - dayMs);
    expect(end).toBe(startToday);
  });

  it("includes today in the rolling 7- and 30-day windows", () => {
    expect(usageWindowRange("last7Days", now).start).toBe(startToday - 6 * dayMs);
    expect(usageWindowRange("last30Days", now).start).toBe(startToday - 29 * dayMs);
  });

  it("leaves 'allTime' unbounded below", () => {
    const { start, end } = usageWindowRange("allTime", now);
    expect(start).toBe(Number.NEGATIVE_INFINITY);
    expect(end).toBe(Infinity);
  });

  it.each<[UsageLogWindow, number]>([
    ["today", startToday + 1000],
    ["yesterday", startToday - dayMs + 1000],
    ["last7Days", startToday - 3 * dayMs],
    ["last30Days", startToday - 20 * dayMs],
  ])("keeps a matching row inside the %s window", (window, at) => {
    const { start, end } = usageWindowRange(window, now);
    expect(at >= start && at < end).toBe(true);
  });
});

describe("usageDayHeaderLabel", () => {
  it("labels the current and prior day relatively", () => {
    expect(usageDayHeaderLabel(now, now)).toBe("Today");
    expect(usageDayHeaderLabel(startToday - 1000, now)).toBe("Yesterday");
  });

  it("labels older days with weekday + month + day, no year in-year", () => {
    // 2026-07-13 is a Monday.
    expect(usageDayHeaderLabel(new Date(2026, 6, 13, 9, 0, 0).getTime(), now)).toBe("Mon, Jul 13");
  });

  it("appends the year for a different calendar year", () => {
    // 2025-12-31 is a Wednesday.
    expect(usageDayHeaderLabel(new Date(2025, 11, 31, 9, 0, 0).getTime(), now)).toBe(
      "Wed, Dec 31, 2025",
    );
  });
});

describe("formatUsageEventStamp", () => {
  // The gutter never prints a date — the day header above the group owns it.
  // Assert the shape (h:mm with an optional meridiem) rather than a literal, so
  // the test holds under both 12h and 24h runtime locales.
  const CLOCK = /^\d{1,2}:\d{2}(\s?[AaPp]\.?[Mm]\.?)?$/;

  it("shows clock time for today's rows by default", () => {
    const stamp = formatUsageEventStamp(new Date(2026, 6, 18, 9, 5, 0).getTime(), now, "absolute");
    expect(stamp).toMatch(CLOCK);
  });

  it("shows elapsed time for today's rows when the viewer prefers relative", () => {
    expect(formatUsageEventStamp(now - 30_000, now, "relative")).toBe("now");
    expect(formatUsageEventStamp(now - 5 * 60_000, now, "relative")).toBe("5m");
    expect(formatUsageEventStamp(now - 3 * 60 * 60_000, now, "relative")).toBe("3h");
  });

  it("falls back to clock time on past days, where elapsed says nothing new", () => {
    // "5d" would only repeat what the day header already states; the pairing of
    // header date + row time is what makes a past row readable.
    const yesterday = new Date(2026, 6, 17, 14, 20, 0).getTime();
    expect(formatUsageEventStamp(yesterday, now, "relative")).toMatch(CLOCK);
    expect(formatUsageEventStamp(yesterday, now, "absolute")).toMatch(CLOCK);
  });
});

describe("computeUsageRowStamps", () => {
  function at(hour: number, minute: number, second = 0): UsageEvent {
    return {
      id: `${hour}:${minute}:${second}`,
      at: new Date(2026, 6, 18, hour, minute, second).getTime(),
      kind: "chat",
      provider: "claude",
      tokensIn: 0,
      tokensOut: 0,
      costMicroUsd: 0,
    };
  }

  it("anchors a same-time run's label on its LAST row, where the minute began", () => {
    // Rows render newest-first, so this is a turn at 9:05:41 with two sub-agents
    // that settled earlier in the same minute, then an older turn at 9:03. The
    // 9:05 label belongs on the bottom of that run — the moment it started.
    const stamps = computeUsageRowStamps(
      [at(9, 5, 41), at(9, 5, 12), at(9, 5, 0), at(9, 3, 0)],
      now,
      "absolute",
    );
    expect(stamps[0]).toBe(USAGE_STAMP_REPEAT);
    expect(stamps[1]).toBe(USAGE_STAMP_REPEAT);
    expect(stamps[2]).not.toBe(USAGE_STAMP_REPEAT);
    expect(stamps[3]).not.toBe(USAGE_STAMP_REPEAT);
    expect(stamps[3]).not.toBe(stamps[2]);
  });

  it("always labels the last row, which has nothing below to defer to", () => {
    const stamps = computeUsageRowStamps([at(9, 9), at(9, 5)], now, "absolute");
    expect(stamps.every((stamp) => stamp !== USAGE_STAMP_REPEAT)).toBe(true);
  });

  it("re-stamps when the time returns to a value seen further up", () => {
    // Dedupe is against the adjacent row, not everything seen — spawn-tree order
    // can revisit a minute, and that run needs its own label.
    const stamps = computeUsageRowStamps([at(9, 5), at(9, 9), at(9, 5)], now, "absolute");
    expect(stamps[0]).not.toBe(USAGE_STAMP_REPEAT);
    expect(stamps[0]).toBe(stamps[2]);
  });

  it("dedupes relative labels too, which repeat far more often", () => {
    const stamps = computeUsageRowStamps(
      [
        { ...at(0, 0), at: now - 60_000 },
        { ...at(0, 1), at: now - 90_000 },
      ],
      now,
      "relative",
    );
    expect(stamps).toEqual([USAGE_STAMP_REPEAT, "1m"]);
  });
});

describe("groupUsageRowsByParent", () => {
  function row(id: string, over: Partial<UsageEvent> = {}): UsageEvent {
    return {
      id,
      at: 0,
      kind: "chat",
      provider: "claude",
      tokensIn: 0,
      tokensOut: 0,
      costMicroUsd: 0,
      ...over,
    };
  }

  it("clusters each chat's rows together with its sub-agents, newest cluster first", () => {
    // Input is newest-first: chat B's turn, then chat A's turn, then A's two
    // sub-agents (which settled during A's turn, so they're older than A's row),
    // with a standalone generation interleaved by time.
    const events = [
      row("b-chat", { kind: "chat", agentId: "chat-b", at: 100 }),
      row("a-chat", { kind: "chat", agentId: "chat-a", at: 90 }),
      row("gen", { kind: "generation", at: 85 }), // no agentId → its own cluster
      row("a-sub-2", { kind: "subagent", agentId: "chat-a", at: 84 }),
      row("a-sub-1", { kind: "subagent", agentId: "chat-a", at: 83 }),
    ];

    const ordered = groupUsageRowsByParent(events).map((e) => e.id);
    // B's cluster stays first (newest), then A's whole cluster (chat + its subs
    // pulled up under it), then the standalone generation cluster.
    expect(ordered).toEqual(["b-chat", "a-chat", "a-sub-2", "a-sub-1", "gen"]);
  });

  it("groups a fan-out under its SPAWN turn as a tree, not by settle time", () => {
    // The real failure this fixes: a turn (at=50) spawned two middle agents
    // (startedAt 40/42), each of which spawned a child (startedAt 60/61, i.e.
    // after the spawn turn was already booked). Everything settled while the
    // NEXT turn (at=100) was underway, so settle-time adjacency scattered the
    // family across two turns. Expected: the whole tree under the spawn turn —
    // middle A, its child, middle B, its child, in launch order.
    const events = [
      row("turn-2", { kind: "chat", agentId: "chat-a", at: 100 }),
      row("middle-a", {
        kind: "subagent",
        agentId: "chat-a",
        at: 95,
        startedAt: 40,
        subagentKey: "K-A",
      }),
      row("child-of-a", {
        kind: "subagent",
        agentId: "chat-a",
        at: 94,
        startedAt: 60,
        subagentKey: "K-AC",
        parentSubagentKey: "K-A",
      }),
      row("middle-b", {
        kind: "subagent",
        agentId: "chat-a",
        at: 93,
        startedAt: 42,
        subagentKey: "K-B",
      }),
      row("child-of-b", {
        kind: "subagent",
        agentId: "chat-a",
        at: 92,
        startedAt: 61,
        subagentKey: "K-BC",
        parentSubagentKey: "K-B",
      }),
      row("turn-1", { kind: "chat", agentId: "chat-a", at: 50 }),
    ];

    const ordered = groupUsageRowsByParent(events).map((e) => e.id);
    expect(ordered).toEqual([
      "turn-2",
      "turn-1",
      "middle-a",
      "child-of-a",
      "middle-b",
      "child-of-b",
    ]);

    // And the rollup lands on the spawn turn (nearest preceding chat row in the
    // grouped order), covering the entire family.
    const totals = computeParentRowTotals(groupUsageRowsByParent(events));
    expect(totals.has("turn-2")).toBe(false);
    expect(totals.has("turn-1")).toBe(true);
  });

  it("hangs a sub-agent spawned after the last booked turn off the newest turn", () => {
    const events = [
      row("turn-1", { kind: "chat", agentId: "chat-a", at: 50 }),
      row("late-sub", {
        kind: "subagent",
        agentId: "chat-a",
        at: 40,
        startedAt: 80,
        subagentKey: "K-L",
      }),
    ];
    expect(groupUsageRowsByParent(events).map((e) => e.id)).toEqual(["turn-1", "late-sub"]);
  });

  it("computes spawn-tree depths from parent links", () => {
    const events = [
      row("middle", { kind: "subagent", subagentKey: "K-M", agentId: "chat-a", at: 3 }),
      row("child", {
        kind: "subagent",
        subagentKey: "K-C",
        parentSubagentKey: "K-M",
        agentId: "chat-a",
        at: 2,
      }),
      row("grandchild", {
        kind: "subagent",
        subagentKey: "K-G",
        parentSubagentKey: "K-C",
        agentId: "chat-a",
        at: 1,
      }),
      row("legacy", { kind: "subagent", agentId: "chat-a", at: 0 }),
    ];
    const depths = computeSubagentRowDepths(events);
    expect(depths.get("middle")).toBe(1);
    expect(depths.get("child")).toBe(2);
    expect(depths.get("grandchild")).toBe(3);
    expect(depths.get("legacy")).toBe(1);
  });

  it("returns the same rows (pure re-ordering, none dropped or added)", () => {
    const events = [
      row("x", { agentId: "chat-a", at: 3 }),
      row("y", { agentId: "chat-b", at: 2 }),
      row("z", { kind: "subagent", agentId: "chat-a", at: 1 }),
    ];
    const ordered = groupUsageRowsByParent(events);
    expect(ordered).toHaveLength(3);
    expect(new Set(ordered.map((e) => e.id))).toEqual(new Set(["x", "y", "z"]));
    // chat-a's sub is pulled up under chat-a, ahead of chat-b.
    expect(ordered.map((e) => e.id)).toEqual(["x", "z", "y"]);
  });
});

describe("computeParentRowTotals", () => {
  function row(id: string, over: Partial<UsageEvent> = {}): UsageEvent {
    return {
      id,
      at: 0,
      kind: "chat",
      provider: "claude",
      tokensIn: 0,
      tokensOut: 0,
      costMicroUsd: 0,
      ...over,
    };
  }

  it("rolls a turn's sub-agents (any depth, all flattened to the chat's agentId) into its row", () => {
    // Grouped newest-first order: the chat turn heads its cluster, its
    // sub-agents follow. Nested sub-agents also carry the owning chat's
    // agentId, so they land in the same run and the same rollup. tokensIn is
    // the grand "in" total; cachedTokensIn is the cache-read slice of it, so
    // fresh = tokensIn − cached per row, summed.
    const ordered = [
      row("turn", {
        agentId: "chat-a",
        tokensIn: 100,
        cachedTokensIn: 70,
        tokensOut: 10,
        costMicroUsd: 500,
      }),
      row("sub-1", {
        kind: "subagent",
        agentId: "chat-a",
        tokensIn: 40,
        cachedTokensIn: 25,
        tokensOut: 4,
        costMicroUsd: 200,
      }),
      row("sub-of-sub", {
        kind: "subagent",
        agentId: "chat-a",
        tokensIn: 20,
        tokensOut: 2,
        costMicroUsd: 100,
      }),
    ];
    const totals = computeParentRowTotals(ordered);
    expect(totals.get("turn")).toEqual({ fresh: 65, cached: 95, out: 16, costMicroUsd: 800 });
    // Sub-agent rows themselves get no rollup — only parent rows carry it.
    expect(totals.has("sub-1")).toBe(false);
    expect(totals.has("sub-of-sub")).toBe(false);
  });

  it("attributes each sub-agent to the nearest preceding turn of its own chat", () => {
    // Two turns of the same chat, each with one sub-agent, plus an interleaved
    // cluster of another chat with no sub-agents.
    const ordered = [
      row("a-turn-2", { agentId: "chat-a", tokensIn: 10, tokensOut: 1, costMicroUsd: 30 }),
      row("a-sub-2", {
        kind: "subagent",
        agentId: "chat-a",
        tokensIn: 5,
        tokensOut: 1,
        costMicroUsd: 20,
      }),
      row("b-turn", { agentId: "chat-b", tokensIn: 7, tokensOut: 2, costMicroUsd: 40 }),
      row("a-turn-1", { agentId: "chat-a", tokensIn: 20, tokensOut: 2, costMicroUsd: 60 }),
      row("a-sub-1", {
        kind: "subagent",
        agentId: "chat-a",
        tokensIn: 8,
        tokensOut: 2,
        costMicroUsd: 10,
      }),
    ];
    const totals = computeParentRowTotals(ordered);
    // No cachedTokensIn on these rows → everything reads as fresh.
    expect(totals.get("a-turn-2")).toEqual({ fresh: 15, cached: 0, out: 2, costMicroUsd: 50 });
    expect(totals.get("a-turn-1")).toEqual({ fresh: 28, cached: 0, out: 4, costMicroUsd: 70 });
    // A turn with no sub-agents gets no rollup (its row already says it all).
    expect(totals.has("b-turn")).toBe(false);
  });

  it("skips sub-agents whose parent turn row is not in the list", () => {
    // The parent turn fell outside the loaded page/range: nothing to annotate.
    const totals = computeParentRowTotals([
      row("orphan-sub", {
        kind: "subagent",
        agentId: "chat-a",
        tokensIn: 5,
        tokensOut: 1,
        costMicroUsd: 20,
      }),
    ]);
    expect(totals.size).toBe(0);
  });
});
