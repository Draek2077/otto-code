import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { i18n } from "@/i18n/i18next";
import { useSessionStore } from "@/stores/session-store";
import { selectSubagentsForParent } from "@/subagents/select";
import { isSubagentRowRunning } from "@/subagents/track-presentation";
import { confirmDialogWithCheckbox } from "@/utils/confirm-dialog";

const INTERRUPT_SUBAGENTS_WARNING_STORAGE_KEY = "interrupt-subagents-warning";

interface InterruptSubagentsWarningPrefState {
  // When true, the "Interrupting stops running subagents/workflows" confirmation
  // is suppressed and an interrupting send goes through without prompting.
  suppressed: boolean;
  setSuppressed: (suppressed: boolean) => void;
}

export const useInterruptSubagentsWarningPrefStore = create<InterruptSubagentsWarningPrefState>()(
  persist(
    (set) => ({
      suppressed: false,
      setSuppressed: (suppressed) => set({ suppressed }),
    }),
    {
      name: INTERRUPT_SUBAGENTS_WARNING_STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ suppressed: state.suppressed }),
    },
  ),
);

// Live running rows can never be pending-archive (Archive is only offered on
// terminal rows), so the count doesn't need the pending-archive exclusion set.
const NO_PENDING_ARCHIVE_IDS: ReadonlySet<string> = new Set();

/**
 * Count of live (non-terminal) provider-managed subagent/workflow rows under a
 * parent agent. These are the `attend === "observed"` rows the subagent track
 * projects; interrupting the parent's turn kills them (the provider teardown
 * settles them all to closed), which is why an interrupting send warns first.
 */
export function countLiveObservedSubagents(serverId: string, parentAgentId: string): number {
  const rows = selectSubagentsForParent(
    useSessionStore.getState(),
    { serverId, parentAgentId },
    NO_PENDING_ARCHIVE_IDS,
  );
  let count = 0;
  for (const row of rows) {
    if (row.attend === "observed" && isSubagentRowRunning(row.status)) {
      count += 1;
    }
  }
  return count;
}

/**
 * Confirms an interrupting send to a busy agent that has live observed
 * subagent/workflow rows. Resolves `true` when there is nothing live to kill,
 * the warning was previously suppressed, or the user accepts — and `false`
 * when they cancel. Mirrors `confirmArchiveChat` (the shared suppressible
 * confirm-dialog pattern): a "don't ask again" checkbox persists device-locally.
 */
export async function confirmInterruptWithLiveSubagents(input: {
  serverId: string;
  parentAgentId: string;
}): Promise<boolean> {
  const count = countLiveObservedSubagents(input.serverId, input.parentAgentId);
  if (count === 0) {
    return true;
  }
  if (useInterruptSubagentsWarningPrefStore.getState().suppressed) {
    return true;
  }

  const result = await confirmDialogWithCheckbox({
    title: i18n.t("composer.interruptSubagentsWarning.title"),
    message: i18n.t("composer.interruptSubagentsWarning.message", { count }),
    confirmLabel: i18n.t("composer.interruptSubagentsWarning.confirm"),
    cancelLabel: i18n.t("composer.interruptSubagentsWarning.cancel"),
    checkboxLabel: i18n.t("composer.interruptSubagentsWarning.suppress"),
    destructive: true,
  });

  if (result.confirmed && result.checkboxChecked) {
    useInterruptSubagentsWarningPrefStore.getState().setSuppressed(true);
  }

  return result.confirmed;
}
