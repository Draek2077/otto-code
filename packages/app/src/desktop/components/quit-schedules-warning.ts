import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { getHostRuntimeStore } from "@/runtime/host-runtime";

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
export async function countEnabledLocalDaemonSchedules(serverId: string): Promise<number> {
  try {
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

// The quit dialog blocks on this lookup, so it must stay near-instant: with
// the serverId already cached, the only async step is one scheduleList RPC to
// the local daemon. The deadline is a fail-open safety net for a busy or hung
// daemon — better to skip an advisory warning than to stall the quit dialog.
const SCHEDULES_WARNING_DEADLINE_MS = 750;

/**
 * Number of enabled schedules the quit flow should warn about before a quit
 * that stops the desktop-managed daemon. Resolves 0 (i.e. "no warning
 * needed") when the warning was previously suppressed via
 * {@link suppressQuitSchedulesWarning}, the local daemon isn't identified,
 * there are no enabled schedules, or the lookup misses the deadline.
 *
 * `localDaemonServerId` comes from the caller's `useLocalDaemonServerId()`
 * subscription — the cached query — rather than being resolved here, because
 * resolving it fresh spawns the external CLI and takes seconds.
 */
export async function getQuitSchedulesWarningCount(
  localDaemonServerId: string | null,
): Promise<number> {
  if (!localDaemonServerId || useQuitSchedulesWarningPrefStore.getState().suppressed) {
    return 0;
  }
  return Promise.race([
    countEnabledLocalDaemonSchedules(localDaemonServerId),
    new Promise<number>((resolve) => {
      setTimeout(() => resolve(0), SCHEDULES_WARNING_DEADLINE_MS);
    }),
  ]);
}

/**
 * Persists the "don't warn me again" choice for the schedules quit warning,
 * device-locally. Mirrors `confirmArchiveChat` (the shared suppressible
 * confirm-dialog pattern).
 */
export function suppressQuitSchedulesWarning(): void {
  useQuitSchedulesWarningPrefStore.getState().setSuppressed(true);
}
