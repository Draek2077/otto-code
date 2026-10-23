import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
export const BRAIN_SPLIT_MIN_RATIO = 0.25;
export const BRAIN_SPLIT_MAX_RATIO = 0.75;
export const DEFAULT_BRAIN_SPLIT_RATIO = 0.5;
export function normalizeBrainSplitRatio(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_BRAIN_SPLIT_RATIO;
  return Math.min(BRAIN_SPLIT_MAX_RATIO, Math.max(BRAIN_SPLIT_MIN_RATIO, value));
}
interface BrainLayoutState {
  modelsSplitRatio: number;
  benchmarksSplitRatio: number;
  benchmarkTablesSplitRatio: number;
  setModelsSplitRatio: (value: number) => void;
  setBenchmarksSplitRatio: (value: number) => void;
  setBenchmarkTablesSplitRatio: (value: number) => void;
}
function readLayout(saved: unknown) {
  const record = typeof saved === "object" && saved !== null ? saved : {};
  return {
    modelsSplitRatio: normalizeBrainSplitRatio(
      "modelsSplitRatio" in record ? record.modelsSplitRatio : undefined,
    ),
    benchmarksSplitRatio: normalizeBrainSplitRatio(
      "benchmarksSplitRatio" in record ? record.benchmarksSplitRatio : undefined,
    ),
    benchmarkTablesSplitRatio: normalizeBrainSplitRatio(
      "benchmarkTablesSplitRatio" in record ? record.benchmarkTablesSplitRatio : undefined,
    ),
  };
}
/** App-local reading preferences. Keep this exact identity; no migration or reset. */
export const useBrainLayoutStore = create<BrainLayoutState>()(
  persist(
    (set) => ({
      modelsSplitRatio: DEFAULT_BRAIN_SPLIT_RATIO,
      benchmarksSplitRatio: DEFAULT_BRAIN_SPLIT_RATIO,
      benchmarkTablesSplitRatio: DEFAULT_BRAIN_SPLIT_RATIO,
      setModelsSplitRatio: (value) => set({ modelsSplitRatio: normalizeBrainSplitRatio(value) }),
      setBenchmarksSplitRatio: (value) =>
        set({ benchmarksSplitRatio: normalizeBrainSplitRatio(value) }),
      setBenchmarkTablesSplitRatio: (value) =>
        set({ benchmarkTablesSplitRatio: normalizeBrainSplitRatio(value) }),
    }),
    {
      name: "brain-layout",
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ modelsSplitRatio, benchmarksSplitRatio, benchmarkTablesSplitRatio }) => ({
        modelsSplitRatio,
        benchmarksSplitRatio,
        benchmarkTablesSplitRatio,
      }),
      merge: (saved, current) => ({ ...current, ...readLayout(saved) }),
    },
  ),
);
