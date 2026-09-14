import { describe, expect, it } from "vitest";
import { SETTINGS_SEARCH_ITEMS } from "../settings-search-catalog";
import {
  PERSONALITY_SETTINGS_TABS,
  TEAM_SETTINGS_TABS,
  PROVIDER_SETTINGS_TABS,
  CONNECTOR_CATALOG_TARGETS,
  settingsEditorTab,
} from "./nested-editor-targets";

describe("nested Settings destinations", () => {
  it("opens provider tool policy search results in the Tools tab", () => {
    expect(
      settingsEditorTab(PROVIDER_SETTINGS_TABS, "host-providers-tools-enable-otto-tools"),
    ).toBe("tools");
    expect(settingsEditorTab(PROVIDER_SETTINGS_TABS, "host-providers-tools-disabled-tools")).toBe(
      "tools",
    );
  });
  it("keeps equally named fields bound to the chosen editor, with no cross-entity fallback", () => {
    expect(settingsEditorTab(TEAM_SETTINGS_TABS, "host-teams-identity-name")).toBeNull();
    expect(settingsEditorTab(PERSONALITY_SETTINGS_TABS, "host-teams-identity-name-2")).toBeNull();
    expect(settingsEditorTab(TEAM_SETTINGS_TABS, "host-teams-identity-name-2")).toBe("identity");
    expect(settingsEditorTab(PERSONALITY_SETTINGS_TABS, "host-teams-model-effort")).toBe("model");
    expect(settingsEditorTab(PERSONALITY_SETTINGS_TABS, "host-teams-voice-waiting-cue-lines")).toBe(
      "voice",
    );
    expect(settingsEditorTab(TEAM_SETTINGS_TABS, "host-teams-members-team-member")).toBe("members");
  });
  it("maps provider policy to its actual tab without mapping entity creation or destructive confirmation", () => {
    expect(
      settingsEditorTab(PROVIDER_SETTINGS_TABS, "host-providers-agents-action-breaker-threshold"),
    ).toBe("agents");
    expect(settingsEditorTab(PROVIDER_SETTINGS_TABS, "host-providers-tools-preview")).toBe("tools");
    expect(settingsEditorTab(PROVIDER_SETTINGS_TABS, "host-providers-connection-server-url")).toBe(
      "connection",
    );
    expect(settingsEditorTab(PROVIDER_SETTINGS_TABS, "host-providers-models-model-tier")).toBe(
      "models",
    );
    for (const id of [
      null,
      "host-providers-providers-add-provider",
      "host-providers-danger-zone-remove-provider",
      "constructor",
    ]) {
      expect(settingsEditorTab(PROVIDER_SETTINGS_TABS, id)).toBeNull();
    }
  });
  it("binds source connector identities despite their different display names", () => {
    expect(CONNECTOR_CATALOG_TARGETS.atlassian).toBe(
      "host-connectors-connector-catalog-jira-confluence",
    );
    expect(CONNECTOR_CATALOG_TARGETS.filesystem).toBe(
      "host-connectors-connector-catalog-local-files",
    );
    expect(CONNECTOR_CATALOG_TARGETS.memory).toBe(
      "host-connectors-connector-catalog-persistent-memory",
    );
    expect(CONNECTOR_CATALOG_TARGETS.monday).toBe("host-connectors-connector-catalog-monday-com");
    const catalog = new Set(SETTINGS_SEARCH_ITEMS.map((row) => row.id));
    for (const id of [
      ...Object.keys(PERSONALITY_SETTINGS_TABS),
      ...Object.keys(TEAM_SETTINGS_TABS),
      ...Object.keys(PROVIDER_SETTINGS_TABS),
      ...Object.values(CONNECTOR_CATALOG_TARGETS),
    ])
      expect(catalog.has(id), id).toBe(true);
  });
});
