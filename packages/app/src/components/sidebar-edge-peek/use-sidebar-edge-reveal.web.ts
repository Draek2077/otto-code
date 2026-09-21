import { useEffect } from "react";
import { hasActiveWebOverlay } from "@/lib/overlay-root";
import {
  dismissSidebarEdgePeek,
  getSidebarEdgePeekSurface,
  useSidebarEdgePeekStore,
  type SidebarEdgeSide,
} from "@/stores/sidebar-edge-peek-store";
import {
  isPointerHoldingSidebarPeek,
  resolveSidebarEdgeSide,
  SIDEBAR_EDGE_DISMISS_DELAY_MS,
  SIDEBAR_EDGE_DWELL_MS,
  type EdgePoint,
} from "./sidebar-edge-reveal";
import { subscribeSidebarEdgePointer, type SidebarEdgePointerInput } from "./sidebar-edge-pointer";

/**
 * Watches the pointer for the sidebar edge reveal: resting on a screen edge
 * peeks that side's collapsed sidebar in, and leaving the peeked sidebar swoops
 * it away. One document-level listener for the whole app; it only runs while
 * `enabled` (setting on, desktop, maximized or fullscreen).
 */
export function useSidebarEdgeReveal(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      dismissSidebarEdgePeek();
      return undefined;
    }

    let dwellSide: SidebarEdgeSide | null = null;
    let dwellTimer: ReturnType<typeof setTimeout> | undefined;
    let dismissTimer: ReturnType<typeof setTimeout> | undefined;
    let lastPoint: EdgePoint | null = null;
    let lastButtons = 0;

    const cancelDwell = () => {
      if (dwellTimer) clearTimeout(dwellTimer);
      dwellTimer = undefined;
      dwellSide = null;
    };
    const cancelDismiss = () => {
      if (dismissTimer) clearTimeout(dismissTimer);
      dismissTimer = undefined;
    };

    // A menu or dialog opened from inside the peeked sidebar paints outside it,
    // and a held button is a drag (resizing the panel, dragging a tab) that
    // must not lose its surface mid-gesture.
    const isPeekHeld = (side: SidebarEdgeSide, point: EdgePoint): boolean => {
      if (lastButtons !== 0 || hasActiveWebOverlay()) return true;
      const rect = getSidebarEdgePeekSurface(side)?.getBoundingClientRect() ?? null;
      return isPointerHoldingSidebarPeek({
        side,
        point,
        viewportWidth: window.innerWidth,
        surfaceRect: rect,
      });
    };

    const handlePointerInput = ({ x, y, buttons }: SidebarEdgePointerInput) => {
      const point = { x, y };
      lastPoint = point;
      lastButtons = buttons;
      const { peekSide, available } = useSidebarEdgePeekStore.getState();

      if (peekSide) {
        cancelDwell();
        if (isPeekHeld(peekSide, point)) {
          cancelDismiss();
          return;
        }
        if (dismissTimer) return;
        dismissTimer = setTimeout(() => {
          dismissTimer = undefined;
          const current = useSidebarEdgePeekStore.getState().peekSide;
          // Re-check against where the pointer is now: it may have come back.
          if (current && lastPoint && !isPeekHeld(current, lastPoint)) {
            dismissSidebarEdgePeek();
          }
        }, SIDEBAR_EDGE_DISMISS_DELAY_MS);
        return;
      }

      const side =
        buttons === 0
          ? resolveSidebarEdgeSide({ point, viewportWidth: window.innerWidth, available })
          : null;
      if (side === dwellSide) return;
      cancelDwell();
      if (!side) return;
      dwellSide = side;
      dwellTimer = setTimeout(() => {
        dwellTimer = undefined;
        dwellSide = null;
        useSidebarEdgePeekStore.getState().setPeekSide(side);
      }, SIDEBAR_EDGE_DWELL_MS);
    };
    const handlePointerMove = (event: MouseEvent) => {
      handlePointerInput({ x: event.clientX, y: event.clientY, buttons: event.buttons });
    };

    // Leaving the window (another monitor, another app) never finishes a dwell.
    const handleWindowLeave = () => cancelDwell();

    document.addEventListener("mousemove", handlePointerMove, { passive: true });
    const unsubscribeGuestPointer = subscribeSidebarEdgePointer(handlePointerInput);
    document.documentElement.addEventListener("mouseleave", handleWindowLeave);
    window.addEventListener("blur", handleWindowLeave);
    return () => {
      document.removeEventListener("mousemove", handlePointerMove);
      unsubscribeGuestPointer();
      document.documentElement.removeEventListener("mouseleave", handleWindowLeave);
      window.removeEventListener("blur", handleWindowLeave);
      cancelDwell();
      cancelDismiss();
      dismissSidebarEdgePeek();
    };
  }, [enabled]);
}
