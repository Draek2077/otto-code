import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { getDesktopDaemonStatus, shouldUseDesktopDaemon } from "@/desktop/daemon/desktop-daemon";
import { i18n } from "@/i18n/i18next";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { confirmDialogWithCheckbox } from "@/utils/confirm-dialog";

const QUIT_SCHEDULES_WARNING_STORAGE_KEY = "quit-schedules-warning";

interface QuitSchedulesWarningPrefState {
  // When true, the "schedules will not run while the daemon is off" quit
  // confirmation is suppressed and quitting proceeds without prompting.
  suppressed: boolean;
  setSuppressed: (suppressed: boolean) => void;
}

export const useQuitSchedulesWarningPrefStore = create<QuitSchedulesWarningPrefState>()(
  persist(
    (set) => ({
      suppressed: false,
      setSuppressed: (suppressed) => set({ suppressed }),
    }),
    {
      name: QUIT_SCHEDULES_WARNING_STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ suppressed: state.suppressed }),
    },
  ),
);

/**
 * Count of enabled (active) schedules on the desktop-managed daemon — the host
 * the quit flow is about to stop. Resolves 0 when the local daemon can't be
 * identified or reached, so a broken lookup never blocks quitting.
 */
export async function countEnabledLocalDaemonSchedules(): Promise<number> {
  if (!shouldUseDesktopDaemon()) {
    return 0;
  }
  try {
    const status = await getDesktopDaemonStatus();
    const serverId = status.serverId.trim();
    if (!serverId) {
      return 0;
    }
    const runtime = getHostRuntimeStore();
    const snapshot = runtime.getSnapshot(serverId);
    const client = runtime.getClient(serverId);
    if (!client || snapshot?.connectionStatus !== "online") {
      return 0;
    }
    const payload = await client.scheduleList();
    if (payload.error) {
      return 0;
    }
    return payload.schedules.filter((schedule) => schedule.status === "active").length;
  } catch (error) {
    console.warn("[quit-confirm] failed to count local daemon schedules", error);
    return 0;
  }
}

/**
 * Warns that enabled schedules will not run while the daemon is off, before a
 * quit that stops the desktop-managed daemon. Resolves `true` when there are
 * no enabled schedules, the warning was previously suppressed, or the user
 * quits anyway — and `false` when they cancel. Mirrors `confirmArchiveChat`
 * (the shared suppressible confirm-dialog pattern): a "don't warn me again"
 * checkbox persists device-locally.
 */
export async function confirmQuitWithEnabledSchedules(): Promise<boolean> {
  if (useQuitSchedulesWarningPrefStore.getState().suppressed) {
    return true;
  }

  const count = await countEnabledLocalDaemonSchedules();
  if (count === 0) {
    return true;
  }

  const result = await confirmDialogWithCheckbox({
    title: i18n.t("desktop.window.quitConfirm.schedulesTitle"),
    message: i18n.t("desktop.window.quitConfirm.schedulesMessage", { count }),
    confirmLabel: i18n.t("desktop.window.quitConfirm.schedulesConfirm"),
    cancelLabel: i18n.t("desktop.window.quitConfirm.cancel"),
    checkboxLabel: i18n.t("desktop.window.quitConfirm.schedulesSuppress"),
  });

  if (result.confirmed && result.checkboxChecked) {
    useQuitSchedulesWarningPrefStore.getState().setSuppressed(true);
  }

  return result.confirmed;
}
