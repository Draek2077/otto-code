import AsyncStorage from "@react-native-async-storage/async-storage";
import { readOttoSettingsRecovery } from "@/otto/storage-continuity";
import { ContextHealthPreferences } from "./health-model";
let preferences: ContextHealthPreferences | undefined;
export function contextHealthPreferences() {
  return (preferences ??= new ContextHealthPreferences({
    getItem: (key) => AsyncStorage.getItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value),
    async legacyEnabled() {
      // COMPAT(context09Warnings): added v0.10.0; review after 2027-04-26. Read the preserved choice without rewriting the original settings.
      const previous = await readOttoSettingsRecovery(AsyncStorage);
      return typeof previous?.contextWarningsEnabled === "boolean"
        ? previous.contextWarningsEnabled
        : undefined;
    },
  }));
}
