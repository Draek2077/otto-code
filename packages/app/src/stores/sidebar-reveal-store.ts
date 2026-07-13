import { create } from "zustand";

// Imperative "reveal this row in the sidebar" request, modeled on panel-store's
// filesRevealRequest. The monotonic token makes a repeat request for the SAME
// key still fire (re-selecting the already-active workspace should re-center it).
// The per-scroll-container reveal controller consumes the request; producers
// (active-workspace reveal, the tutorial) only call requestSidebarReveal.

export interface SidebarRevealRequest {
  // A key from sidebar-row-anchors (workspaceRowKey / projectRowKey).
  key: string;
  token: number;
}

interface SidebarRevealStore {
  request: SidebarRevealRequest | null;
  requestSidebarReveal: (key: string) => void;
}

export const useSidebarRevealStore = create<SidebarRevealStore>((set) => ({
  request: null,
  requestSidebarReveal: (key) =>
    set((state) => ({ request: { key, token: (state.request?.token ?? 0) + 1 } })),
}));

export function requestSidebarReveal(key: string): void {
  useSidebarRevealStore.getState().requestSidebarReveal(key);
}
