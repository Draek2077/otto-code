import type { GestureResponderEvent } from "react-native";

interface Point {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

interface PressCoordinates {
  locationX?: number;
  locationY?: number;
  clientX?: number;
  clientY?: number;
}

interface Measurable {
  getBoundingClientRect?: () => { left: number; top: number };
}

/**
 * Where in the pane a press landed. A native press reports its location in the
 * pressed view. A web press is a plain click, which carries no such field, so
 * its position is taken from the pointer and the pressed element's bounds.
 */
export function pressPointInPane(event: GestureResponderEvent): Point | null {
  const native = event.nativeEvent as PressCoordinates;
  if (Number.isFinite(native.locationX) && Number.isFinite(native.locationY))
    return { x: native.locationX!, y: native.locationY! };
  const bounds = (event.currentTarget as unknown as Measurable | null)?.getBoundingClientRect?.();
  if (!bounds || !Number.isFinite(native.clientX) || !Number.isFinite(native.clientY)) return null;
  return { x: native.clientX! - bounds.left, y: native.clientY! - bounds.top };
}

/**
 * Maps a point in the pane to the page's own coordinates. The page is drawn
 * scaled to fit and centred, so a press on the margin beside it is no press.
 */
export function pagePointFromPane(point: Point, pane: Size, page: Size): Point | null {
  const scale = Math.min(pane.width / page.width, pane.height / page.height);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const x = (point.x - (pane.width - page.width * scale) / 2) / scale;
  const y = (point.y - (pane.height - page.height * scale) / 2) / scale;
  return x >= 0 && y >= 0 && x <= page.width && y <= page.height ? { x, y } : null;
}
