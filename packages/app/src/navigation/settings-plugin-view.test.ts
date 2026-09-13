import { describe, expect, it } from "vitest";
import { parsePluginSettingsView } from "./settings-plugin-view";

describe("parsePluginSettingsView", () => {
  it("uses the matched local ids and preserves decoded opaque characters", () => {
    expect(
      parsePluginSettingsView({
        serverId: ["host a", "ignored"],
        pluginId: "@scope/plugin",
        screenId: "screen ?/#",
      }),
    ).toEqual({
      kind: "plugin",
      serverId: "host a",
      pluginId: "@scope/plugin",
      screenId: "screen ?/#",
    });
  });

  it("rejects incomplete routes instead of borrowing an active host", () => {
    expect(parsePluginSettingsView({ pluginId: "plugin", screenId: "screen" })).toBeNull();
    expect(
      parsePluginSettingsView({ serverId: "host", pluginId: [], screenId: "screen" }),
    ).toBeNull();
    expect(
      parsePluginSettingsView({ serverId: "host", pluginId: "plugin", screenId: " " }),
    ).toBeNull();
  });

  it("keeps identical plugin and screen ids separate on different hosts", () => {
    expect(
      parsePluginSettingsView({ serverId: "host-b", pluginId: "plugin", screenId: "screen" }),
    ).toEqual({ kind: "plugin", serverId: "host-b", pluginId: "plugin", screenId: "screen" });
  });
});
