import { useReplicaQuery } from "@/data/query";
import { loadAppSettingsFromStorage, type AppSettings } from "@/hooks/use-settings";
import { APP_SETTINGS_QUERY_KEY } from "@/hooks/use-settings/storage";

function selectFollowPromptSuggestions(settings: AppSettings): boolean {
  return settings.followPromptSuggestions;
}

/**
 * Reads the device-local "Follow prompt suggestions" preference through the
 * settings query cache with a `select`, so the composer's follow driver and the
 * band above it only re-run when this flag flips, never on an unrelated
 * settings write. Mirrors use-auto-clear-completed-background-tasks.ts.
 *
 * Defaults to false while the query is still loading: the feature must never
 * send a prompt on a guess.
 */
export function useFollowPromptSuggestionsSetting(): boolean {
  const { data } = useReplicaQuery({
    queryKey: APP_SETTINGS_QUERY_KEY,
    queryFn: () => loadAppSettingsFromStorage(),
    pushEvent: "local:app-settings-write",
    select: selectFollowPromptSuggestions,
  });
  return data ?? false;
}
