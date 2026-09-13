// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppearanceProvider } from "./provider";

const fixture = vi.hoisted(() => ({
  loading: false,
  settings: {
    theme: "auto",
    pluginThemeId: "",
    colorSchemeMode: "system",
    lightTheme: "daylight",
    darkTheme: "dark",
    fontContrast: 0.5,
    uiFontFamily: "Reader",
    monoFontFamily: "Editor",
    uiFontSize: 20,
    contentFontSize: 22,
    codeFontSize: 14,
    syntaxTheme: "custom",
    chatWidth: "wide",
  },
  options: [] as Array<{ id: string; theme: { colorScheme: "dark"; revision: string } }>,
  palette: {} as Record<string, unknown>,
  events: [] as string[],
  apply: vi.fn(),
}));
vi.mock("@/hooks/use-settings", () => ({
  useAppSettings: () => ({
    settings: fixture.settings,
    isLoading: fixture.loading,
    updateSettings: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-color-scheme", () => ({ useColorScheme: () => "dark" }));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => true }));
vi.mock("@/plugins/themes", () => ({
  usePluginThemeCatalog: () => fixture.options,
  rememberPluginThemeHost: vi.fn(),
}));
vi.mock("@/styles/theme", () => ({ PLUGIN_THEME_PREFERENCE: "plugin" }));
vi.mock("@/styles/black-chat-scope", () => ({ syncBlackChatScopeVars: vi.fn() }));
vi.mock("react-native-unistyles", () => ({
  UnistylesRuntime: {
    updateTheme: (
      _key: string,
      update: (previous: Record<string, unknown>) => Record<string, unknown>,
    ) => {
      fixture.events.push("palette");
      fixture.palette = update(fixture.palette);
    },
    setAdaptiveThemes: vi.fn(),
    setTheme: vi.fn(),
  },
}));
vi.mock("./color-scheme", () => ({ applyColorScheme: () => fixture.events.push("mirrors") }));
vi.mock("./apply", () => ({ applyAppearance: fixture.apply }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.settings = { ...fixture.settings, theme: "auto", pluginThemeId: "" };
  fixture.options = [];
  fixture.loading = false;
  fixture.palette = {};
  fixture.events = [];
  fixture.apply.mockReset();
  fixture.apply.mockImplementation((preferences) => {
    fixture.events.push("preferences");
    fixture.palette = { ...fixture.palette, preferences };
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const render = () => act(async () => root.render(<AppearanceProvider>Content</AppearanceProvider>));
const contributed = (revision: string) => ({
  id: "host/plugin/dark",
  theme: { colorScheme: "dark" as const, revision },
});

describe("AppearanceProvider palette and preference ownership", () => {
  it("applies current font, syntax and compact preferences after choosing a plugin palette", async () => {
    await render();
    fixture.events = [];
    fixture.options = [contributed("first")];
    fixture.settings = { ...fixture.settings, theme: "plugin", pluginThemeId: "host/plugin/dark" };
    await render();
    expect(fixture.events).toEqual(["mirrors", "palette", "preferences"]);
    expect(fixture.palette).toEqual({
      colorScheme: "dark",
      revision: "first",
      preferences: {
        uiFontFamily: "Reader",
        monoFontFamily: "Editor",
        uiFontSize: 20,
        contentFontSize: 22,
        codeFontSize: 14,
        syntaxTheme: "custom",
        chatWidth: "wide",
        isCompact: true,
      },
    });
  });

  it("reapplies unchanged preferences when the selected plugin reloads under the same identity", async () => {
    fixture.settings = { ...fixture.settings, theme: "plugin", pluginThemeId: "host/plugin/dark" };
    fixture.options = [contributed("first")];
    await render();
    const previousPreferences = fixture.palette.preferences;
    fixture.events = [];
    fixture.options = [contributed("reloaded")];
    await render();
    expect(fixture.events).toEqual(["mirrors", "palette", "preferences"]);
    expect(fixture.palette.revision).toBe("reloaded");
    expect(fixture.palette.preferences).toEqual(previousPreferences);
  });

  it("waits for persisted settings before applying either palette or preferences", async () => {
    fixture.loading = true;
    fixture.options = [contributed("first")];
    await render();
    expect(fixture.events).toEqual([]);
    fixture.loading = false;
    await render();
    expect(fixture.events).toEqual(["mirrors", "preferences"]);
  });
});
