import { describe, expect, it } from "vitest";
import {
  darkPureBlackTheme,
  daylightTheme,
  getNextThemePreference,
  SPACING,
  THEME_OPTIONS,
  darkTheme,
  FONT_SIZE,
  lightTheme,
} from "./theme";

describe("Typography scale", () => {
  // Otto's scale, which is a tier larger than upstream's throughout and adds an
  // `xs` step. Locked here so a token edit is a deliberate one.
  it("names 16px as the default interface tier", () => {
    expect(FONT_SIZE).toEqual({
      xs: 12,
      code: 12,
      sm: 14,
      base: 16,
      content: 17,
      lg: 18,
      xl: 20,
      "2xl": 22,
      "3xl": 26,
      "4xl": 34,
    });
  });
});

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

  it("uses Otto's muted green accent", () => {
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

describe("Sidebar interaction surfaces", () => {
  // Otto derives these from the one theme-accent ladder, not the neutral
  // surface scale, so a hovered row reads as this theme rather than as grey.
  it.each([lightTheme, darkTheme])("derive from the theme-accent ladder", (theme) => {
    expect(theme.colors.surfaceSidebarHover).toBe(theme.colors.surfaceInteractiveHover);
    expect(theme.colors.surfaceSidebarSelected).not.toBe(theme.colors.surfaceSidebarHover);
    expect(theme.colors.surfaceSidebarHover).not.toBe(theme.colors.surfaceSidebar);
  });
});

describe("Built-in light theme", () => {
  it("preserves its authored aliases and terminal contrast through the semantic builder", () => {
    // Otto's light theme is warm-tinted rather than upstream's neutral zinc,
    // so its ink and terminal blacks carry the same warmth as its surfaces.
    expect(lightTheme.colors).toMatchObject({
      primary: "#26262b",
      primaryForeground: "#faf8f4",
      destructiveForeground: "#ffffff",
      successForeground: "#ffffff",
      terminal: {
        black: "#26262b",
      },
    });
  });
});
