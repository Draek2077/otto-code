import { describe, expect, it } from "vitest";
import { computeVisibleTabCount, reorderTabIntoVisible, splitTabsForOverflow } from "./overflow";

interface Item {
  id: string;
}

function items(...ids: string[]): Item[] {
  return ids.map((id) => ({ id }));
}

const getId = (item: Item) => item.id;

function toIds(list: Item[]): string[] {
  return list.map(getId);
}

describe("computeVisibleTabCount", () => {
  const MIN = 100;
  const OVERFLOW = 40;

  it("shows every tab when they all fit at the minimum width", () => {
    // 500 / 100 = 5 fit; 4 tabs all fit, no overflow control needed.
    expect(
      computeVisibleTabCount({
        totalTabs: 4,
        availableWidth: 500,
        minTabWidth: MIN,
        overflowControlWidth: OVERFLOW,
      }),
    ).toBe(4);
  });

  it("reserves the overflow control's width once tabs must overflow", () => {
    // 500 / 100 = 5 fit without a control, but there are 8 tabs, so overflow is
    // unavoidable: (500 - 40) / 100 = 4 visible, 4 hidden.
    expect(
      computeVisibleTabCount({
        totalTabs: 8,
        availableWidth: 500,
        minTabWidth: MIN,
        overflowControlWidth: OVERFLOW,
      }),
    ).toBe(4);
  });

  it("reveals more tabs as the pane widens", () => {
    const narrow = computeVisibleTabCount({
      totalTabs: 20,
      availableWidth: 300,
      minTabWidth: MIN,
      overflowControlWidth: OVERFLOW,
    });
    const wide = computeVisibleTabCount({
      totalTabs: 20,
      availableWidth: 1000,
      minTabWidth: MIN,
      overflowControlWidth: OVERFLOW,
    });
    expect(narrow).toBe(2); // (300 - 40) / 100 = 2
    expect(wide).toBe(9); // (1000 - 40) / 100 = 9
    expect(wide).toBeGreaterThan(narrow);
  });

  it("always keeps at least one tab visible in a very narrow pane", () => {
    expect(
      computeVisibleTabCount({
        totalTabs: 5,
        availableWidth: 60,
        minTabWidth: MIN,
        overflowControlWidth: OVERFLOW,
      }),
    ).toBe(1);
  });

  it("shows everything before the width is measured", () => {
    expect(
      computeVisibleTabCount({
        totalTabs: 12,
        availableWidth: 0,
        minTabWidth: MIN,
        overflowControlWidth: OVERFLOW,
      }),
    ).toBe(12);
  });

  it("returns zero when there are no tabs", () => {
    expect(
      computeVisibleTabCount({
        totalTabs: 0,
        availableWidth: 800,
        minTabWidth: MIN,
        overflowControlWidth: OVERFLOW,
      }),
    ).toBe(0);
  });
});

describe("splitTabsForOverflow", () => {
  it("keeps everything visible at or under the cap", () => {
    const split = splitTabsForOverflow({
      items: items("a", "b", "c"),
      getId,
      activeId: "a",
      cap: 10,
    });
    expect(toIds(split.visible)).toEqual(["a", "b", "c"]);
    expect(split.hidden).toEqual([]);
  });

  it("splits into a prefix and remainder past the cap", () => {
    const split = splitTabsForOverflow({
      items: items("a", "b", "c", "d", "e"),
      getId,
      activeId: "a",
      cap: 3,
    });
    expect(toIds(split.visible)).toEqual(["a", "b", "c"]);
    expect(toIds(split.hidden)).toEqual(["d", "e"]);
  });

  it("leaves the split alone when the active tab is inside the visible prefix", () => {
    const split = splitTabsForOverflow({
      items: items("a", "b", "c", "d", "e"),
      getId,
      activeId: "b",
      cap: 3,
    });
    expect(toIds(split.visible)).toEqual(["a", "b", "c"]);
    expect(toIds(split.hidden)).toEqual(["d", "e"]);
  });

  it("pulls a hidden active tab into the last visible slot, bumping the displaced tab into hidden", () => {
    const split = splitTabsForOverflow({
      items: items("a", "b", "c", "d", "e"),
      getId,
      activeId: "e",
      cap: 3,
    });
    // 'e' takes the last visible slot; 'c' (previously last visible) is bumped
    // to the front of hidden; every other tab keeps its position.
    expect(toIds(split.visible)).toEqual(["a", "b", "e"]);
    expect(toIds(split.hidden)).toEqual(["c", "d"]);
  });

  it("treats a missing active id like no active tab", () => {
    const split = splitTabsForOverflow({
      items: items("a", "b", "c", "d"),
      getId,
      activeId: "zzz",
      cap: 2,
    });
    expect(toIds(split.visible)).toEqual(["a", "b"]);
    expect(toIds(split.hidden)).toEqual(["c", "d"]);
  });

  it("returns everything visible when the cap is non-positive", () => {
    const split = splitTabsForOverflow({
      items: items("a", "b"),
      getId,
      activeId: null,
      cap: 0,
    });
    expect(toIds(split.visible)).toEqual(["a", "b"]);
    expect(split.hidden).toEqual([]);
  });
});

describe("reorderTabIntoVisible", () => {
  it("moves the selected hidden tab to the last visible slot and bumps the displaced tab into hidden", () => {
    const next = reorderTabIntoVisible({
      tabIds: ["a", "b", "c", "d", "e", "f"],
      selectedId: "e",
      cap: 3,
    });
    // 'e' lands at index cap-1 (2); 'c' shifts to index 3 (first hidden slot).
    expect(next).toEqual(["a", "b", "e", "c", "d", "f"]);
  });

  it("does not mutate the input array", () => {
    const input = ["a", "b", "c", "d"];
    const next = reorderTabIntoVisible({ tabIds: input, selectedId: "d", cap: 2 });
    expect(input).toEqual(["a", "b", "c", "d"]);
    expect(next).toEqual(["a", "d", "b", "c"]);
  });

  it("is a no-op when the selected tab is unknown", () => {
    const next = reorderTabIntoVisible({
      tabIds: ["a", "b", "c"],
      selectedId: "zzz",
      cap: 2,
    });
    expect(next).toEqual(["a", "b", "c"]);
  });

  it("is a no-op when the selected tab is already in the target slot", () => {
    const next = reorderTabIntoVisible({
      tabIds: ["a", "b", "c", "d"],
      selectedId: "b",
      cap: 2,
    });
    expect(next).toEqual(["a", "b", "c", "d"]);
  });
});
