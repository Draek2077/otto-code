import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// How a workspace file tab presents its content. One tab per file; this store
// remembers which of the three views (editable buffer, editor+preview split,
// read-only preview) the user last picked for it. The split ratio is global —
// a user who drags the divider wants that proportion everywhere.

export type FileViewMode = "editor" | "split" | "preview";

export const DEFAULT_FILE_SPLIT_RATIO = 0.5;

const MAX_REMEMBERED_MODES = 300;
const MIN_SPLIT_RATIO = 0.15;
const MAX_SPLIT_RATIO = 0.85;

interface FileViewState {
  /** Last chosen mode per file; keys are `${persistenceKey}:${path}`. */
  modeByKey: Record<string, FileViewMode>;
  /** Editor share of the split, 0..1 (clamped). */
  splitRatio: number;
  setMode: (key: string, mode: FileViewMode) => void;
  setSplitRatio: (ratio: number) => void;
}

export function buildFileViewKey(input: { persistenceKey: string; path: string }): string {
  return `${input.persistenceKey}:${input.path}`;
}

export function clampFileSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) {
    return DEFAULT_FILE_SPLIT_RATIO;
  }
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
}

function trimModeMap(modeByKey: Record<string, FileViewMode>): Record<string, FileViewMode> {
  const keys = Object.keys(modeByKey);
  if (keys.length <= MAX_REMEMBERED_MODES) {
    return modeByKey;
  }
  // Insertion order approximates recency: re-setting a key re-appends it.
  const next: Record<string, FileViewMode> = {};
  for (const key of keys.slice(keys.length - MAX_REMEMBERED_MODES)) {
    const mode = modeByKey[key];
    if (mode) {
      next[key] = mode;
    }
  }
  return next;
}

export const useFileViewStore = create<FileViewState>()(
  persist(
    (set) => ({
      modeByKey: {},
      splitRatio: DEFAULT_FILE_SPLIT_RATIO,
      setMode: (key, mode) =>
        set((state) => {
          if (state.modeByKey[key] === mode) {
            return state;
          }
          const { [key]: _removed, ...rest } = state.modeByKey;
          return { modeByKey: trimModeMap({ ...rest, [key]: mode }) };
        }),
      setSplitRatio: (ratio) => set({ splitRatio: clampFileSplitRatio(ratio) }),
    }),
    {
      name: "file-view-prefs",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

export function useFileViewMode(input: {
  persistenceKey: string | null;
  path: string;
  /** Mode used until the user picks one for this file (path-derived). */
  defaultMode: FileViewMode;
}): {
  mode: FileViewMode;
  setMode: (mode: FileViewMode) => void;
} {
  const key = input.persistenceKey
    ? buildFileViewKey({ persistenceKey: input.persistenceKey, path: input.path })
    : null;
  const mode = useFileViewStore((state) =>
    key ? (state.modeByKey[key] ?? input.defaultMode) : input.defaultMode,
  );
  const setStoreMode = useFileViewStore((state) => state.setMode);
  return {
    mode,
    setMode: (next: FileViewMode) => {
      if (key) {
        setStoreMode(key, next);
      }
    },
  };
}

/** Imperative variant for open commands ("Edit" from the explorer). */
export function setFileViewModeFor(input: {
  persistenceKey: string;
  path: string;
  mode: FileViewMode;
}): void {
  useFileViewStore
    .getState()
    .setMode(
      buildFileViewKey({ persistenceKey: input.persistenceKey, path: input.path }),
      input.mode,
    );
}
