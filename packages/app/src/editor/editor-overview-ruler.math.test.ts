import { describe, expect, it } from "vitest";
import {
  isRulerScrollable,
  RULER_MARK_HEIGHT_PX,
  RULER_MIN_THUMB_PX,
  rulerBandRect,
  rulerBucket,
  rulerMarkTop,
  rulerScale,
  rulerScrollTopForTrackY,
  rulerThumbRect,
  type RulerMetrics,
} from "./editor-overview-ruler.math";

// A 10000px document in a 500px viewport, drawn on a 500px track: content
// pixels and track pixels differ by exactly 20x, which makes every expectation
// below readable by hand.
const LONG: RulerMetrics = { trackHeight: 500, scrollHeight: 10_000, clientHeight: 500 };

describe("rulerScale", () => {
  it("is track pixels per content pixel", () => {
    expect(rulerScale(LONG)).toBe(0.05);
  });

  it("is zero before anything has been measured", () => {
    expect(rulerScale({ trackHeight: 0, scrollHeight: 0, clientHeight: 0 })).toBe(0);
    expect(rulerScale({ trackHeight: 500, scrollHeight: 0, clientHeight: 500 })).toBe(0);
  });
});

describe("isRulerScrollable", () => {
  it("is false for a file that fits", () => {
    expect(isRulerScrollable({ trackHeight: 500, scrollHeight: 400, clientHeight: 400 })).toBe(
      false,
    );
  });

  it("ignores a sub-pixel overflow", () => {
    expect(isRulerScrollable({ trackHeight: 500, scrollHeight: 400.4, clientHeight: 400 })).toBe(
      false,
    );
  });

  it("is true once there is real travel", () => {
    expect(isRulerScrollable(LONG)).toBe(true);
  });
});

describe("rulerMarkTop", () => {
  it("scales a content offset onto the track", () => {
    expect(rulerMarkTop(0, LONG)).toBe(0);
    expect(rulerMarkTop(2000, LONG)).toBe(100);
  });

  it("keeps the last line's mark inside the track", () => {
    expect(rulerMarkTop(9999, LONG)).toBe(500 - RULER_MARK_HEIGHT_PX);
    expect(rulerMarkTop(50_000, LONG)).toBe(500 - RULER_MARK_HEIGHT_PX);
  });

  it("collapses to the top when nothing is measured", () => {
    expect(rulerMarkTop(2000, { trackHeight: 0, scrollHeight: 0, clientHeight: 0 })).toBe(0);
  });
});

describe("rulerBandRect", () => {
  it("scales a selected range onto the track", () => {
    expect(rulerBandRect(2000, 4000, LONG)).toEqual({ top: 100, height: 100 });
  });

  it("floors a short selection at the mark height so it stays visible", () => {
    // 40 content px — two lines — is 2px of track on this scale.
    expect(rulerBandRect(2000, 2040, LONG)).toEqual({ top: 100, height: RULER_MARK_HEIGHT_PX });
  });

  it("keeps a selection running to the last line inside the track", () => {
    const rect = rulerBandRect(9980, 10_000, LONG);
    expect(rect.top + rect.height).toBeLessThanOrEqual(500);
    expect(rect.height).toBeGreaterThan(0);
  });

  it("clamps a range that starts past the end of the document", () => {
    const rect = rulerBandRect(50_000, 60_000, LONG);
    expect(rect.top).toBe(500 - RULER_MARK_HEIGHT_PX);
    expect(rect.top + rect.height).toBe(500);
  });

  it("is empty before anything has been measured", () => {
    expect(rulerBandRect(0, 100, { trackHeight: 0, scrollHeight: 0, clientHeight: 0 })).toEqual({
      top: 0,
      height: 0,
    });
  });
});

describe("rulerThumbRect", () => {
  it("is the visible fraction of the track", () => {
    const rect = rulerThumbRect(0, { trackHeight: 500, scrollHeight: 2000, clientHeight: 500 });
    expect(rect).toEqual({ top: 0, height: 125 });
  });

  it("reaches the bottom of the track exactly at the end of the document", () => {
    const metrics: RulerMetrics = { trackHeight: 500, scrollHeight: 2000, clientHeight: 500 };
    const rect = rulerThumbRect(1500, metrics);
    expect(rect.top + rect.height).toBe(500);
  });

  it("floors the height on a very long file and still reaches the bottom", () => {
    const metrics: RulerMetrics = { trackHeight: 500, scrollHeight: 500_000, clientHeight: 500 };
    const atTop = rulerThumbRect(0, metrics);
    expect(atTop.height).toBe(RULER_MIN_THUMB_PX);
    const atEnd = rulerThumbRect(499_500, metrics);
    expect(atEnd.top + atEnd.height).toBe(500);
  });

  it("never overflows the track when the offset is out of range", () => {
    const rect = rulerThumbRect(999_999, LONG);
    expect(rect.top + rect.height).toBeLessThanOrEqual(500);
  });

  it("is empty before anything has been measured", () => {
    expect(rulerThumbRect(0, { trackHeight: 0, scrollHeight: 0, clientHeight: 0 })).toEqual({
      top: 0,
      height: 0,
    });
  });
});

describe("rulerScrollTopForTrackY", () => {
  it("centres the clicked point in the viewport", () => {
    // Half way down the track is content pixel 5000; centring it in a 500px
    // viewport means starting 250px above it.
    expect(rulerScrollTopForTrackY(250, LONG)).toBe(4750);
  });

  it("clamps at both ends rather than centring past them", () => {
    expect(rulerScrollTopForTrackY(0, LONG)).toBe(0);
    expect(rulerScrollTopForTrackY(500, LONG)).toBe(9500);
  });

  it("tolerates a pointer dragged outside the track", () => {
    expect(rulerScrollTopForTrackY(-80, LONG)).toBe(0);
    expect(rulerScrollTopForTrackY(4000, LONG)).toBe(9500);
  });

  it("stays at zero for a file that does not scroll", () => {
    const metrics: RulerMetrics = { trackHeight: 500, scrollHeight: 400, clientHeight: 400 };
    expect(rulerScrollTopForTrackY(500, metrics)).toBe(0);
  });
});

describe("rulerBucket", () => {
  it("collapses marks that would paint the same pixels", () => {
    expect(rulerBucket(0)).toBe(rulerBucket(RULER_MARK_HEIGHT_PX - 0.5));
    expect(rulerBucket(0)).not.toBe(rulerBucket(RULER_MARK_HEIGHT_PX));
  });
});
