import AsyncStorage from "@react-native-async-storage/async-storage";
import { ContextLayoutPreferences } from "./layout-preferences";
let preferences: ContextLayoutPreferences | undefined;
/** Constructed on entry; reading layout does not touch host/project configuration. */
export function contextLayoutPreferences() {
  return (preferences ??= new ContextLayoutPreferences(AsyncStorage));
}
