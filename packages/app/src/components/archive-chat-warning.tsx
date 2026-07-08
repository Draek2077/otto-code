import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { i18n } from "@/i18n/i18next";
import { confirmDialogWithCheckbox } from "@/utils/confirm-dialog";

const ARCHIVE_CHAT_WARNING_STORAGE_KEY = "archive-chat-warning";

interface ArchiveChatWarningPrefState {
  // When true, the "Archiving a chat puts it in History" confirmation is
  // suppressed and closing an agent chat archives it without prompting.
  suppressed: boolean;
  setSuppressed: (suppressed: boolean) => void;
}

export const useArchiveChatWarningPrefStore = create<ArchiveChatWarningPrefState>()(
  persist(
    (set) => ({
      suppressed: false,
      setSuppressed: (suppressed) => set({ suppressed }),
    }),
    {
      name: ARCHIVE_CHAT_WARNING_STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ suppressed: state.suppressed }),
    },
  ),
);

/**
 * Confirms archiving an agent chat on close. Resolves `true` when the user
 * accepts (or has previously suppressed the warning) and `false` when they
 * cancel. Uses the shared themed confirm dialog with a "suppress next time"
 * checkbox; checking it persists the suppression.
 */
export async function confirmArchiveChat(): Promise<boolean> {
  if (useArchiveChatWarningPrefStore.getState().suppressed) {
    return true;
  }

  const result = await confirmDialogWithCheckbox({
    title: i18n.t("workspace.tabs.confirmations.archiveHistoryTitle"),
    message: i18n.t("workspace.tabs.confirmations.archiveHistoryMessage"),
    confirmLabel: i18n.t("workspace.tabs.confirmations.archive"),
    cancelLabel: i18n.t("workspace.tabs.confirmations.cancel"),
    checkboxLabel: i18n.t("workspace.tabs.confirmations.archiveHistorySuppress"),
  });

  if (result.confirmed && result.checkboxChecked) {
    useArchiveChatWarningPrefStore.getState().setSuppressed(true);
  }

  return result.confirmed;
}
