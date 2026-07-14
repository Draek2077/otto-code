import { beforeEach, describe, expect, it } from "vitest";
import {
  clearBubbleGroupOffsets,
  getBubbleGroupOffset,
  reportBubbleSegmentHeight,
} from "./bubble-group-offsets";

describe("bubble group offsets", () => {
  beforeEach(() => {
    clearBubbleGroupOffsets();
  });

  it("returns 0 when nothing has been reported", () => {
    expect(getBubbleGroupOffset("group-1", 2)).toBe(0);
  });

  it("sums the heights of segments above the given index", () => {
    reportBubbleSegmentHeight({ groupId: "group-1", blockIndex: 0, height: 40 });
    reportBubbleSegmentHeight({ groupId: "group-1", blockIndex: 1, height: 120 });
    reportBubbleSegmentHeight({ groupId: "group-1", blockIndex: 2, height: 55 });

    expect(getBubbleGroupOffset("group-1", 0)).toBe(0);
    expect(getBubbleGroupOffset("group-1", 1)).toBe(40);
    expect(getBubbleGroupOffset("group-1", 2)).toBe(160);
    expect(getBubbleGroupOffset("group-1", 3)).toBe(215);
  });

  it("keeps groups independent", () => {
    reportBubbleSegmentHeight({ groupId: "group-1", blockIndex: 0, height: 40 });
    reportBubbleSegmentHeight({ groupId: "group-2", blockIndex: 0, height: 90 });

    expect(getBubbleGroupOffset("group-1", 1)).toBe(40);
    expect(getBubbleGroupOffset("group-2", 1)).toBe(90);
  });

  it("replaces a segment's height when it is re-reported", () => {
    reportBubbleSegmentHeight({ groupId: "group-1", blockIndex: 0, height: 40 });
    reportBubbleSegmentHeight({ groupId: "group-1", blockIndex: 0, height: 100 });

    expect(getBubbleGroupOffset("group-1", 1)).toBe(100);
  });

  it("ignores sub-pixel height jitter", () => {
    reportBubbleSegmentHeight({ groupId: "group-1", blockIndex: 0, height: 40 });
    reportBubbleSegmentHeight({ groupId: "group-1", blockIndex: 0, height: 40.3 });

    expect(getBubbleGroupOffset("group-1", 1)).toBe(40);
  });

  it("ignores non-positive and non-finite heights", () => {
    reportBubbleSegmentHeight({ groupId: "group-1", blockIndex: 0, height: 0 });
    reportBubbleSegmentHeight({ groupId: "group-1", blockIndex: 1, height: -5 });
    reportBubbleSegmentHeight({ groupId: "group-1", blockIndex: 2, height: Number.NaN });

    expect(getBubbleGroupOffset("group-1", 3)).toBe(0);
  });

  it("evicts the oldest group past the tracking cap", () => {
    for (let index = 0; index < 65; index += 1) {
      reportBubbleSegmentHeight({ groupId: `group-${index}`, blockIndex: 0, height: 10 });
    }

    expect(getBubbleGroupOffset("group-0", 1)).toBe(0);
    expect(getBubbleGroupOffset("group-64", 1)).toBe(10);
  });
});
