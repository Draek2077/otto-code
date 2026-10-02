import { describe, expect, it } from "vitest";
import { advancePinch, pinchFrameFromTouches, wheelPinchFactor } from "./hosted-pinch-gesture";

describe("hosted browser pinch", () => {
  it("anchors a native two-finger pinch between the fingers", () => {
    expect(
      pinchFrameFromTouches([
        { pageX: 100, pageY: 200, locationX: 20, locationY: 40 },
        { pageX: 200, pageY: 200, locationX: 120, locationY: 40 },
      ]),
    ).toEqual({ distance: 100, center: { x: 70, y: 40 } });
  });

  it("maps web touch coordinates into the pane", () => {
    expect(
      pinchFrameFromTouches(
        [
          { pageX: 100, pageY: 200, clientX: 90, clientY: 180 },
          { pageX: 200, pageY: 200, clientX: 190, clientY: 180 },
        ],
        { left: 40, top: 80 },
      ),
    ).toEqual({ distance: 100, center: { x: 100, y: 100 } });
  });

  it("accumulates small movement before sending a relative scale", () => {
    const gesture = { distance: 100 };
    expect(advancePinch(gesture, 101)).toBeNull();
    expect(advancePinch(gesture, 120)).toBe(1.2);
    expect(advancePinch(gesture, 96)).toBe(0.8);
  });

  it("converts trackpad pinch direction into bounded zoom", () => {
    expect(wheelPinchFactor(-100, 0)).toBeGreaterThan(1);
    expect(wheelPinchFactor(100, 0)).toBeLessThan(1);
    expect(wheelPinchFactor(-1000, 0)).toBe(2);
    expect(wheelPinchFactor(1000, 0)).toBe(0.5);
  });
});
