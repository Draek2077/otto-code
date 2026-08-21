import { afterEach, describe, expect, it } from "vitest";
import {
  getLastSettingsRoute,
  rememberLastSettingsView,
  resetLastSettingsRoute,
  settingsViewRoute,
} from "@/stores/last-settings-view";

afterEach(() => {
  resetLastSettingsRoute();
});

describe("settingsViewRoute", () => {
  it("maps app-section views to their route", () => {
    expect(settingsViewRoute({ kind: "section", section: "appearance" })).toBe(
      "/settings/appearance",
    );
  });

  it("maps host-section views to their scoped route", () => {
    expect(settingsViewRoute({ kind: "host", serverId: "srv1", section: "providers" })).toBe(
      "/settings/hosts/srv1/providers",
    );
  });

  it("maps a single project", () => {
    expect(settingsViewRoute({ kind: "project", serverId: "host-a", projectId: "proj1" })).toBe(
      "/settings/hosts/host-a/projects/proj1",
    );
  });

  it("returns null for the root list and for empty ids", () => {
    expect(settingsViewRoute({ kind: "root" })).toBeNull();
    expect(settingsViewRoute({ kind: "host", serverId: "", section: "providers" })).toBeNull();
    expect(settingsViewRoute({ kind: "project", serverId: "", projectId: "" })).toBeNull();
  });
});

describe("rememberLastSettingsView", () => {
  it("remembers the last non-root view", () => {
    rememberLastSettingsView({ kind: "section", section: "diagnostics" });
    expect(getLastSettingsRoute()).toBe("/settings/diagnostics");
  });

  it("keeps the prior route when handed a root view", () => {
    rememberLastSettingsView({ kind: "section", section: "about" });
    rememberLastSettingsView({ kind: "root" });
    expect(getLastSettingsRoute()).toBe("/settings/about");
  });

  it("starts empty", () => {
    expect(getLastSettingsRoute()).toBeNull();
  });
});
