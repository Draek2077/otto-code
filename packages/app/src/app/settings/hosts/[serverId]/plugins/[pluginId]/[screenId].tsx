import { useMemo } from "react";

import { Redirect, useLocalSearchParams } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import SettingsScreen from "@/screens/settings-screen";
import { parsePluginSettingsView } from "@/navigation/settings-plugin-view";
import {
  buildSettingsHostSectionRoute,
  buildSettingsRoute,
  normalizeProjectSettingsRouteId,
} from "@/utils/host-routes";

export default function PluginSettingsRoute() {
  const { serverId, pluginId, screenId, setting } = useLocalSearchParams<{
    serverId?: string | string[];
    pluginId?: string | string[];
    screenId?: string | string[];
    setting?: string | string[];
  }>();
  const view = useMemo(
    () => parsePluginSettingsView({ serverId, pluginId, screenId }),
    [serverId, pluginId, screenId],
  );
  if (!view) {
    const hostId = normalizeProjectSettingsRouteId(serverId);
    return (
      <Redirect
        href={
          hostId.trim() ? buildSettingsHostSectionRoute(hostId, "plugins") : buildSettingsRoute()
        }
      />
    );
  }
  return (
    <HostRouteBootstrapBoundary>
      <SettingsScreen view={view} focusSettingId={typeof setting === "string" ? setting : null} />
    </HostRouteBootstrapBoundary>
  );
}
