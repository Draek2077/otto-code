import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  DEFAULT_PINNED_PROJECT_SEARCH_TOOLBAR_ITEMS,
  PROJECT_SEARCH_TOOLBAR_ITEM_IDS,
  type ProjectSearchToolbarItemId,
} from "@/components/project-search-toolbar-items";
import { togglePinnedToolbarItem } from "@/components/ui/pinnable-toolbar";

/**
 * How the Search pane presents results: whether long hits wrap, and which
 * toolbar options are pinned out of the ▾ menu.
 *
 * Device-local and global, like the Changes pane's own preferences (see
 * @/hooks/use-changes-preferences) and the tab bar's pins: a developer arranges
 * this once and expects the next search to read the same way.
 */

interface ProjectSearchPreferencesState {
  wrapLines: boolean;
  pinnedToolbarItems: ProjectSearchToolbarItemId[];
  toggleWrapLines: () => void;
  toggleToolbarPin: (id: ProjectSearchToolbarItemId) => void;
}

/** Drops ids a newer build has retired, so a stale pin cannot orphan the strip. */
export function normalizePinnedProjectSearchToolbarItems(
  pinned: readonly string[] | undefined,
): ProjectSearchToolbarItemId[] {
  if (!pinned) {
    return [...DEFAULT_PINNED_PROJECT_SEARCH_TOOLBAR_ITEMS];
  }
  return PROJECT_SEARCH_TOOLBAR_ITEM_IDS.filter((id) => pinned.includes(id));
}

export const useProjectSearchPreferencesStore = create<ProjectSearchPreferencesState>()(
  persist(
    (set) => ({
      wrapLines: false,
      pinnedToolbarItems: [...DEFAULT_PINNED_PROJECT_SEARCH_TOOLBAR_ITEMS],
      toggleWrapLines: () => set((state) => ({ wrapLines: !state.wrapLines })),
      toggleToolbarPin: (id) =>
        set((state) => ({
          pinnedToolbarItems: togglePinnedToolbarItem(state.pinnedToolbarItems, id),
        })),
    }),
    {
      name: "project-search-preferences",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        wrapLines: state.wrapLines,
        pinnedToolbarItems: state.pinnedToolbarItems,
      }),
      version: 1,
      merge: (persisted, current) => {
        const stored = persisted as
          | { wrapLines?: boolean; pinnedToolbarItems?: string[] }
          | undefined;
        return {
          ...current,
          wrapLines: stored?.wrapLines ?? current.wrapLines,
          pinnedToolbarItems: normalizePinnedProjectSearchToolbarItems(stored?.pinnedToolbarItems),
        };
      },
    },
  ),
);
