import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { isTargetPinned, togglePinnedTarget, type PinnedTabTarget } from "@/workspace-pins/target";

interface PinnedTargetsState {
  pinned: PinnedTabTarget[];
  toggle: (target: PinnedTabTarget) => void;
  isPinned: (target: PinnedTabTarget) => boolean;
}

const DEFAULT_PINNED_TARGETS: PinnedTabTarget[] = [
  { kind: "draft" },
  { kind: "preview" },
  { kind: "terminal" },
];

function applyDefaultPinnedTargets(pinned: PinnedTabTarget[]): PinnedTabTarget[] {
  const next = [...DEFAULT_PINNED_TARGETS];
  for (const target of pinned) {
    if (!isTargetPinned(next, target)) {
      next.push(target);
    }
  }
  return next;
}

export const usePinnedTargetsStore = create<PinnedTargetsState>()(
  persist(
    (set, get) => ({
      pinned: [],
      toggle: (target) => set((state) => ({ pinned: togglePinnedTarget(state.pinned, target) })),
      isPinned: (target) => isTargetPinned(get().pinned, target),
    }),
    {
      name: "pinned-tab-targets",
      version: 2,
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<PinnedTargetsState> | null;
        return {
          ...currentState,
          ...persisted,
          pinned: persisted?.pinned ?? applyDefaultPinnedTargets([]),
        };
      },
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ pinned: state.pinned }),
      migrate: (persistedState, version) => {
        let pinned = (persistedState as { pinned?: PinnedTabTarget[] } | null)?.pinned ?? [];
        if (version === 0) {
          pinned = applyDefaultPinnedTargets(pinned);
        }
        // v2 moved "New agent" from a dedicated inline button into a pinnable
        // launcher alongside Terminal/Browser — back-fill it for anyone
        // upgrading so the button doesn't silently disappear.
        if (version < 2 && !isTargetPinned(pinned, { kind: "draft" })) {
          pinned = [{ kind: "draft" }, ...pinned];
        }
        return { pinned };
      },
    },
  ),
);
