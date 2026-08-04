import { useEffect } from "react";

import { useAppSettingValue } from "@/hooks/use-settings";
import type { AppSettings } from "@/hooks/use-settings/storage";
import { resourceMonitor } from "./resource-monitor";

const selectResourceMonitorEnabled = (settings: AppSettings) => settings.resourceMonitorEnabled;

/**
 * Binds the resource monitor to the `resourceMonitorEnabled` setting.
 *
 * The monitor is started at module scope in `app/_layout.tsx` so startup is
 * measured at all - settings live behind async storage and are not readable that
 * early. This host is what lets the user turn it back off: once settings
 * hydrate, it stops the frame loop and the census interval, and restarts them if
 * the setting is flipped back on. Headless; renders nothing.
 */
export function ResourceMonitorHost() {
  const resourceMonitorEnabled = useAppSettingValue(selectResourceMonitorEnabled);

  useEffect(() => {
    if (resourceMonitorEnabled) {
      resourceMonitor.start();
      return;
    }
    resourceMonitor.stop();
  }, [resourceMonitorEnabled]);

  return null;
}
