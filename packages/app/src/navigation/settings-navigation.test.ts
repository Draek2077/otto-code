import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  dismissTo: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  navigateToLastWorkspace: vi.fn(() => true),
}));
vi.mock("expo-router", () => ({ router: navigation }));
vi.mock("@/stores/navigation-active-workspace-store", () => ({
  navigateToLastWorkspace: navigation.navigateToLastWorkspace,
}));

import {
  buildSettingsSearchDestination,
  openProjectSettings,
  returnFromSettings,
} from "./settings-navigation";

beforeEach(() => {
  vi.clearAllMocks();
  navigation.navigateToLastWorkspace.mockReturnValue(true);
});

describe("Settings navigation ownership", () => {
  it("returns plugin detail to the exact host Plugins page", () => {
    returnFromSettings({
      kind: "plugin",
      serverId: "host a",
      pluginId: "same",
      screenId: "screen",
    });
    expect(navigation.dismissTo).toHaveBeenCalledWith("/settings/hosts/host%20a/plugins");
    expect(navigation.navigateToLastWorkspace).not.toHaveBeenCalled();
  });

  it("keeps app detail Back at the overview and root Back at the remembered workspace", () => {
    returnFromSettings({ kind: "section", section: "chat" });
    expect(navigation.dismissTo).toHaveBeenCalledWith("/settings");
    returnFromSettings({ kind: "root" });
    expect(navigation.navigateToLastWorkspace).toHaveBeenCalledOnce();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("keeps the project parent distinct from plugin detail", () => {
    returnFromSettings({ kind: "project", serverId: "host-a", projectId: "project" });
    expect(navigation.dismissTo).toHaveBeenCalledWith("/settings/hosts/host-a/projects");
  });

  it("keeps the selected host and canonical row on App search destinations", () => {
    expect(
      buildSettingsSearchDestination(
        { id: "app-row", host: false, section: "integrations" },
        "host a",
      ),
    ).toBe("/settings/integrations?host=host%20a&setting=app-row");
  });
  it("routes a registry result using the registration host, even if the picker later changes", () => {
    expect(
      buildSettingsSearchDestination(
        {
          id: "stable-id",
          host: true,
          section: "plugins",
          pluginDestination: { serverId: "host a", pluginId: "one/two", screenId: "screen" },
        },
        "different-host",
      ),
    ).toEqual({
      pathname: "/settings/hosts/[serverId]/plugins/[pluginId]/[screenId]",
      params: { serverId: "host a", pluginId: "one/two", screenId: "screen", setting: "stable-id" },
    });
  });
  it("carries the row through the user's project selection without changing normal project navigation", () => {
    openProjectSettings("host", "project", "row");
    expect(navigation.push).toHaveBeenLastCalledWith(
      "/settings/hosts/host/projects/project?setting=row",
    );
    openProjectSettings("host", "project");
    expect(navigation.push).toHaveBeenLastCalledWith("/settings/hosts/host/projects/project");
  });
});
