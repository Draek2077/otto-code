import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// Editor view preferences that persist across sessions but are toggled from
// the editor toolbar, not the settings screen. Global (not per-file): a user
// who wraps long lines wants that everywhere.

interface EditorPrefsState {
  wordWrap: boolean;
  toggleWordWrap: () => void;
  /**
   * Hide markdown markers except on the line being edited.
   *
   * Defaults ON, unlike every other preference here. Live preview is the point
   * of editing markdown in a markdown editor rather than a text editor, and a
   * feature nobody discovers is a feature nobody has. The toolbar toggle is one
   * tap away for anyone who wants the raw source back.
   */
  markdownLivePreview: boolean;
  toggleMarkdownLivePreview: () => void;
}

export const useEditorPrefsStore = create<EditorPrefsState>()(
  persist(
    (set) => ({
      wordWrap: false,
      toggleWordWrap: () => set((state) => ({ wordWrap: !state.wordWrap })),
      markdownLivePreview: true,
      toggleMarkdownLivePreview: () =>
        set((state) => ({ markdownLivePreview: !state.markdownLivePreview })),
    }),
    {
      name: "editor-prefs",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
