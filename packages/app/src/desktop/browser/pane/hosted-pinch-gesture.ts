interface Point {
  x: number;
  y: number;
}

interface TouchPoint {
  pageX: number;
  pageY: number;
  locationX?: number;
  locationY?: number;
  clientX?: number;
  clientY?: number;
}

interface Bounds {
  left: number;
  top: number;
}

export interface PinchGesture {
  distance: number;
}

export interface PinchFrame {
  distance: number;
  center: Point;
}

function localPoint(touch: TouchPoint, bounds?: Bounds): Point | null {
  if (Number.isFinite(touch.locationX) && Number.isFinite(touch.locationY))
    return { x: touch.locationX!, y: touch.locationY! };
  if (!bounds || !Number.isFinite(touch.clientX) || !Number.isFinite(touch.clientY)) return null;
  return { x: touch.clientX! - bounds.left, y: touch.clientY! - bounds.top };
}

/** Touch coordinates are screen-relative for distance and pane-relative for the zoom anchor. */
export function pinchFrameFromTouches(
  touches: readonly TouchPoint[],
  bounds?: Bounds,
): PinchFrame | null {
  if (touches.length !== 2) return null;
  const first = touches[0]!;
  const second = touches[1]!;
  const a = localPoint(first, bounds);
  const b = localPoint(second, bounds);
  const distance = Math.hypot(second.pageX - first.pageX, second.pageY - first.pageY);
  if (!a || !b || distance <= 0) return null;
  return { distance, center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
}

/** Hold subpixel noise until it adds up to a meaningful relative pinch. */
export function advancePinch(gesture: PinchGesture, distance: number): number | null {
  if (!Number.isFinite(distance) || distance <= 0) return null;
  const factor = distance / gesture.distance;
  if (Math.abs(Math.log(factor)) < 0.015) return null;
  gesture.distance = distance;
  return Math.max(0.5, Math.min(2, factor));
}

/** Chromium reports trackpad pinch as Ctrl+wheel in CSS pixels. */
export function wheelPinchFactor(deltaY: number, deltaMode: number): number {
  let multiplier = 1;
  if (deltaMode === 1) multiplier = 16;
  if (deltaMode === 2) multiplier = 600;
  const pixels = deltaY * multiplier;
  return Math.max(0.5, Math.min(2, Math.exp(-pixels / 250)));
}
