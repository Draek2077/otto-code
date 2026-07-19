import { describe, expect, it } from "vitest";
import type { UsageEvent } from "@otto-code/protocol/messages";
import {
  computeParentRowTotals,
  groupUsageRowsByParent,
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
