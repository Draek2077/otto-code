import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// Editor view preferences that persist across sessions but are toggled from
// the editor toolbar, not the settings screen. Global (not per-file): a user
// who wraps long lines wants that everywhere.

interface EditorPrefsState {
  wordWrap: boolean;
  toggleWordWrap: () => void;
  // When true, opening a file from another (linked) project no longer prompts —
  // the "Don't show this again" choice on the cross-project warning (gated-multi-root).
  suppressOutOfProjectWarning: boolean;
  setSuppressOutOfProjectWarning: (value: boolean) => void;
}

export const useEditorPrefsStore = create<EditorPrefsState>()(
  persist(
    (set) => ({
      wordWrap: false,
      toggleWordWrap: () => set((state) => ({ wordWrap: !state.wordWrap })),
      suppressOutOfProjectWarning: false,
      setSuppressOutOfProjectWarning: (value: boolean) =>
        set({ suppressOutOfProjectWarning: value }),
    }),
    {
      name: "editor-prefs",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
