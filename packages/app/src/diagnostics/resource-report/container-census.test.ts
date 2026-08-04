import { describe, expect, test } from "vitest";

import { censusContainers } from "./container-census";

describe("censusContainers", () => {
  test("emits sizes for maps, sets and arrays under their field names", () => {
    const metrics = censusContainers(
      { agents: new Map([["a", 1]]), pins: new Set(["x", "y"]), messages: [1, 2, 3] },
      { prefix: "session" },
    );

    expect(metrics).toEqual({
      "session.agents.size": 1,
      "session.pins.size": 2,
      "session.messages.length": 3,
    });
  });

  test("sums map values into one collapsed path instead of one metric per id", () => {
    const metrics = censusContainers(
      {
        streams: new Map([
          ["agent-1", [1, 2, 3]],
          ["agent-2", [4, 5]],
        ]),
      },
      { prefix: "session" },
    );

    // 2 keyed streams holding 5 items in total - and no agent id in the key space.
    expect(metrics).toEqual({ "session.streams.size": 2, "session.streams.*.length": 5 });
  });

  test("collapses listed plain-object records but keeps struct field names", () => {
    const state = {
      sessions: {
        "host-a": { agents: new Map([["x", 1]]), messages: [1, 2] },
        "host-b": { agents: new Map(), messages: [3] },
      },
    };

    const metrics = censusContainers(state, {
      prefix: "session",
      collapseKeysAt: ["session.sessions"],
    });

    expect(metrics).toEqual({
      "session.sessions.keys": 2,
      "session.sessions.*.agents.size": 1,
      "session.sessions.*.messages.length": 3,
    });
  });

  test("treats arrays as leaves so the walk cannot cost O(items)", () => {
    const metrics = censusContainers(
      { items: [{ nested: new Map([["a", 1]]) }, { nested: new Map() }] },
      { prefix: "root" },
    );

    expect(metrics).toEqual({ "root.items.length": 2 });
  });

  test("counts a shared reference once", () => {
    const shared = new Map([["a", 1]]);
    const metrics = censusContainers({ left: shared, right: shared }, { prefix: "root" });

    expect(metrics).toEqual({ "root.left.size": 1 });
  });

  test("survives a cyclic graph", () => {
    const node: Record<string, unknown> = { children: new Map<string, unknown>() };
    (node.children as Map<string, unknown>).set("self", node);

    expect(() => censusContainers(node, { prefix: "root" })).not.toThrow();
  });

  test("reports the size of the container but stops descending past maxContainerScan", () => {
    const big = new Map<string, unknown>();
    for (let index = 0; index < 10; index += 1) {
      big.set(`k${index}`, [1, 2, 3]);
    }

    const metrics = censusContainers({ big }, { prefix: "root", maxContainerScan: 5 });

    expect(metrics["root.big.size"]).toBe(10);
    expect(metrics["root.big.*.length"]).toBeUndefined();
  });

  test("reports long strings by length and ignores short ones", () => {
    const metrics = censusContainers(
      { blob: "x".repeat(2048), label: "short" },
      { prefix: "root", minReportedStringLength: 1024 },
    );

    expect(metrics).toEqual({ "root.blob.chars": 2048 });
  });

  test("stops at the configured depth", () => {
    const metrics = censusContainers(
      { a: { b: { c: { d: [1, 2] } } } },
      { prefix: "root", maxDepth: 2 },
    );

    expect(metrics).toEqual({});
  });
});
