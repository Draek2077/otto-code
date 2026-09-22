import type { SidebarEdgeSide } from "@/stores/sidebar-edge-peek-store";

// How close to the screen edge the pointer must rest. A maximized or
// fullscreen window's edge IS the screen edge, so the pointer pins against it.
export const SIDEBAR_EDGE_TRIGGER_PX = 2;
// The pointer has to rest on the edge this long: a cursor thrown across the
// screen, or on its way to another monitor, must not pop a sidebar out.
export const SIDEBAR_EDGE_DWELL_MS = 300;
// Grace period after the pointer leaves the peeked sidebar, so brushing past
// its border does not snap it shut.
export const SIDEBAR_EDGE_DISMISS_DELAY_MS = 300;
// The top strip belongs to the title bar and the window controls. Throwing the
// cursor into the top-right corner to close the window must never swoop the
// Explorer over the close button.
export const SIDEBAR_EDGE_TOP_EXCLUSION_PX = 48;

export interface EdgePoint {
  x: number;
  y: number;
}

export function resolveSidebarEdgeSide(input: {
  point: EdgePoint;
  viewportWidth: number;
  available: Record<SidebarEdgeSide, boolean>;
}): SidebarEdgeSide | null {
  const { point, viewportWidth, available } = input;
  if (viewportWidth <= 0 || point.y < SIDEBAR_EDGE_TOP_EXCLUSION_PX) return null;
  if (available.left && point.x <= SIDEBAR_EDGE_TRIGGER_PX) return "left";
  if (available.right && point.x >= viewportWidth - 1 - SIDEBAR_EDGE_TRIGGER_PX) return "right";
  return null;
}

export interface EdgeRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Whether the pointer still "holds" an open peek. The edge strip itself counts,
 * because the panel starts zero-width off-screen while it swoops in and the
 * pointer that summoned it has not moved yet.
 */
export function isPointerHoldingSidebarPeek(input: {
  side: SidebarEdgeSide;
  point: EdgePoint;
  viewportWidth: number;
  surfaceRect: EdgeRect | null;
}): boolean {
  const { side, point, viewportWidth, surfaceRect } = input;
  const onEdge =
    side === "left"
      ? point.x <= SIDEBAR_EDGE_TRIGGER_PX
      : point.x >= viewportWidth - 1 - SIDEBAR_EDGE_TRIGGER_PX;
  if (onEdge) return true;
  if (!surfaceRect) return false;
  return (
    point.x >= surfaceRect.left &&
    point.x <= surfaceRect.right &&
    point.y >= surfaceRect.top &&
    point.y <= surfaceRect.bottom
  );
}

export function isSidebarEdgeRevealEligible(input: {
  settingEnabled: boolean;
  isElectron: boolean;
  isCompact: boolean;
  isMaximized: boolean;
  isFullscreen: boolean;
}): boolean {
  return (
    input.settingEnabled &&
    input.isElectron &&
    !input.isCompact &&
    (input.isMaximized || input.isFullscreen)
  );
}
