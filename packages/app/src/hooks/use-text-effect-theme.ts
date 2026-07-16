import { useReplicaQuery } from "@/data/query";
import { loadAppSettingsFromStorage, type AppSettings } from "@/hooks/use-settings";
import { APP_SETTINGS_QUERY_KEY } from "@/hooks/use-settings/storage";
import { DEFAULT_TEXT_EFFECT_THEME, type TextEffectThemeId } from "@/styles/text-effects";

function selectTextEffectTheme(settings: AppSettings): TextEffectThemeId {
  return settings.textEffectTheme;
}

// Reads the device-local text-effect theme through the settings query cache
// with a `select`, so subscribers (every ExpandableBadge in a chat stream)
// only re-render when the picked theme actually changes — never on unrelated
// settings writes, and never per frame. Do NOT swap this for useAppSettings()
// in hot chat components; that observer notifies on every settings change.
export function useTextEffectThemeId(): TextEffectThemeId {
  const { data } = useReplicaQuery({
    queryKey: APP_SETTINGS_QUERY_KEY,
    queryFn: () => loadAppSettingsFromStorage(),
    // Replica semantics fit exactly: the cache is written in place by
    // saveAppSettings (setQueryData) rather than refetched. The "push" here is
    // that local write, not a daemon event.
    pushEvent: "local:app-settings-write",
    select: selectTextEffectTheme,
  });
  return data ?? DEFAULT_TEXT_EFFECT_THEME;
}
