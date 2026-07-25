import { describe, expect, it } from "vitest";
import {
  composeMemoryBrief,
  orderEntriesForInjection,
  selectEntriesForProject,
} from "./memory-brief.js";
import type { PersonalityMemoryEntry } from "./types.js";

function entry(
  overrides: Partial<PersonalityMemoryEntry> & { id: string },
): PersonalityMemoryEntry {
  return {
    text: `lesson ${overrides.id}`,
    scope: "global",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    source: "agent",
    ...overrides,
  };
}

describe("composeMemoryBrief", () => {
  it("says nothing at all when the personality has learned nothing", () => {
    const brief = composeMemoryBrief({ personalityName: "Sprocket", entries: [] });
    expect(brief.text).toBe("");
    expect(brief.estTokens).toBe(0);
  });

  it("names the personality and every lesson it holds", () => {
    const brief = composeMemoryBrief({
      personalityName: "Sprocket",
      entries: [
        entry({ id: "a", text: "vitest freezes when two workers run it at once" }),
        entry({ id: "b", text: "useUnistyles() is forbidden in this repo" }),
      ],
    });
    expect(brief.text).toContain("Sprocket");
    expect(brief.text).toContain("vitest freezes when two workers run it at once");
    expect(brief.text).toContain("useUnistyles() is forbidden in this repo");
    expect(brief.includedIds).toHaveLength(2);
    expect(brief.omittedCount).toBe(0);
  });

  it("tells the model what to do when a lesson turns out to be wrong", () => {
    const brief = composeMemoryBrief({
      personalityName: "Sprocket",
      entries: [entry({ id: "a" })],
    });
    // Memory that cannot be contradicted is dogma; the preamble is what makes
    // the difference, so it is asserted rather than left to prose review.
    expect(brief.text).toContain("remember_lesson");
    expect(brief.text.toLowerCase()).toContain("evidence against");
  });

  it("surfaces how often a lesson has been relearned, but only past once", () => {
    const brief = composeMemoryBrief({
      personalityName: "Sprocket",
      entries: [
        entry({ id: "a", text: "repeated", reinforcedCount: 4 }),
        entry({ id: "b", text: "once only", reinforcedCount: 1 }),
      ],
    });
    expect(brief.text).toContain("learned 4 times");
    expect(brief.text).not.toContain("learned 1 times");
  });

  it("never exceeds the token budget, and says how much it dropped", () => {
    const entries = Array.from({ length: 40 }, (_, index) =>
      entry({
        id: `e${index}`,
        text: `Lesson number ${index} about a specific mechanism in this repository that takes a while to explain properly.`,
      }),
    );
    const brief = composeMemoryBrief({ personalityName: "Atlas", entries, tokenBudget: 120 });
    expect(brief.estTokens).toBeLessThanOrEqual(120 + 40); // the footer is added past the cap
    expect(brief.includedIds.length).toBeLessThan(entries.length);
    expect(brief.omittedCount).toBe(entries.length - brief.includedIds.length);
    // A silent truncation would make the injected set differ from the shown set.
    expect(brief.text).toContain("review_lessons");
  });

  it("keeps at least one lesson even when a single lesson blows the budget", () => {
    const brief = composeMemoryBrief({
      personalityName: "Atlas",
      entries: [entry({ id: "a", text: "x".repeat(4000) })],
      tokenBudget: 10,
    });
    expect(brief.includedIds).toEqual(["a"]);
  });
});

describe("orderEntriesForInjection", () => {
  it("puts the most-reinforced lesson first, then the most recent", () => {
    const ordered = orderEntriesForInjection([
      entry({ id: "old", updatedAt: "2026-01-01T00:00:00.000Z", reinforcedCount: 1 }),
      entry({ id: "new", updatedAt: "2026-06-01T00:00:00.000Z", reinforcedCount: 1 }),
      entry({ id: "proven", updatedAt: "2025-01-01T00:00:00.000Z", reinforcedCount: 5 }),
    ]);
    expect(ordered.map((item) => item.id)).toEqual(["proven", "new", "old"]);
  });

  it("is stable for identical entries, so a cached prompt is not reshuffled", () => {
    const entries = [entry({ id: "b" }), entry({ id: "a" }), entry({ id: "c" })];
    expect(orderEntriesForInjection(entries).map((item) => item.id)).toEqual(
      orderEntriesForInjection(entries.toReversed()).map((item) => item.id),
    );
  });
});

describe("selectEntriesForProject", () => {
  const entries = [
    entry({ id: "global", scope: "global" }),
    entry({ id: "here", scope: "project", projectRoot: "/repos/otto" }),
    entry({ id: "elsewhere", scope: "project", projectRoot: "/repos/other" }),
  ];

  it("injects global lessons plus this project's, and nobody else's", () => {
    const selected = selectEntriesForProject(entries, "/repos/otto");
    expect(selected.map((item) => item.id)).toEqual(["global", "here"]);
  });

  it("matches roots across separator and case differences", () => {
    const windows = [entry({ id: "here", scope: "project", projectRoot: "C:\\Repos\\Otto\\" })];
    expect(selectEntriesForProject(windows, "c:/repos/otto")).toHaveLength(1);
  });

  it("falls back to global-only when the agent has no project root", () => {
    expect(selectEntriesForProject(entries, undefined).map((item) => item.id)).toEqual(["global"]);
  });
});
