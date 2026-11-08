import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SchedulesSettings } from "@getpaseo/plugin/client/otto-schedules";
/** Schedules keeps Paseo's existing navigation entry. Only the missing category
 * settings are contributed; no duplicate sidebar or workspace tab is added. */
export default function contribute(client: PluginClientContext) {
  return client.addSettingsScreen({
    id: "schedules",
    title: "Schedules",
    icon: "CalendarClock",
    Component: SchedulesSettings,
  });
}
