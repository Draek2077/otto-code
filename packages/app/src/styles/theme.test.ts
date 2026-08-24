import { describe, expect, it } from "vitest";
import {
  darkPureBlackTheme,
  daylightTheme,
  getNextThemePreference,
  SPACING,
  THEME_OPTIONS,
} from "./theme";

describe("Theme catalog", () => {
  it("owns the picker and shortcut order", () => {
    expect(THEME_OPTIONS.map((option) => option.name)).toEqual([
      "light",
      "dark",
      "auto",
      "zinc",
      "midnight",
      "claude",
      "ghostty",
      "pureBlack",
    ]);
    expect(getNextThemePreference("dark")).toBe("auto");
    expect(getNextThemePreference("pureBlack")).toBe("light");
  });
});

describe("Pure black theme", () => {
  it("uses a pure black application and terminal background", () => {
    expect(darkPureBlackTheme.colors.surface0).toBe("#000000");
    expect(darkPureBlackTheme.colors.background).toBe("#000000");
    expect(darkPureBlackTheme.colors.terminal.background).toBe("#000000");
  });

  it("uses Paseo's muted green accent", () => {
    expect(darkPureBlackTheme.colors.accent).toBe("#20744A");
    expect(darkPureBlackTheme.colors.accentBright).toBe("#7ccba0");
  });

  it("keeps selected sidebar rows distinct from the black sidebar", () => {
    expect(darkPureBlackTheme.colors.surfaceSidebar).toBe("#000000");
    // Sidebar interaction rides the one theme-accent ladder rather than a hex
    // frozen into this file, so assert the property that matters on a zero
    // luminance sidebar: the row reads as a row, and it reads as this theme's
    // accent rather than a neutral grey step.
    expect(darkPureBlackTheme.colors.surfaceSidebarHover).not.toBe(
      darkPureBlackTheme.colors.surfaceSidebar,
    );
    expect(darkPureBlackTheme.colors.surfaceSidebarHover).toBe(
      darkPureBlackTheme.colors.surfaceInteractiveHover,
    );
    expect(darkPureBlackTheme.colors.surfaceSidebarSelected).not.toBe(
      darkPureBlackTheme.colors.surfaceSidebarHover,
    );
  });

  it("keeps ANSI black output readable on its zero-luminance terminal background", () => {
    expect(darkPureBlackTheme.colors.terminal.black).toBe("#595959");
    expect(darkPureBlackTheme.colors.terminal.brightBlack).toBe("#8a8a8a");
  });
});

describe("Theme semantic contracts", () => {
  it("provides extra-muted ink, semantic status colors, and half spacing", () => {
    expect(SPACING[0.5]).toBe(2);
    expect(daylightTheme.colors.foregroundExtraMuted).toMatch(/^#/);
    expect(daylightTheme.colors.statusSuccess).toBe("#15803d");
    expect(darkPureBlackTheme.colors.statusInfo).toBe("#38bdf8");
  });
});
