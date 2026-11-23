import React, { lazy, Suspense } from "react";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsRow } from "@/components/settings";

const Settings = lazy(async () => ({
  default: (await import("./settings-entry")).SchedulesSettings,
}));
const loading = <SettingsRow label="Loading Schedules..." />;
/** The trusted plugin namespace does not eagerly load the operational editor or
 * storage forms into every consumer of the app's plugin evaluator. */
export function SchedulesSettings(props: PluginSurfaceProps) {
  return (
    <Suspense fallback={loading}>
      <Settings {...props} />
    </Suspense>
  );
}
