import { create } from "zustand";
import { persistAppSettings } from "@/hooks/use-settings";
import type { Rect } from "./types";
import {
  reduceComplete,
  reduceExit,
  reduceGoToStep,
  reduceNext,
  reduceStart,
  type TutorialStatus,
} from "./state";

export interface TutorialStore {
  status: TutorialStatus;
  // Index into the (form-factor-resolved) step list the controller owns. The
  // controller decides when this exceeds the last step and calls complete().
  stepIndex: number;
  // Current spotlight target rect in window coordinates; null = centered card
  // (no cutout), used for the informational/fallback slides.
  rect: Rect | null;
  start: () => void;
  relaunch: () => void;
  next: () => void;
  goToStep: (index: number) => void;
  exit: () => void;
  complete: () => void;
  setRect: (rect: Rect | null) => void;
}

// Persist the one-time flag so the tour never auto-fires again on this device.
// Fire-and-forget: the in-memory status change dismisses the overlay
// immediately; the write just needs to land before the next cold start.
function markCompletedPersisted(): void {
  void persistAppSettings({ hasCompletedTutorial: true }).catch((error) => {
    console.error("[Tutorial] Failed to persist completion flag:", error);
  });
}

export const useTutorialStore = create<TutorialStore>((set) => ({
  status: "idle",
  stepIndex: 0,
  rect: null,
  start: () => set((s) => ({ ...reduceStart(s), rect: null })),
  // Force a fresh run regardless of current status. reduceStart no-ops unless
  // idle, so an explicit user tap on "Tutorial" (which may fire while a prior
  // run is still "running"/"completed") jumps straight to a running step 0 in a
  // SINGLE atomic write. We deliberately do NOT bounce through "idle" first: an
  // interim "idle" unmounts the overlay and remounts it, stranding reanimated
  // exit animations and degrading performance on repeated taps.
  relaunch: () => set(() => ({ status: "running", stepIndex: 0, rect: null })),
  next: () => set((s) => reduceNext(s)),
  goToStep: (index) => set((s) => reduceGoToStep(s, index)),
  exit: () => {
    markCompletedPersisted();
    set(() => ({ ...reduceExit(), rect: null }));
  },
  complete: () => {
    markCompletedPersisted();
    set((s) => ({ ...reduceComplete(s), rect: null }));
  },
  setRect: (rect) => set({ rect }),
}));
