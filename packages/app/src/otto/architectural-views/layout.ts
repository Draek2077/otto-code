import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { z } from "zod";
export function normalizeViewSplit(sizes: readonly number[] | undefined): number[] {
  if (!sizes || sizes.length !== 2 || sizes.some((value) => !Number.isFinite(value)))
    return [0.46, 0.54];
  const left = Math.max(0, sizes[0]!),
    right = Math.max(0, sizes[1]!);
  const sum = left + right;
  if (!Number.isFinite(sum) || sum <= 0) return [0.46, 0.54];
  const ratio = Math.min(0.9, Math.max(0.1, left / sum));
  return [ratio, 1 - ratio];
}
interface State {
  splitSizes: number[];
  setSplitSizes(value: number[]): void;
}
/** Preserve the exact 0.9 app-local preference identity and version. */
export const useViewLayout = create<State>()(
  persist(
    (set) => ({
      splitSizes: [0.46, 0.54],
      setSplitSizes: (value) => set({ splitSizes: normalizeViewSplit(value) }),
    }),
    {
      name: "architectural-view-authoring-layout",
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ splitSizes: state.splitSizes }),
      merge(saved, current) {
        const parsed = z.object({ splitSizes: z.array(z.number()).optional() }).safeParse(saved);
        return {
          ...current,
          splitSizes: normalizeViewSplit(parsed.success ? parsed.data.splitSizes : undefined),
        };
      },
    },
  ),
);
