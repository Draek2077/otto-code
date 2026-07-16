import { useReplicaQuery } from "@/data/query";
import { loadAppSettingsFromStorage, type AppSettings } from "@/hooks/use-settings";
import { APP_SETTINGS_QUERY_KEY } from "@/hooks/use-settings/storage";

function selectWrapCodeLines(settings: AppSettings): boolean {
  return settings.wrapCodeLines;
}

// Reads the device-local "wrap long code lines" preference through the settings
// query cache with a `select`, so subscribers (every tool-call detail block in a
// chat stream) only re-render when the flag actually flips — never on unrelated
// settings writes, and never per streamed chunk. Do NOT swap this for
// useAppSettings() in hot chat components; that observer notifies on every
// settings change. Mirrors use-text-effect-theme.ts.
export function useWrapCodeLines(): boolean {
  const { data } = useReplicaQuery({
    queryKey: APP_SETTINGS_QUERY_KEY,
    queryFn: () => loadAppSettingsFromStorage(),
    // Replica semantics fit exactly: the cache is written in place by
    // saveAppSettings (setQueryData) rather than refetched. The "push" here is
    // that local write, not a daemon event.
    pushEvent: "local:app-settings-write",
    select: selectWrapCodeLines,
  });
  return data ?? true;
}
