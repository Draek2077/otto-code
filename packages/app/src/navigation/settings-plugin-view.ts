import type { SettingsView } from "./settings-navigation";
import { normalizeProjectSettingsRouteId } from "@/utils/host-routes";

type RouteParam = string | string[] | undefined;

/** Dynamic Settings ids come from this matched leaf, never global route state. */
export function parsePluginSettingsView(params: {
  serverId?: RouteParam;
  pluginId?: RouteParam;
  screenId?: RouteParam;
}): Extract<SettingsView, { kind: "plugin" }> | null {
  const serverId = normalizeProjectSettingsRouteId(params.serverId);
  const pluginId = normalizeProjectSettingsRouteId(params.pluginId);
  const screenId = normalizeProjectSettingsRouteId(params.screenId);
  if (!serverId.trim() || !pluginId.trim() || !screenId.trim()) return null;
  return { kind: "plugin", serverId, pluginId, screenId };
}
