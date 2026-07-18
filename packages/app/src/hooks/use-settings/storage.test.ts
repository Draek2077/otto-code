import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  APP_SETTINGS_KEY,
  DEFAULT_APP_SETTINGS,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_CODE_FONT_SIZE,
  DEFAULT_UI_FONT_SIZE,
  loadAppSettingsFromStorage,
  loadSettingsFromStorage,
  parseClampedFontSize,
  parseTerminalScrollbackLines,
  saveAppSettings,
  type SettingsDeps,
} from "./storage";
import { createFakeDesktopBridge, createInMemoryKeyValueStorage } from "./fakes";

const LEGACY_SETTINGS_KEY = "@otto:settings";

function makeDeps(
  overrides: {
    storage?: ReturnType<typeof createInMemoryKeyValueStorage>;
    desktop?: ReturnType<typeof createFakeDesktopBridge>;
  } = {},
): SettingsDeps & {
  storage: ReturnType<typeof createInMemoryKeyValueStorage>;
  desktop: ReturnType<typeof createFakeDesktopBridge>;
} {
  return {
    storage: overrides.storage ?? createInMemoryKeyValueStorage(),
    desktop: overrides.desktop ?? createFakeDesktopBridge(),
  };
}

describe("loadAppSettingsFromStorage", () => {
  it("defaults color scheme mode to system when storage is empty", async () => {
    const deps = makeDeps();

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.colorSchemeMode).toBe("system");
    expect(result.lightTheme).toBe("daylight");
    expect(result.darkTheme).toBe("dark");
  });

  it("seeds storage with the client defaults when nothing is persisted", async () => {
    const deps = makeDeps();

    const result = await loadAppSettingsFromStorage(deps);

    expect(result).toEqual(DEFAULT_CLIENT_SETTINGS);
    expect(DEFAULT_CLIENT_SETTINGS.language).toBe("system");
    expect(deps.storage.entries.get(APP_SETTINGS_KEY)).toBe(
      JSON.stringify(DEFAULT_CLIENT_SETTINGS),
    );
  });

  it("defaults language to system when storage is empty", async () => {
    const deps = makeDeps();

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.language).toBe("system");
  });

  it("defaults workspace title source to title when storage is empty", async () => {
    const deps = makeDeps();

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.workspaceTitleSource).toBe("title");
  });

  it("loads configured terminal scrollback lines from app settings", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ terminalScrollbackLines: 42_000 }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.terminalScrollbackLines).toBe(42_000);
  });

  it("loads configured workspace title source from app settings", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ workspaceTitleSource: "branch" }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.workspaceTitleSource).toBe("branch");
  });

  it("drops an unknown workspace title source back to title", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ workspaceTitleSource: "directory" }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.workspaceTitleSource).toBe("title");
  });

  it("defaults chat width to default when storage is empty", async () => {
    const deps = makeDeps();

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.chatWidth).toBe("default");
  });

  it("defaults featureEnabled to an empty map when storage is empty", async () => {
    const deps = makeDeps();

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.featureEnabled).toEqual({});
  });

  it("loads an explicit disabled feature flag from app settings", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ featureEnabled: { visualizer: false } }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.featureEnabled).toEqual({ visualizer: false });
  });

  it("drops a non-object featureEnabled back to the empty default", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ featureEnabled: ["visualizer"] }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.featureEnabled).toEqual({});
  });

  it("drops unknown keys and non-boolean values from featureEnabled", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({
          featureEnabled: { visualizer: "yes", bogusFeature: true },
        }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.featureEnabled).toEqual({});
  });

  it("loads configured chat width from app settings", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ chatWidth: "wide" }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.chatWidth).toBe("wide");
  });

  it("drops an unknown chat width back to default", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ chatWidth: "cinematic" }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.chatWidth).toBe("default");
  });

  it("defaults tab orientation to horizontal when storage is empty", async () => {
    const deps = makeDeps();

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.defaultTabOrientation).toBe("horizontal");
  });

  it("loads configured default tab orientation from app settings", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ defaultTabOrientation: "vertical" }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.defaultTabOrientation).toBe("vertical");
  });

  it("drops an unknown default tab orientation back to horizontal", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ defaultTabOrientation: "diagonal" }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.defaultTabOrientation).toBe("horizontal");
  });

  it("normalizes terminal scrollback lines from storage", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ terminalScrollbackLines: 1_000_000.9 }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.terminalScrollbackLines).toBe(1_000_000);
  });

  it("migrates the legacy theme key into the new settings object", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [LEGACY_SETTINGS_KEY]: JSON.stringify({
          theme: "dark",
          manageBuiltInDaemon: false,
          releaseChannel: "beta",
        }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result).toEqual({
      ...DEFAULT_CLIENT_SETTINGS,
      colorSchemeMode: "dark",
      darkTheme: "dark",
      // Upgrader from the legacy key: backfilled so it never sees the tour or wizard.
      hasCompletedTutorial: true,
      hasCompletedSetupWizard: true,
    });
    expect(deps.storage.entries.get(APP_SETTINGS_KEY)).toBe(JSON.stringify(result));
  });

  it("loads a persisted explicit language", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ language: "zh-CN" }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.language).toBe("zh-CN");
  });

  it("drops an unknown persisted language back to system", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ language: "klingon" }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.language).toBe("system");
  });
});

describe("corrupt persisted settings self-heal", () => {
  it("resets to defaults and rewrites storage when the blob is unparseable", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        // Truncated write, e.g. an interrupted upgrade — JSON.parse throws.
        [APP_SETTINGS_KEY]: '{"chatWidth":"wide",',
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result).toEqual(DEFAULT_CLIENT_SETTINGS);
    expect(deps.storage.entries.get(APP_SETTINGS_KEY)).toBe(
      JSON.stringify(DEFAULT_CLIENT_SETTINGS),
    );
  });

  it("resets to defaults when the blob parses to a non-object", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify(["not", "an", "object"]),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result).toEqual(DEFAULT_CLIENT_SETTINGS);
    expect(deps.storage.entries.get(APP_SETTINGS_KEY)).toBe(
      JSON.stringify(DEFAULT_CLIENT_SETTINGS),
    );
  });

  it("falls back to defaults when only a corrupt legacy blob exists", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [LEGACY_SETTINGS_KEY]: "}not json{",
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result).toEqual(DEFAULT_CLIENT_SETTINGS);
    expect(deps.storage.entries.get(APP_SETTINGS_KEY)).toBe(
      JSON.stringify(DEFAULT_CLIENT_SETTINGS),
    );
  });
});

describe("migrating a persisted `theme` field (current AppSettings schema)", () => {
  it("maps auto to system mode", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ theme: "auto" }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.colorSchemeMode).toBe("system");
  });

  it("folds the retired plain light theme into daylight", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ theme: "light" }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.colorSchemeMode).toBe("light");
    expect(result.lightTheme).toBe("daylight");
  });

  it("maps a light variant name to light mode with that variant", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ theme: "meadow" }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.colorSchemeMode).toBe("light");
    expect(result.lightTheme).toBe("meadow");
  });

  it("maps the plain dark theme to dark mode", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ theme: "dark" }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.colorSchemeMode).toBe("dark");
    expect(result.darkTheme).toBe("dark");
  });

  it("maps a dark variant name to dark mode with that variant", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ theme: "ghostty" }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.colorSchemeMode).toBe("dark");
    expect(result.darkTheme).toBe("ghostty");
  });

  it("does not re-run when the new fields are already present", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({
          theme: "ghostty", // stale leftover from before migration; must be ignored
          colorSchemeMode: "light",
          lightTheme: "meadow",
          darkTheme: "claude",
        }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.colorSchemeMode).toBe("light");
    expect(result.lightTheme).toBe("meadow");
    expect(result.darkTheme).toBe("claude");
  });
});

describe("loadSettingsFromStorage", () => {
  it("defaults built-in daemon management to enabled when storage is empty", async () => {
    const deps = makeDeps();

    const result = await loadSettingsFromStorage(deps);

    expect(result).toEqual(DEFAULT_APP_SETTINGS);
  });

  it("defaults release channel to stable when storage is empty", async () => {
    const deps = makeDeps();

    const result = await loadSettingsFromStorage(deps);

    expect(result.releaseChannel).toBe("stable");
  });

  it("ignores renderer-owned daemon management state outside Electron", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({
          theme: "light",
          manageBuiltInDaemon: false,
        }),
      }),
    });

    const result = await loadSettingsFromStorage(deps);

    expect(result).toEqual({
      ...DEFAULT_APP_SETTINGS,
      colorSchemeMode: "light",
      lightTheme: "daylight",
      hasCompletedTutorial: true,
      hasCompletedSetupWizard: true,
    });
  });

  it("ignores renderer-owned release channel outside Electron", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ releaseChannel: "beta" }),
      }),
    });

    const result = await loadSettingsFromStorage(deps);

    expect(result.releaseChannel).toBe("stable");
  });

  it("migrates legacy desktop-owned settings through the bridge before reading effective settings", async () => {
    const desktop = createFakeDesktopBridge({
      isElectron: true,
      settings: {
        releaseChannel: "beta",
        daemon: { manageBuiltInDaemon: false, keepRunningAfterQuit: true },
        tray: { minimizeOnClose: true, startMinimized: false },
        quit: { warnBeforeQuit: false, onlyWarnForActiveAgents: false },
      },
    });
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({
          theme: "light",
          manageBuiltInDaemon: false,
          releaseChannel: "beta",
        }),
      }),
      desktop,
    });

    const result = await loadSettingsFromStorage(deps);

    expect(desktop.migrationsApplied).toEqual([
      { manageBuiltInDaemon: false, releaseChannel: "beta" },
    ]);
    expect(result).toEqual({
      ...DEFAULT_APP_SETTINGS,
      colorSchemeMode: "light",
      lightTheme: "daylight",
      manageBuiltInDaemon: false,
      releaseChannel: "beta",
      hasCompletedTutorial: true,
      hasCompletedSetupWizard: true,
    });
  });

  it("does not call the desktop bridge outside Electron", async () => {
    const desktop = createFakeDesktopBridge({ isElectron: false });
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ theme: "light" }),
      }),
      desktop,
    });

    const result = await loadSettingsFromStorage(deps);

    expect(desktop.migrationsApplied).toEqual([]);
    expect(result).toEqual({
      ...DEFAULT_APP_SETTINGS,
      colorSchemeMode: "light",
      lightTheme: "daylight",
      hasCompletedTutorial: true,
      hasCompletedSetupWizard: true,
    });
  });
});

describe("saveAppSettings", () => {
  it("saves terminal scrollback through app settings persistence", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify(DEFAULT_CLIENT_SETTINGS),
      }),
    });
    const queryClient = new QueryClient();

    await saveAppSettings({
      queryClient,
      updates: { terminalScrollbackLines: 42_000 },
      deps,
    });

    expect(deps.storage.entries.get(APP_SETTINGS_KEY)).toBe(
      JSON.stringify({
        ...DEFAULT_CLIENT_SETTINGS,
        terminalScrollbackLines: 42_000,
      }),
    );
  });
});

describe("parseTerminalScrollbackLines", () => {
  it("clamps negative values to the minimum and rejects non-numeric strings", () => {
    expect(parseTerminalScrollbackLines("-10")).toBe(0);
    expect(parseTerminalScrollbackLines("abc")).toBeNull();
  });
});

describe("appearance settings", () => {
  it("defaults the appearance fields when an old blob omits them", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ theme: "dark" }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.uiFontFamily).toBe("");
    expect(result.monoFontFamily).toBe("");
    expect(result.uiFontSize).toBe(DEFAULT_UI_FONT_SIZE);
    expect(result.codeFontSize).toBe(DEFAULT_CODE_FONT_SIZE);
    expect(result.syntaxTheme).toBe("default");
  });

  it("defaults hide-pinned-toolbar-options to false when omitted", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ theme: "dark" }),
      }),
    });

    expect((await loadAppSettingsFromStorage(deps)).hidePinnedToolbarOptions).toBe(false);
  });

  it("loads a persisted hide-pinned-toolbar-options preference", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ hidePinnedToolbarOptions: true }),
      }),
    });

    expect((await loadAppSettingsFromStorage(deps)).hidePinnedToolbarOptions).toBe(true);
  });

  it("defaults hide-chat-message-details to true when omitted", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ theme: "dark" }),
      }),
    });

    expect((await loadAppSettingsFromStorage(deps)).hideChatMessageDetails).toBe(true);
  });

  it("loads a persisted hide-chat-message-details preference", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ hideChatMessageDetails: false }),
      }),
    });

    expect((await loadAppSettingsFromStorage(deps)).hideChatMessageDetails).toBe(false);
  });

  it("defaults chat-timestamp-display to absolute and rejects unknown values", async () => {
    const omitted = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ theme: "dark" }),
      }),
    });
    expect((await loadAppSettingsFromStorage(omitted)).chatTimestampDisplay).toBe("absolute");

    const invalid = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ chatTimestampDisplay: "sundial" }),
      }),
    });
    expect((await loadAppSettingsFromStorage(invalid)).chatTimestampDisplay).toBe("absolute");
  });

  it("loads a persisted chat-timestamp-display preference", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ chatTimestampDisplay: "relative" }),
      }),
    });

    expect((await loadAppSettingsFromStorage(deps)).chatTimestampDisplay).toBe("relative");
  });

  it("defaults chat-bubble-gradient to on and loads a persisted off value", async () => {
    const omitted = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ theme: "dark" }),
      }),
    });
    expect((await loadAppSettingsFromStorage(omitted)).chatBubbleGradient).toBe(true);

    const disabled = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ chatBubbleGradient: false }),
      }),
    });
    expect((await loadAppSettingsFromStorage(disabled)).chatBubbleGradient).toBe(false);
  });

  it("clamps the UI font size into range and rejects non-numeric values", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ uiFontSize: 999 }),
      }),
    });
    expect((await loadAppSettingsFromStorage(deps)).uiFontSize).toBe(22);

    const low = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ uiFontSize: 8 }),
      }),
    });
    expect((await loadAppSettingsFromStorage(low)).uiFontSize).toBe(12);

    const bogus = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ uiFontSize: "abc" }),
      }),
    });
    expect((await loadAppSettingsFromStorage(bogus)).uiFontSize).toBe(DEFAULT_UI_FONT_SIZE);
  });

  it("clamps the code font size into range and rejects non-numeric values", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ codeFontSize: 999 }),
      }),
    });
    expect((await loadAppSettingsFromStorage(deps)).codeFontSize).toBe(22);

    const low = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ codeFontSize: 8 }),
      }),
    });
    expect((await loadAppSettingsFromStorage(low)).codeFontSize).toBe(12);

    const bogus = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ codeFontSize: "abc" }),
      }),
    });
    expect((await loadAppSettingsFromStorage(bogus)).codeFontSize).toBe(DEFAULT_CODE_FONT_SIZE);
  });

  it("trims an accepted font family", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ uiFontFamily: "  Menlo  " }),
      }),
    });

    expect((await loadAppSettingsFromStorage(deps)).uiFontFamily).toBe("Menlo");
  });

  it("keeps an explicit empty font family as the default sentinel", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ uiFontFamily: "" }),
      }),
    });

    expect((await loadAppSettingsFromStorage(deps)).uiFontFamily).toBe("");
  });

  it("rejects a font family containing CSS-breaking characters", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ uiFontFamily: "a;b{c}" }),
      }),
    });

    expect((await loadAppSettingsFromStorage(deps)).uiFontFamily).toBe("");
  });

  it("rejects an over-length font family", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ uiFontFamily: "a".repeat(201) }),
      }),
    });

    expect((await loadAppSettingsFromStorage(deps)).uiFontFamily).toBe("");
  });

  it("accepts a known syntax theme id", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ syntaxTheme: "nightshade" }),
      }),
    });

    expect((await loadAppSettingsFromStorage(deps)).syntaxTheme).toBe("nightshade");
  });

  it("drops a removed syntax theme id back to the default", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ syntaxTheme: "auto" }),
      }),
    });

    expect((await loadAppSettingsFromStorage(deps)).syntaxTheme).toBe("default");
  });

  it("drops an unknown syntax theme id back to the default", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ syntaxTheme: "bogus" }),
      }),
    });

    expect((await loadAppSettingsFromStorage(deps)).syntaxTheme).toBe("default");
  });
});

describe("one-time tutorial flag", () => {
  it("defaults hasCompletedTutorial to false on a genuinely fresh install", async () => {
    const deps = makeDeps();

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.hasCompletedTutorial).toBe(false);
  });

  it("backfills hasCompletedTutorial to true for an existing device missing the field", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ theme: "dark" }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.hasCompletedTutorial).toBe(true);
  });

  it("backfills hasCompletedTutorial to true when migrating from the legacy settings key", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [LEGACY_SETTINGS_KEY]: JSON.stringify({ theme: "dark" }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.hasCompletedTutorial).toBe(true);
  });

  it("preserves an explicitly persisted hasCompletedTutorial value", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ hasCompletedTutorial: false }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.hasCompletedTutorial).toBe(false);
  });
});

describe("interface mode", () => {
  it("defaults interfaceMode to null on a fresh install (unchosen)", async () => {
    const deps = makeDeps();

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.interfaceMode).toBeNull();
  });

  it("loads a persisted interface mode", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ interfaceMode: "user" }),
      }),
    });

    expect((await loadAppSettingsFromStorage(deps)).interfaceMode).toBe("user");
  });

  it("drops an unknown interface mode back to null", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ interfaceMode: "wizard" }),
      }),
    });

    expect((await loadAppSettingsFromStorage(deps)).interfaceMode).toBeNull();
  });

  it("keeps an existing device (no interfaceMode) as null so it resolves to developer", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ theme: "dark" }),
      }),
    });

    expect((await loadAppSettingsFromStorage(deps)).interfaceMode).toBeNull();
  });
});

describe("app start screen", () => {
  it("defaults appStartScreen to 'workspaces' on a fresh install", async () => {
    const deps = makeDeps();

    expect((await loadAppSettingsFromStorage(deps)).appStartScreen).toBe("workspaces");
  });

  it("loads a persisted app start screen", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ appStartScreen: "dashboard" }),
      }),
    });

    expect((await loadAppSettingsFromStorage(deps)).appStartScreen).toBe("dashboard");
  });

  it("drops an unknown app start screen back to the 'workspaces' default", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ appStartScreen: "everywhere" }),
      }),
    });

    expect((await loadAppSettingsFromStorage(deps)).appStartScreen).toBe("workspaces");
  });
});

describe("suggested tasks enabled", () => {
  it("defaults suggestedTasksEnabled to true on a fresh install", async () => {
    const deps = makeDeps();

    expect((await loadAppSettingsFromStorage(deps)).suggestedTasksEnabled).toBe(true);
  });

  it("loads a persisted suggestedTasksEnabled=false", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ suggestedTasksEnabled: false }),
      }),
    });

    expect((await loadAppSettingsFromStorage(deps)).suggestedTasksEnabled).toBe(false);
  });

  it("drops a non-boolean suggestedTasksEnabled back to the true default", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ suggestedTasksEnabled: "nope" }),
      }),
    });

    expect((await loadAppSettingsFromStorage(deps)).suggestedTasksEnabled).toBe(true);
  });
});

describe("suggested tasks default mode", () => {
  it("defaults suggestedTasksDefaultMode to 'new_chat' on a fresh install", async () => {
    const deps = makeDeps();

    expect((await loadAppSettingsFromStorage(deps)).suggestedTasksDefaultMode).toBe("new_chat");
  });

  it("loads a persisted suggested tasks default mode", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ suggestedTasksDefaultMode: "worktree" }),
      }),
    });

    expect((await loadAppSettingsFromStorage(deps)).suggestedTasksDefaultMode).toBe("worktree");
  });

  it("drops an unknown suggested tasks default mode back to 'new_chat'", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ suggestedTasksDefaultMode: "telepathy" }),
      }),
    });

    expect((await loadAppSettingsFromStorage(deps)).suggestedTasksDefaultMode).toBe("new_chat");
  });
});

describe("one-time setup-wizard flag", () => {
  it("defaults hasCompletedSetupWizard to false on a genuinely fresh install", async () => {
    const deps = makeDeps();

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.hasCompletedSetupWizard).toBe(false);
  });

  it("backfills hasCompletedSetupWizard to true for an existing device missing the field", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ theme: "dark" }),
      }),
    });

    expect((await loadAppSettingsFromStorage(deps)).hasCompletedSetupWizard).toBe(true);
  });

  it("backfills hasCompletedSetupWizard to true when migrating from the legacy settings key", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [LEGACY_SETTINGS_KEY]: JSON.stringify({ theme: "dark" }),
      }),
    });

    expect((await loadAppSettingsFromStorage(deps)).hasCompletedSetupWizard).toBe(true);
  });

  it("preserves an explicitly persisted hasCompletedSetupWizard value", async () => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ hasCompletedSetupWizard: false }),
      }),
    });

    expect((await loadAppSettingsFromStorage(deps)).hasCompletedSetupWizard).toBe(false);
  });
});

describe("parseClampedFontSize", () => {
  it("clamps to the bounds and rejects non-numeric strings", () => {
    expect(parseClampedFontSize(999, { min: 11, max: 24 })).toBe(24);
    expect(parseClampedFontSize(8, { min: 11, max: 24 })).toBe(11);
    expect(parseClampedFontSize("15", { min: 11, max: 24 })).toBe(15);
    expect(parseClampedFontSize("abc", { min: 11, max: 24 })).toBeNull();
  });
});
