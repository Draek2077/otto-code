import { buildPluginSettingsRoute } from "@/plugins/settings/routes";
import { router, type Href } from "expo-router";
import { navigateToLastWorkspace } from "@/stores/navigation-active-workspace-store";
import {
  buildOpenProjectRoute,
  buildProjectSettingsRoute,
  buildProjectsSettingsRoute,
  buildSettingsHostSectionRoute,
  buildSettingsRoute,
  buildSettingsSectionRoute,
  type HostSectionSlug,
  type SettingsSectionSlug,
} from "@/utils/host-routes";

export type SettingsView =
  | { kind: "plugin"; serverId: string; pluginId: string; screenId: string }
  | { kind: "root" }
  | { kind: "section"; section: SettingsSectionSlug }
  | { kind: "host"; serverId: string; section: HostSectionSlug }
  | { kind: "project"; serverId: string; projectId: string };

/** Host search results are navigated only after the caller has selected a host. */
export function buildSettingsSearchDestination(
  item: {
    id: string;
    host: boolean;
    section: SettingsSectionSlug | HostSectionSlug;
    pluginDestination?: { serverId: string; pluginId: string; screenId: string };
  },
  serverId: string | null,
): Href {
  if (item.pluginDestination) {
    const { serverId: host, pluginId, screenId } = item.pluginDestination;
    const route = buildPluginSettingsRoute(host, pluginId, screenId);
    return { ...route, params: { ...route.params, setting: item.id } };
  }
  const target = item.host
    ? buildSettingsHostSectionRoute(serverId!, item.section as HostSectionSlug)
    : buildSettingsSectionRoute(item.section as SettingsSectionSlug, serverId ?? undefined);
  return `${target}${target.includes("?") ? "&" : "?"}setting=${encodeURIComponent(item.id)}` as Href;
}

export function openHostOverview(serverId: string): void {
  router.push(buildSettingsHostSectionRoute(serverId, "host"));
}

export function openProjectSettings(
  serverId: string,
  projectId: string,
  settingId?: string | null,
): void {
  const route = buildProjectSettingsRoute(serverId, projectId);
  router.push(settingId ? (`${route}?setting=${encodeURIComponent(settingId)}` as Href) : route);
}

export function returnFromSettings(view: SettingsView): void {
  if (view.kind === "root") {
    if (!navigateToLastWorkspace()) {
      router.replace(buildOpenProjectRoute());
    }
    return;
  }

  let parent: Href = buildSettingsRoute();
  if (view.kind === "plugin") parent = buildSettingsHostSectionRoute(view.serverId, "plugins");
  if (view.kind === "project") parent = buildProjectsSettingsRoute(view.serverId);
  router.dismissTo(parent as Href);
}
