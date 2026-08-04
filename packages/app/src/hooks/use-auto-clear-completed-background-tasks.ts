import { useReplicaQuery } from "@/data/query";
import { loadAppSettingsFromStorage, type AppSettings } from "@/hooks/use-settings";
import { APP_SETTINGS_QUERY_KEY } from "@/hooks/use-settings/storage";

function selectAutoClearCompletedBackgroundTasks(settings: AppSettings): boolean {
  return settings.autoClearCompletedBackgroundTasks;
}

function selectAutoClearFailedBackgroundTasks(settings: AppSettings): boolean {
  return settings.autoClearFailedBackgroundTasks;
}

// Reads the device-local "auto-clear completed background tasks" preference
// through the settings query cache with a `select`, so the per-chat auto-clear
// driver (use-auto-clear-completed-background-tasks in background-tasks/) only
// re-runs when the flag actually flips - never on unrelated settings writes.
// Mirrors use-auto-clear-completed-subagents.ts.
export function useAutoClearCompletedBackgroundTasksSetting(): boolean {
  const { data } = useReplicaQuery({
    queryKey: APP_SETTINGS_QUERY_KEY,
    queryFn: () => loadAppSettingsFromStorage(),
    pushEvent: "local:app-settings-write",
    select: selectAutoClearCompletedBackgroundTasks,
  });
  return data ?? false;
}

// Same, for the track's "Failed" group. A separate preference, so its own hook
// and its own `select` (a shared one would re-run both drivers on either flip).
export function useAutoClearFailedBackgroundTasksSetting(): boolean {
  const { data } = useReplicaQuery({
    queryKey: APP_SETTINGS_QUERY_KEY,
    queryFn: () => loadAppSettingsFromStorage(),
    pushEvent: "local:app-settings-write",
    select: selectAutoClearFailedBackgroundTasks,
  });
  return data ?? false;
}
