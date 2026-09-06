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
  | { kind: "root" }
  | { kind: "section"; section: SettingsSectionSlug }
  | { kind: "host"; serverId: string; section: HostSectionSlug }
  | { kind: "project"; serverId: string; projectId: string };

/** Host search results are navigated only after the caller has selected a host. */
export function buildSettingsSearchDestination(
  item: { id: string; host: boolean; section: SettingsSectionSlug | HostSectionSlug },
  serverId: string | null,
): Href {
  const target = item.host
    ? buildSettingsHostSectionRoute(serverId!, item.section as HostSectionSlug)
    : buildSettingsSectionRoute(item.section as SettingsSectionSlug, serverId ?? undefined);
  return `${target}${target.includes("?") ? "&" : "?"}setting=${encodeURIComponent(item.id)}` as Href;
}

export function openHostOverview(serverId: string): void {
  router.push(buildSettingsHostSectionRoute(serverId, "host"));
}

export function openProjectSettings(serverId: string, projectId: string): void {
  router.push(buildProjectSettingsRoute(serverId, projectId));
}

export function returnFromSettings(view: SettingsView): void {
  if (view.kind === "root") {
    if (!navigateToLastWorkspace()) {
      router.replace(buildOpenProjectRoute());
    }
    return;
  }

  const parent =
    view.kind === "project" ? buildProjectsSettingsRoute(view.serverId) : buildSettingsRoute();
  router.dismissTo(parent as Href);
}
