// The portal host is the visible surface boundary. Keep reveal badges just
// inside it instead of reproducing an anchor's negative local offset beyond
// the top, bottom, or side of the current page.
const SHORTCUT_DISCOVERY_EDGE_INSET = 4;

export function clampShortcutDiscoveryCoordinate(
  coordinate: number,
  size: number,
  containerSize: number,
): number {
  const minimum = SHORTCUT_DISCOVERY_EDGE_INSET;
  const maximum = Math.max(minimum, containerSize - size - SHORTCUT_DISCOVERY_EDGE_INSET);
  return Math.max(minimum, Math.min(coordinate, maximum));
}
