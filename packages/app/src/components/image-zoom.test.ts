import { describe, expect, it } from "vitest";
import {
  clampZoom,
  fitScale,
  formatZoomPercent,
  isAtZoomLimit,
  MAX_ZOOM,
  MIN_ZOOM,
  nextZoomStep,
  scaledSize,
} from "./image-zoom";

describe("fitScale", () => {
  it("shrinks an image taller than the pane", () => {
    expect(fitScale({ width: 100, height: 400 }, { width: 200, height: 200 })).toBe(0.5);
  });

  it("shrinks an image wider than the pane", () => {
    expect(fitScale({ width: 800, height: 100 }, { width: 200, height: 200 })).toBe(0.25);
  });

  it("leaves a small image alone rather than blowing it up", () => {
    expect(fitScale({ width: 16, height: 16 }, { width: 800, height: 600 })).toBe(1);
  });

  it("is 1 before the pane has been measured", () => {
    expect(fitScale({ width: 800, height: 600 }, { width: 0, height: 0 })).toBe(1);
  });

  it("is 1 when the natural size is unknown", () => {
    expect(fitScale(null, { width: 200, height: 200 })).toBe(1);
  });
});

describe("nextZoomStep", () => {
  it("steps up to the next rung", () => {
    expect(nextZoomStep(1, 1)).toBe(1.5);
  });

  it("steps down to the previous rung", () => {
    expect(nextZoomStep(1, -1)).toBe(0.67);
  });

  it("reaches 100% from an arbitrary fit ratio instead of snapping backwards", () => {
    expect(nextZoomStep(0.8123, 1)).toBe(1);
  });

  it("steps down from an arbitrary fit ratio to the rung below it", () => {
    expect(nextZoomStep(0.8123, -1)).toBe(0.67);
  });

  it("does not stall on a rung it is already sitting on", () => {
    expect(nextZoomStep(0.5, 1)).toBe(0.67);
    expect(nextZoomStep(0.5, -1)).toBe(0.33);
  });

  it("saturates at the ends of the ladder", () => {
    expect(nextZoomStep(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(nextZoomStep(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });
});

describe("isAtZoomLimit", () => {
  it("disarms the buttons only at the ends", () => {
    expect(isAtZoomLimit(MAX_ZOOM, 1)).toBe(true);
    expect(isAtZoomLimit(MIN_ZOOM, -1)).toBe(true);
    expect(isAtZoomLimit(1, 1)).toBe(false);
    expect(isAtZoomLimit(1, -1)).toBe(false);
  });
});

describe("clampZoom", () => {
  it("holds the ladder's bounds", () => {
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
  });

  it("falls back to 100% for a value that is not a number", () => {
    expect(clampZoom(Number.NaN)).toBe(1);
  });
});

describe("formatZoomPercent", () => {
  it("reads as whole percent", () => {
    expect(formatZoomPercent(1)).toBe("100%");
    expect(formatZoomPercent(0.6712)).toBe("67%");
    expect(formatZoomPercent(16)).toBe("1600%");
  });

  it("never reads as 0%, which would look like a failure", () => {
    expect(formatZoomPercent(0.001)).toBe("5%");
  });
});

describe("scaledSize", () => {
  it("rounds the on-screen box to whole pixels", () => {
    expect(scaledSize({ width: 101, height: 51 }, 0.5)).toEqual({ width: 51, height: 26 });
  });

  it("never collapses to zero at extreme zoom-out", () => {
    expect(scaledSize({ width: 4, height: 4 }, 0.05)).toEqual({ width: 1, height: 1 });
  });
});
