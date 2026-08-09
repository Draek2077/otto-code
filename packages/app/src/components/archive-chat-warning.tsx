import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { i18n } from "@/i18n/i18next";
import { confirmDialogWithCheckbox } from "@/utils/confirm-dialog";

const ARCHIVE_CHAT_WARNING_STORAGE_KEY = "archive-chat-warning";

interface ArchiveChatWarningPrefState {
  // When true, closing an agent chat archives it without prompting. Delete is
  // never suppressed.
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
 * Resolves the explicit chat-management choice made while closing a tab. A
 * suppressed warning always means Archive, never Delete.
 */
export async function confirmCloseChat(input?: {
  /** A running chat always needs an explicit archive decision. */
  forcePrompt?: boolean;
}): Promise<"archive" | "delete" | "cancel"> {
  if (!input?.forcePrompt && useArchiveChatWarningPrefStore.getState().suppressed) {
    return "archive";
  }

  const result = await confirmDialogWithCheckbox({
    title: i18n.t("workspace.tabs.confirmations.archiveHistoryTitle"),
    message: i18n.t("workspace.tabs.confirmations.archiveHistoryMessage"),
    confirmLabel: i18n.t("workspace.tabs.confirmations.archive"),
    cancelLabel: i18n.t("workspace.tabs.confirmations.cancel"),
    alternateLabel: i18n.t("workspace.tabs.confirmations.delete"),
    alternateDestructive: true,
    checkboxLabel: i18n.t("workspace.tabs.confirmations.archiveHistorySuppress"),
  });

  if (result.choice === "confirm" && result.checkboxChecked) {
    useArchiveChatWarningPrefStore.getState().setSuppressed(true);
  }

  if (result.choice === "confirm") return "archive";
  if (result.choice === "alternate") return "delete";
  return "cancel";
}
