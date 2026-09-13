import type { SidebarNavPreference } from "@/sidebar-nav/model";
import type { OpenInSidePanePreferences } from "./storage";

export type PullRequestOpenLocation = "main" | "side" | "explorer";

export interface OttoNavigationSettings {
  sidebarNavItems: SidebarNavPreference[];
  pullRequestOpenLocation: PullRequestOpenLocation;
}

export const DEFAULT_OTTO_NAVIGATION_SETTINGS: OttoNavigationSettings = {
  sidebarNavItems: [],
  // Otto's seven source-specific destination controls default to the main pane.
  // Adding Explorer as a PR destination does not change a saved or fresh default.
  pullRequestOpenLocation: "main",
};

const OPEN_SOURCES = [
  "explorerFiles",
  "explorerChanges",
  "chatFiles",
  "diffFiles",
  "subagents",
  "pullRequests",
  "changesLinks",
] as const;

export function pickOttoNavigationSettings(stored: {
  sidebarNavItems?: unknown;
  pullRequestOpenLocation?: unknown;
  openInSidePane?: unknown;
}): Partial<OttoNavigationSettings> & { openInSidePane?: OpenInSidePanePreferences } {
  const result: Partial<OttoNavigationSettings> & { openInSidePane?: OpenInSidePanePreferences } =
    {};
  if (
    Array.isArray(stored.sidebarNavItems) &&
    stored.sidebarNavItems.every(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        typeof item.key === "string" &&
        typeof item.visible === "boolean",
    )
  ) {
    result.sidebarNavItems = stored.sidebarNavItems.map(({ key, visible }) => ({ key, visible }));
  }
  if (
    stored.openInSidePane &&
    typeof stored.openInSidePane === "object" &&
    !Array.isArray(stored.openInSidePane)
  ) {
    const value = stored.openInSidePane as Record<string, unknown>;
    result.openInSidePane = {
      explorerFiles: false,
      explorerChanges: false,
      chatFiles: false,
      diffFiles: false,
      subagents: false,
      pullRequests: false,
      changesLinks: false,
    };
    for (const key of OPEN_SOURCES) {
      const setting = value[key];
      if (typeof setting === "boolean") result.openInSidePane[key] = setting;
    }
  }
  const destination = stored.pullRequestOpenLocation;
  if (destination === "main" || destination === "side" || destination === "explorer") {
    result.pullRequestOpenLocation = destination;
  } else if (result.openInSidePane) {
    // COMPAT(ottoPullRequestDestination): added in v0.9.10;
    // remove after 2027-03-13 once all supported app builds persist the new field.
    result.pullRequestOpenLocation = result.openInSidePane.pullRequests ? "side" : "main";
  }
  return result;
}
