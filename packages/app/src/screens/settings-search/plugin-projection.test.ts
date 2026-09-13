import { describe, expect, it } from "vitest";
import { projectPluginSettingsSearchItems, pluginSettingsSearchId } from "./plugin-projection";
const plugins = [
  { serverId: "one", id: "plugin", settingsScreens: [{ id: "settings", title: "Réglages" }] },
  { serverId: "two", id: "plugin", settingsScreens: [{ id: "settings", title: "Other host" }] },
];
describe("live plugin Settings projection", () => {
  it("uses the active host's current registration and localized title", () => {
    const [row] = projectPluginSettingsSearchItems(plugins, "one", true);
    expect(row).toMatchObject({
      title: "Réglages",
      pluginDestination: { serverId: "one", pluginId: "plugin", screenId: "settings" },
    });
    expect(projectPluginSettingsSearchItems(plugins, "one", true)).toHaveLength(1);
    expect(row.id).not.toBe(pluginSettingsSearchId("two", "plugin", "settings"));
  });
  it("removes unavailable registrations and does not invent a legacy capability", () => {
    expect(projectPluginSettingsSearchItems([], "one", true)).toEqual([]);
    expect(projectPluginSettingsSearchItems(plugins, "one", false)).toEqual([]);
    expect(projectPluginSettingsSearchItems(plugins, null, true)).toEqual([]);
  });
  it("updates title from the registry without changing route identity", () => {
    const [before] = projectPluginSettingsSearchItems(plugins, "one", true);
    const [after] = projectPluginSettingsSearchItems(
      [{ ...plugins[0], settingsScreens: [{ id: "settings", title: "Updated" }] }],
      "one",
      true,
    );
    expect(after.id).toBe(before.id);
    expect(after.title).toBe("Updated");
  });
});
