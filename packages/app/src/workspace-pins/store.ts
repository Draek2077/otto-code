import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { isTargetPinned, togglePinnedTarget, type PinnedTabTarget } from "@/workspace-pins/target";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

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
const PinnedTabTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("draft") }),
  z.strictObject({ kind: z.literal("terminal") }),
  z.strictObject({ kind: z.literal("browser") }),
  z.strictObject({ kind: z.literal("profile"), profileId: z.string() }),
  z.strictObject({ kind: z.literal("preview") }),
  z.strictObject({ kind: z.literal("artifact") }),
  z.strictObject({ kind: z.literal("split-right") }),
  z.strictObject({ kind: z.literal("split-down") }),
]);
const PinnedTargetsPersistedStateSchema = z.strictObject({
  pinned: z.array(PinnedTabTargetSchema),
});

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
  persist<PinnedTargetsState, [], [], z.infer<typeof PinnedTargetsPersistedStateSchema>>(
    (set, get) => ({
      pinned: [],
      toggle: (target) => set((state) => ({ pinned: togglePinnedTarget(state.pinned, target) })),
      isPinned: (target) => isTargetPinned(get().pinned, target),
    }),
    {
      name: "pinned-tab-targets",
      version: 2,
      merge: (persistedState, currentState) => {
        const persisted = PinnedTargetsPersistedStateSchema.safeParse(persistedState);
        return {
          ...currentState,
          pinned: persisted.success ? persisted.data.pinned : applyDefaultPinnedTargets([]),
        };
      },
      storage: createValidatedPersistStorage(AsyncStorage, PinnedTargetsPersistedStateSchema),
      partialize: (state) => ({ pinned: state.pinned }),
      migrate: (persistedState, version) => {
        const result = PinnedTargetsPersistedStateSchema.safeParse(persistedState);
        let pinned = result.success ? result.data.pinned : [];
        if (version === 0) {
          pinned = applyDefaultPinnedTargets(pinned);
        }
        // v2 moved "New agent" from a dedicated inline button into a pinnable
        // launcher alongside Terminal/Browser - back-fill it for anyone
        // upgrading so the button doesn't silently disappear.
        if (version < 2 && !isTargetPinned(pinned, { kind: "draft" })) {
          pinned = [{ kind: "draft" }, ...pinned];
        }
        return { pinned };
      },
    },
  ),
);
