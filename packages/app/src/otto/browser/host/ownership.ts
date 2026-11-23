import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMemo, useSyncExternalStore } from "react";
import { HostBrowserBindings } from "./bindings";
export const hostBrowserBindings = new HostBrowserBindings(AsyncStorage);
// Local close intent prevents an older metadata reply from resurrecting a tab.
// It contains no tab metadata and does not replace either canonical registry.
export const retiredHostBrowsers = new Set<string>();
export function useHostBrowserBinding(browserId: string) {
  const resource = useMemo(() => hostBrowserBindings.resource(browserId), [browserId]);
  return useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);
}
