import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Where the Architectural View authoring chat and preview divider sits, as
 * `[chat, preview]` shares of the available width.
 *
 * This is one app-local reading preference. An author arranges the working
 * chat beside the visual once, then expects every Architectural View authoring
 * session, including the draft-to-chat promotion, to preserve that proportion.
 */
export const ARCHITECTURAL_VIEW_AUTHORING_PANE_COUNT = 2;
export const DEFAULT_ARCHITECTURAL_VIEW_AUTHORING_SPLIT_SIZES: readonly number[] = [0.46, 0.54];

/** Keep enough horizontal room for both the chat and the rendered visual. */
const MIN_PANE_SIZE = 0.1;

/**
 * Normalize persisted widths to two positive percentage shares summing to one.
 * This repairs interrupted or hand-edited persisted state before it reaches
 * the resize handle, so neither pane can reopen collapsed.
 */
export function normalizeArchitecturalViewAuthoringSplitSizes(
  sizes: readonly number[] | undefined,
): number[] {
  if (!sizes || sizes.length !== ARCHITECTURAL_VIEW_AUTHORING_PANE_COUNT) {
    return [...DEFAULT_ARCHITECTURAL_VIEW_AUTHORING_SPLIT_SIZES];
  }
  const clamped = sizes.map((size) =>
    Number.isFinite(size) ? Math.max(MIN_PANE_SIZE, size) : MIN_PANE_SIZE,
  );
  const total = clamped.reduce((sum, size) => sum + size, 0);
  if (total <= 0) {
    return [...DEFAULT_ARCHITECTURAL_VIEW_AUTHORING_SPLIT_SIZES];
  }
  return clamped.map((size) => size / total);
}

interface ArchitecturalViewAuthoringLayoutState {
  splitSizes: number[];
  setSplitSizes: (sizes: number[]) => void;
}

export const useArchitecturalViewAuthoringLayoutStore =
  create<ArchitecturalViewAuthoringLayoutState>()(
    persist(
      (set) => ({
        splitSizes: [...DEFAULT_ARCHITECTURAL_VIEW_AUTHORING_SPLIT_SIZES],
        setSplitSizes: (splitSizes) =>
          set({ splitSizes: normalizeArchitecturalViewAuthoringSplitSizes(splitSizes) }),
      }),
      {
        name: "architectural-view-authoring-layout",
        storage: createJSONStorage(() => AsyncStorage),
        partialize: (state) => ({ splitSizes: state.splitSizes }),
        version: 1,
        merge: (persisted, current) => ({
          ...current,
          splitSizes: normalizeArchitecturalViewAuthoringSplitSizes(
            (persisted as { splitSizes?: number[] } | undefined)?.splitSizes,
          ),
        }),
      },
    ),
  );
