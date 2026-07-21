import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Where the file-history pane's two splitters sit, as `[commits, diff, message]`
 * shares of the pane height.
 *
 * Deliberately **one global setting**, not per file, per tab, or per workspace.
 * A developer arranges this pane once to suit how they read history — commit
 * list short, diff tall — and expects the next file they investigate to open the
 * same way. Keying it per file would mean re-dragging the splitters on every
 * new tab, which is the opposite of a saved layout.
 */

export const FILE_HISTORY_PANE_COUNT = 3;

/** Diff-heavy by default: the list only needs a handful of rows to be useful. */
export const DEFAULT_FILE_HISTORY_SIZES: readonly number[] = [0.3, 0.52, 0.18];

/** No pane may be dragged smaller than this share, so none can vanish. */
const MIN_PANE_SIZE = 0.08;

/**
 * Force a stored array back into "three positive shares summing to 1". Guards
 * against a truncated or hand-edited persisted value silently collapsing the
 * pane to a blank column.
 */
export function normalizeFileHistorySizes(sizes: readonly number[] | undefined): number[] {
  if (!sizes || sizes.length !== FILE_HISTORY_PANE_COUNT) {
    return [...DEFAULT_FILE_HISTORY_SIZES];
  }
  const clamped = sizes.map((size) =>
    Number.isFinite(size) ? Math.max(MIN_PANE_SIZE, size) : MIN_PANE_SIZE,
  );
  const total = clamped.reduce((sum, size) => sum + size, 0);
  if (total <= 0) {
    return [...DEFAULT_FILE_HISTORY_SIZES];
  }
  return clamped.map((size) => size / total);
}

interface FileHistoryLayoutState {
  sizes: number[];
  setSizes: (sizes: number[]) => void;
  resetSizes: () => void;
}

export const useFileHistoryLayoutStore = create<FileHistoryLayoutState>()(
  persist(
    (set) => ({
      sizes: [...DEFAULT_FILE_HISTORY_SIZES],
      setSizes: (sizes) => set({ sizes: normalizeFileHistorySizes(sizes) }),
      resetSizes: () => set({ sizes: [...DEFAULT_FILE_HISTORY_SIZES] }),
    }),
    {
      name: "file-history-pane-layout",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ sizes: state.sizes }),
      version: 1,
      merge: (persisted, current) => ({
        ...current,
        sizes: normalizeFileHistorySizes(
          (persisted as { sizes?: number[] } | undefined)?.sizes ?? undefined,
        ),
      }),
    },
  ),
);
