import { buildSettingsHostSectionRoute } from "@/utils/host-routes";

export function getWakeWordSettingsRoute(serverId: string) {
  return buildSettingsHostSectionRoute(serverId, "agents");
}
