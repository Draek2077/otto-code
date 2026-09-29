/**
 * A finger dragged across a hosted page scrolls it. The page is a picture, so
 * there is nothing local to scroll: each drag becomes a wheel delta sent to the
 * host. The arithmetic lives here, apart from the pane, so it can be tested.
 */

/** Where a drag began, and where it last was, in screen coordinates. */
export interface TouchGesture {
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  moved: boolean;
}

export interface TouchPoint {
  pageX: number;
  pageY: number;
}

export interface TouchDelta {
  dx: number;
  dy: number;
}

/**
 * A drag shorter than this is a tap. A finger never lands perfectly still, so
 * without the slack every tap would also scroll the page a little.
 */
export const TOUCH_SLOP = 15;

export function beginTouch(point: TouchPoint): TouchGesture {
  return { x: point.pageX, y: point.pageY, lastX: point.pageX, lastY: point.pageY, moved: false };
}

function travelled(gesture: TouchGesture, point: TouchPoint): boolean {
  return Math.abs(point.pageX - gesture.x) + Math.abs(point.pageY - gesture.y) >= TOUCH_SLOP;
}

/**
 * The movement to scroll by, or null while the finger is still within the slack
 * and the gesture could yet turn out to be a tap. The gesture is advanced in
 * place, so the first drag carries the whole distance from where it began.
 */
export function advanceTouch(gesture: TouchGesture, point: TouchPoint): TouchDelta | null {
  if (!gesture.moved && !travelled(gesture, point)) return null;
  gesture.moved = true;
  const delta = { dx: point.pageX - gesture.lastX, dy: point.pageY - gesture.lastY };
  gesture.lastX = point.pageX;
  gesture.lastY = point.pageY;
  return delta;
}

/**
 * The last movement of a drag, or null if the finger only ever tapped. A flick
 * that reports no move before it lifts still counts as a drag.
 */
export function endTouch(gesture: TouchGesture, point: TouchPoint): TouchDelta | null {
  if (!gesture.moved && !travelled(gesture, point)) return null;
  return { dx: point.pageX - gesture.lastX, dy: point.pageY - gesture.lastY };
}

/** Reverses a distance without producing -0, which is only noise on the wire. */
function away(distance: number, scale: number): number {
  return distance === 0 ? 0 : -distance / scale;
}

/**
 * Turns a movement of the finger into the wheel delta the page expects. The
 * page is drawn scaled to fit the pane, so the distance is measured in the
 * page's own pixels, and content follows the finger rather than opposing it.
 */
export function scrollDeltaForDrag(
  delta: TouchDelta,
  pane: { width: number; height: number },
  page: { width: number; height: number },
): TouchDelta {
  const scale = Math.min(pane.width / page.width, pane.height / page.height);
  if (!Number.isFinite(scale) || scale <= 0) return { dx: 0, dy: 0 };
  return { dx: away(delta.dx, scale), dy: away(delta.dy, scale) };
}
