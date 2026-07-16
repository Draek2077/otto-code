import { useReplicaQuery } from "@/data/query";
import { loadAppSettingsFromStorage, type AppSettings } from "@/hooks/use-settings";
import { APP_SETTINGS_QUERY_KEY } from "@/hooks/use-settings/storage";

function selectAutoClearCompletedSubagents(settings: AppSettings): boolean {
  return settings.autoClearCompletedSubagents;
}

// Reads the device-local "auto-clear completed sub-agents" preference through the
// settings query cache with a `select`, so the per-chat auto-clear driver
// (use-auto-clear-completed-subagents in subagents/) only re-runs when the flag
// actually flips — never on unrelated settings writes. Mirrors use-wrap-code-lines.ts.
export function useAutoClearCompletedSubagentsSetting(): boolean {
  const { data } = useReplicaQuery({
    queryKey: APP_SETTINGS_QUERY_KEY,
    queryFn: () => loadAppSettingsFromStorage(),
    pushEvent: "local:app-settings-write",
    select: selectAutoClearCompletedSubagents,
  });
  return data ?? false;
}
