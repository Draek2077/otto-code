import { create } from "zustand";

// Transient "swoop in" state for the desktop sidebars. While the window is
// maximized or fullscreen and a sidebar is collapsed, resting the pointer on
// that screen edge peeks the sidebar in as an overlay; leaving it swoops it
// away. Nothing here persists: a peek never changes whether a sidebar is open.
// See docs/sidebar-edge-reveal.md.

export type SidebarEdgeSide = "left" | "right";

interface SidebarEdgePeekStore {
  peekSide: SidebarEdgeSide | null;
  // Whether a surface can currently peek on that side. Owned by the surfaces
  // themselves (see useSidebarEdgePeekAvailability), so the edge controller
  // never arms a side that has nothing to show.
  available: Record<SidebarEdgeSide, boolean>;
  setPeekSide: (side: SidebarEdgeSide | null) => void;
}

export const useSidebarEdgePeekStore = create<SidebarEdgePeekStore>((set) => ({
  peekSide: null,
  available: { left: false, right: false },
  setPeekSide: (side) =>
    set((state) => {
      if (state.peekSide === side) return state;
      if (side !== null && !state.available[side]) return state;
      return { peekSide: side };
    }),
}));

// Several workspace screens stay mounted at once (the workspace deck), so a
// side's availability is a set of claims rather than a last-writer-wins flag:
// an unfocused screen releasing its claim must not clear the focused one's.
const availabilityClaims: Record<SidebarEdgeSide, Set<symbol>> = {
  left: new Set(),
  right: new Set(),
};

function publishAvailability(side: SidebarEdgeSide): void {
  const available = availabilityClaims[side].size > 0;
  useSidebarEdgePeekStore.setState((state) => {
    if (state.available[side] === available) return state;
    const next = { available: { ...state.available, [side]: available } };
    // A side that stops being peekable (the sidebar was pinned open, the
    // workspace unmounted) ends its peek immediately.
    return !available && state.peekSide === side ? { ...next, peekSide: null } : next;
  });
}

export function claimSidebarEdgePeek(side: SidebarEdgeSide): () => void {
  const token = Symbol(side);
  availabilityClaims[side].add(token);
  publishAvailability(side);
  return () => {
    availabilityClaims[side].delete(token);
    publishAvailability(side);
  };
}

export function dismissSidebarEdgePeek(): void {
  useSidebarEdgePeekStore.getState().setPeekSide(null);
}

// The painted peek panel for each side, so the edge controller can hit-test
// the pointer against it. Web-only; native never peeks.
const peekSurfaces: Record<SidebarEdgeSide, HTMLElement | null> = { left: null, right: null };

export function registerSidebarEdgePeekSurface(
  side: SidebarEdgeSide,
  element: HTMLElement | null,
): void {
  peekSurfaces[side] = element;
}

export function getSidebarEdgePeekSurface(side: SidebarEdgeSide): HTMLElement | null {
  return peekSurfaces[side];
}
