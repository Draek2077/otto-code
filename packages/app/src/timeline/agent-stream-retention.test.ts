import { describe, expect, test } from "vitest";
import { planAgentStreamEviction } from "./agent-stream-retention";

function activity(entries: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(entries));
}

describe("agent stream retention", () => {
  test("keeps everything while under the cap", () => {
    expect(
      planAgentStreamEviction({
        bufferedAgentIds: ["a", "b", "c"],
        displayedAgentIds: new Set(),
        lastActivityAtByAgentId: activity({ a: 3, b: 2, c: 1 }),
        maxRetainedAgents: 3,
      }),
    ).toEqual([]);
  });

  test("evicts oldest activity first once over the cap", () => {
    expect(
      planAgentStreamEviction({
        bufferedAgentIds: ["a", "b", "c", "d"],
        displayedAgentIds: new Set(),
        lastActivityAtByAgentId: activity({ a: 40, b: 10, c: 30, d: 20 }),
        maxRetainedAgents: 2,
      }),
    ).toEqual(["b", "d"]);
  });

  // The invariant that keeps a background pane from blanking: a mounted
  // surface's agent is never a candidate, however old its activity is.
  test("never evicts a displayed agent", () => {
    expect(
      planAgentStreamEviction({
        bufferedAgentIds: ["a", "b", "c"],
        displayedAgentIds: new Set(["b"]),
        lastActivityAtByAgentId: activity({ a: 30, b: 1, c: 20 }),
        maxRetainedAgents: 2,
      }),
    ).toEqual(["c"]);
  });

  test("releases nothing when the displayed set alone exceeds the cap", () => {
    expect(
      planAgentStreamEviction({
        bufferedAgentIds: ["a", "b", "c"],
        displayedAgentIds: new Set(["a", "b", "c"]),
        lastActivityAtByAgentId: activity({ a: 3, b: 2, c: 1 }),
        maxRetainedAgents: 1,
      }),
    ).toEqual([]);
  });

  test("departed agents are released even under the cap", () => {
    expect(
      planAgentStreamEviction({
        bufferedAgentIds: ["a", "b", "c"],
        displayedAgentIds: new Set(),
        departedAgentIds: new Set(["b"]),
        lastActivityAtByAgentId: activity({ a: 3, b: 99, c: 1 }),
        maxRetainedAgents: 10,
      }),
    ).toEqual(["b"]);
  });

  test("a departed agent still on screen is kept until it is unmounted", () => {
    expect(
      planAgentStreamEviction({
        bufferedAgentIds: ["a", "b"],
        displayedAgentIds: new Set(["b"]),
        departedAgentIds: new Set(["b"]),
        lastActivityAtByAgentId: activity({ a: 2, b: 1 }),
        maxRetainedAgents: 10,
      }),
    ).toEqual([]);
  });

  test("departures do not count against the cap", () => {
    // 4 buffered, cap 3, one departed: releasing the departed one is enough.
    expect(
      planAgentStreamEviction({
        bufferedAgentIds: ["a", "b", "c", "d"],
        displayedAgentIds: new Set(),
        departedAgentIds: new Set(["d"]),
        lastActivityAtByAgentId: activity({ a: 4, b: 3, c: 2, d: 1 }),
        maxRetainedAgents: 3,
      }),
    ).toEqual(["d"]);
  });

  test("an agent with no recorded activity sorts as oldest", () => {
    expect(
      planAgentStreamEviction({
        bufferedAgentIds: ["a", "b", "c"],
        displayedAgentIds: new Set(),
        lastActivityAtByAgentId: activity({ a: 5, c: 6 }),
        maxRetainedAgents: 2,
      }),
    ).toEqual(["b"]);
  });

  test("the plan is stable when activity ties", () => {
    expect(
      planAgentStreamEviction({
        bufferedAgentIds: ["b", "a", "c"],
        displayedAgentIds: new Set(),
        lastActivityAtByAgentId: activity({ a: 1, b: 1, c: 1 }),
        maxRetainedAgents: 1,
      }),
    ).toEqual(["a", "b"]);
  });
});
