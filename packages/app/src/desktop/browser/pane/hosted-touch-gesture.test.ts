import { describe, expect, it } from "vitest";
import {
  advanceTouch,
  beginTouch,
  endTouch,
  scrollDeltaForDrag,
  TOUCH_SLOP,
} from "./hosted-touch-gesture";

function at(pageX: number, pageY: number) {
  return { pageX, pageY };
}

describe("dragging a hosted page with a finger", () => {
  it("holds still while the finger is within the tap slack", () => {
    const gesture = beginTouch(at(100, 200));

    expect(advanceTouch(gesture, at(104, 205))).toBeNull();
    expect(gesture.moved).toBe(false);
    // The slack is not spent: the drag still starts from where the finger landed.
    expect(gesture.lastY).toBe(200);
  });

  it("scrolls by the whole distance once the finger passes the slack", () => {
    const gesture = beginTouch(at(100, 200));

    expect(advanceTouch(gesture, at(100, 200 + TOUCH_SLOP))).toEqual({ dx: 0, dy: TOUCH_SLOP });
    expect(gesture.moved).toBe(true);
    expect(advanceTouch(gesture, at(100, 200 + TOUCH_SLOP + 8))).toEqual({ dx: 0, dy: 8 });
  });

  it("keeps scrolling on every move once the drag has begun", () => {
    const gesture = beginTouch(at(0, 0));
    advanceTouch(gesture, at(0, 40));

    // A move back inside the slack is still a move: the gesture is no tap now.
    expect(advanceTouch(gesture, at(0, 41))).toEqual({ dx: 0, dy: 1 });
    expect(advanceTouch(gesture, at(3, 41))).toEqual({ dx: 3, dy: 0 });
  });

  it("reports nothing when the finger only tapped", () => {
    const gesture = beginTouch(at(100, 200));
    expect(endTouch(gesture, at(102, 203))).toBeNull();
  });

  it("treats a flick that lifted without a move as a drag", () => {
    const gesture = beginTouch(at(100, 200));
    expect(endTouch(gesture, at(100, 320))).toEqual({ dx: 0, dy: 120 });
  });

  it("adds only what is left when the drag ends where the last move put it", () => {
    const gesture = beginTouch(at(0, 0));
    advanceTouch(gesture, at(0, 60));
    expect(endTouch(gesture, at(0, 60))).toEqual({ dx: 0, dy: 0 });
  });
});

describe("turning a drag into the page's own scroll", () => {
  it("moves the content with the finger", () => {
    const pane = { width: 400, height: 800 };
    // Dragging up scrolls down, as a finger on a page does everywhere else.
    expect(scrollDeltaForDrag({ dx: 0, dy: -50 }, pane, pane)).toEqual({ dx: 0, dy: 50 });
    expect(scrollDeltaForDrag({ dx: 0, dy: 50 }, pane, pane)).toEqual({ dx: 0, dy: -50 });
  });

  it("measures the drag in the page's pixels when the page is drawn scaled", () => {
    const pane = { width: 390, height: 600 };
    const page = { width: 780, height: 1200 };
    // The page is shown at half size, so a finger travels twice as far on it.
    expect(scrollDeltaForDrag({ dx: 0, dy: -30 }, pane, page)).toEqual({ dx: 0, dy: 60 });
  });

  it("scrolls nothing before the pane has been measured", () => {
    expect(
      scrollDeltaForDrag({ dx: 0, dy: -30 }, { width: 0, height: 0 }, { width: 0, height: 0 }),
    ).toEqual({ dx: 0, dy: 0 });
  });
});
