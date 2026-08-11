import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** A Brain split can move one quarter of the available space either side of centre. */
export const BRAIN_SPLIT_MIN_RATIO = 0.25;
export const BRAIN_SPLIT_MAX_RATIO = 0.75;
export const DEFAULT_BRAIN_SPLIT_RATIO = 0.5;

export function normalizeBrainSplitRatio(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_BRAIN_SPLIT_RATIO;
  }
  return Math.min(BRAIN_SPLIT_MAX_RATIO, Math.max(BRAIN_SPLIT_MIN_RATIO, value));
}

interface BrainLayoutState {
  modelsSplitRatio: number;
  benchmarksSplitRatio: number;
  benchmarkTablesSplitRatio: number;
  setModelsSplitRatio: (ratio: number) => void;
  setBenchmarksSplitRatio: (ratio: number) => void;
  setBenchmarkTablesSplitRatio: (ratio: number) => void;
}

// These are app-local reading preferences, not facts about a brain host or its
// models. One remembered layout should follow the user between every Brain tab.
export const useBrainLayoutStore = create<BrainLayoutState>()(
  persist(
    (set) => ({
      modelsSplitRatio: DEFAULT_BRAIN_SPLIT_RATIO,
      benchmarksSplitRatio: DEFAULT_BRAIN_SPLIT_RATIO,
      benchmarkTablesSplitRatio: DEFAULT_BRAIN_SPLIT_RATIO,
      setModelsSplitRatio: (ratio) => set({ modelsSplitRatio: normalizeBrainSplitRatio(ratio) }),
      setBenchmarksSplitRatio: (ratio) =>
        set({ benchmarksSplitRatio: normalizeBrainSplitRatio(ratio) }),
      setBenchmarkTablesSplitRatio: (ratio) =>
        set({ benchmarkTablesSplitRatio: normalizeBrainSplitRatio(ratio) }),
    }),
    {
      name: "brain-layout",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        modelsSplitRatio: state.modelsSplitRatio,
        benchmarksSplitRatio: state.benchmarksSplitRatio,
        benchmarkTablesSplitRatio: state.benchmarkTablesSplitRatio,
      }),
      version: 1,
      merge: (persisted, current) => {
        const saved = persisted as Partial<BrainLayoutState> | undefined;
        return {
          ...current,
          modelsSplitRatio: normalizeBrainSplitRatio(saved?.modelsSplitRatio),
          benchmarksSplitRatio: normalizeBrainSplitRatio(saved?.benchmarksSplitRatio),
          benchmarkTablesSplitRatio: normalizeBrainSplitRatio(saved?.benchmarkTablesSplitRatio),
        };
      },
    },
  ),
);
