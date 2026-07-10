import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { i18n } from "@/i18n/i18next";
import { confirmDialogWithCheckbox } from "@/utils/confirm-dialog";

const PROJECT_SEARCH_REPLACE_WARNING_STORAGE_KEY = "project-search-replace-warning";

// Below this many selected matches, replace runs without confirmation.
const CONFIRM_THRESHOLD = 10;
// At or above this many selected matches, confirmation is mandatory every
// time and the "don't ask again" checkbox is withheld — too large a blast
// radius to let the user suppress the warning.
const ALWAYS_CONFIRM_THRESHOLD = 200;

interface ProjectSearchReplaceWarningPrefState {
  // When true, the bulk-replace confirmation is suppressed for selections
  // below ALWAYS_CONFIRM_THRESHOLD.
  suppressed: boolean;
  setSuppressed: (suppressed: boolean) => void;
}

export const useProjectSearchReplaceWarningPrefStore =
  create<ProjectSearchReplaceWarningPrefState>()(
    persist(
      (set) => ({
        suppressed: false,
        setSuppressed: (suppressed) => set({ suppressed }),
      }),
      {
        name: PROJECT_SEARCH_REPLACE_WARNING_STORAGE_KEY,
        storage: createJSONStorage(() => AsyncStorage),
        partialize: (state) => ({ suppressed: state.suppressed }),
      },
    ),
  );

/**
 * Confirms a project-wide search-and-replace before it runs. Selections
 * under {@link CONFIRM_THRESHOLD} matches proceed without prompting.
 * Selections at or above it show the themed confirm dialog with a "don't ask
 * again" checkbox — unless the user has already suppressed it. Selections at
 * or above {@link ALWAYS_CONFIRM_THRESHOLD} always prompt and never offer the
 * checkbox, since replacing that many matches can't be undone.
 */
export async function confirmBulkReplace(input: {
  matches: number;
  files: number;
}): Promise<boolean> {
  const { matches, files } = input;
  if (matches < CONFIRM_THRESHOLD) {
    return true;
  }

  const allowSuppress = matches < ALWAYS_CONFIRM_THRESHOLD;
  if (allowSuppress && useProjectSearchReplaceWarningPrefStore.getState().suppressed) {
    return true;
  }

  const result = await confirmDialogWithCheckbox({
    title: i18n.t("projectSearch.replaceDialogTitle"),
    message: i18n.t("projectSearch.replaceDialogMessage", { matches, files }),
    confirmLabel: i18n.t("projectSearch.replaceDialogConfirm"),
    cancelLabel: i18n.t("editor.cancel"),
    destructive: true,
    checkboxLabel: allowSuppress ? i18n.t("projectSearch.replaceDialogSuppress") : undefined,
  });

  if (result.confirmed && allowSuppress && result.checkboxChecked) {
    useProjectSearchReplaceWarningPrefStore.getState().setSuppressed(true);
  }

  return result.confirmed;
}
