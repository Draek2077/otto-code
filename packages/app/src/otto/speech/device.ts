import { queryClient } from "@/data/query-client";
import { APP_SETTINGS_QUERY_KEY, type AppSettings } from "@/hooks/use-settings/storage";
import { speechPreferenceDefaults } from "./preferences";
export function speechDevicePreferences() {
  return {
    ...speechPreferenceDefaults,
    ...queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY),
  };
}
