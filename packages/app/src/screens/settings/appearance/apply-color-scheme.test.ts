import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BLACK_LIGHT_VARIANT_COLORS,
  DEFAULT_FONT_CONTRAST,
  darkClaudeTheme,
  darkTheme,
  daylightTheme,
  meadowTheme,
} from "@/styles/theme";
import { applyColorScheme, type ColorSchemeInput } from "./apply-color-scheme";

// These assertions are about *which variant* got painted into a mirror, not
// about any particular hex. Read the expected accent off the variant itself so
// a theme retune doesn't turn into a test edit.
const MEADOW_ACCENT = meadowTheme.colors.accent;
const EMBER_ACCENT = darkClaudeTheme.colors.accent;
const BLACK_SHERBET_ACCENT = BLACK_LIGHT_VARIANT_COLORS.pastel.accent;

// Override the global react-native-unistyles mock (vitest.setup.ts) so that
// UnistylesRuntime.updateTheme/setAdaptiveThemes/setTheme are spies that record calls.
const { updateTheme, setAdaptiveThemes, setTheme } = vi.hoisted(() => ({
  updateTheme: vi.fn(),
  setAdaptiveThemes: vi.fn(),
  setTheme: vi.fn(),
}));
vi.mock("react-native-unistyles", () => ({
  UnistylesRuntime: { updateTheme, setAdaptiveThemes, setTheme },
}));

// The signature of the updater passed to UnistylesRuntime.updateTheme.
type ThemeUpdater = (theme: FakeTheme) => FakeTheme;

// The subset of the theme shape the updater reads / spreads. The real Theme type
// is a frozen `as const` literal; the updater only touches these fields. Casting a
// fake of this shape through `unknown` to ThemeUpdater's param is test-only.
interface FakeTheme {
  colorScheme: "light" | "dark";
  colors: {
    accent: string;
    foreground: string;
    foregroundMuted: string;
    mutedForeground: string;
    primary: string;
    surface0: string;
    terminal: { foreground: string; black: string };
    syntax: Record<string, string>;
  };
  shadow: { sm: { shadowColor: string } };
}

function makeFakeTheme(colorScheme: "light" | "dark"): FakeTheme {
  return {
    colorScheme,
    colors: {
      accent: "#seed",
      foreground: "#seed-fg",
      foregroundMuted: "#seed-fg-muted",
      mutedForeground: "#seed-muted-fg",
      primary: "#seed-primary",
      surface0: "#seed-surface",
      terminal: { foreground: "#seed-term-fg", black: "#seed-term-black" },
      syntax: { base: "#seed-syntax" },
    },
    shadow: { sm: { shadowColor: "#seed-shadow" } },
  };
}

function makeInput(overrides: Partial<ColorSchemeInput> = {}): ColorSchemeInput {
  return {
    colorSchemeMode: "system",
    lightTheme: "daylight",
    darkTheme: "dark",
    systemColorScheme: "dark",
    fontContrast: DEFAULT_FONT_CONTRAST,
    ...overrides,
  };
}

// Relative luminance, good enough to assert "moved toward/away from the
// backdrop" without pinning a hex the palettes are free to retune.
function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  return 0.299 * ((value >> 16) & 0xff) + 0.587 * ((value >> 8) & 0xff) + 0.114 * (value & 0xff);
}

function findUpdater(key: "light" | "dark" | "black"): ThemeUpdater {
  const call = updateTheme.mock.calls.find((c) => c[0] === key);
  return call?.[1] as unknown as ThemeUpdater;
}

describe("applyColorScheme", () => {
  beforeEach(() => {
    updateTheme.mockClear();
    setAdaptiveThemes.mockClear();
    setTheme.mockClear();
  });

  it("repaints the light, dark, and black mirror keys exactly once, regardless of mode", () => {
    applyColorScheme(makeInput());

    expect(updateTheme).toHaveBeenCalledTimes(3);
    expect(updateTheme.mock.calls.map((call) => call[0]).sort()).toEqual([
      "black",
      "dark",
      "light",
    ]);
  });

  it("repaints the mirrors before engaging the mode", () => {
    const order: string[] = [];
    updateTheme.mockImplementation((key: string) => order.push(`repaint:${key}`));
    setAdaptiveThemes.mockImplementation(() => order.push("setAdaptiveThemes"));
    setTheme.mockImplementation((key: string) => order.push(`setTheme:${key}`));

    applyColorScheme(makeInput({ colorSchemeMode: "dark" }));

    expect(order).toEqual([
      "repaint:light",
      "repaint:dark",
      "repaint:black",
      "setAdaptiveThemes",
      "setTheme:dark",
    ]);
  });

  it("engages adaptive mode and does not pin a theme when mode is system", () => {
    applyColorScheme(makeInput({ colorSchemeMode: "system" }));

    expect(setAdaptiveThemes).toHaveBeenCalledWith(true);
    expect(setTheme).not.toHaveBeenCalled();
  });

  it("disables adaptive mode and pins the light key when mode is light", () => {
    applyColorScheme(makeInput({ colorSchemeMode: "light" }));

    expect(setAdaptiveThemes).toHaveBeenCalledWith(false);
    expect(setTheme).toHaveBeenCalledWith("light");
  });

  it("disables adaptive mode and pins the dark key when mode is dark", () => {
    applyColorScheme(makeInput({ colorSchemeMode: "dark" }));

    expect(setAdaptiveThemes).toHaveBeenCalledWith(false);
    expect(setTheme).toHaveBeenCalledWith("dark");
  });

  it("paints the light mirror with the chosen light variant's colors", () => {
    applyColorScheme(makeInput({ lightTheme: "meadow" }));

    const updater = findUpdater("light");
    const result = updater(makeFakeTheme("light"));
    expect(result.colors.accent).toBe(MEADOW_ACCENT); // meadowTheme's accent
  });

  it("paints the dark mirror with the chosen dark variant's colors", () => {
    applyColorScheme(makeInput({ darkTheme: "claude" }));

    const updater = findUpdater("dark");
    const result = updater(makeFakeTheme("dark"));
    expect(result.colors.accent).toBe(EMBER_ACCENT); // emberDarkColors' accent
  });

  it("paints the black mirror from the dark pick when the dark spectrum is active", () => {
    applyColorScheme(makeInput({ colorSchemeMode: "dark", darkTheme: "claude" }));

    const updater = findUpdater("black");
    const result = updater(makeFakeTheme("dark"));
    expect(result.colors.accent).toBe(EMBER_ACCENT); // emberDarkColors' accent
  });

  it("paints the black mirror as a dark counterpart of the light pick when light is active", () => {
    applyColorScheme(makeInput({ colorSchemeMode: "light", lightTheme: "pastel" }));

    const updater = findUpdater("black");
    const result = updater(makeFakeTheme("dark"));
    expect(result.colors.accent).toBe(BLACK_SHERBET_ACCENT); // black-Sherbet accent, not the dark pick's
  });

  it("resolves the black mirror's spectrum from the OS scheme in system mode", () => {
    applyColorScheme(
      makeInput({ colorSchemeMode: "system", systemColorScheme: "light", lightTheme: "pastel" }),
    );

    const updater = findUpdater("black");
    const result = updater(makeFakeTheme("dark"));
    expect(result.colors.accent).toBe(BLACK_SHERBET_ACCENT); // black-Sherbet accent
  });

  it("falls back to the dark spectrum for the black mirror when the OS scheme is unknown", () => {
    applyColorScheme(
      makeInput({ colorSchemeMode: "system", systemColorScheme: null, darkTheme: "claude" }),
    );

    const updater = findUpdater("black");
    const result = updater(makeFakeTheme("dark"));
    expect(result.colors.accent).toBe(EMBER_ACCENT); // emberDarkColors' accent
  });

  it("preserves the mirror's existing colors.syntax instead of overwriting it", () => {
    applyColorScheme(makeInput({ lightTheme: "meadow" }));

    const updater = findUpdater("light");
    const result = updater(makeFakeTheme("light"));
    expect(result.colors.syntax).toEqual({ base: "#seed-syntax" });
  });

  it("replaces shadow with the chosen variant's shadow, not the mirror's existing one", () => {
    applyColorScheme(makeInput({ lightTheme: "meadow" }));

    const updater = findUpdater("light");
    const result = updater(makeFakeTheme("light"));
    expect(result.shadow.sm.shadowColor).not.toBe("#seed-shadow");
  });

  it("leaves the variant's authored inks alone at the default contrast", () => {
    applyColorScheme(makeInput({ fontContrast: DEFAULT_FONT_CONTRAST }));

    const result = findUpdater("dark")(makeFakeTheme("dark"));
    expect(result.colors.foreground).toBe(darkTheme.colors.foreground);
    expect(result.colors.foregroundMuted).toBe(darkTheme.colors.foregroundMuted);
  });

  it("brightens dark reading ink toward white as contrast rises", () => {
    applyColorScheme(makeInput({ fontContrast: 1 }));

    const result = findUpdater("dark")(makeFakeTheme("dark"));
    expect(result.colors.foreground).toBe("#ffffff");
    expect(luminance(result.colors.foregroundMuted)).toBeGreaterThan(
      luminance(darkTheme.colors.foregroundMuted),
    );
  });

  it("darkens light reading ink toward black as contrast rises", () => {
    applyColorScheme(makeInput({ fontContrast: 1 }));

    const result = findUpdater("light")(makeFakeTheme("light"));
    expect(luminance(result.colors.foreground)).toBeLessThan(
      luminance(daylightTheme.colors.foreground),
    );
  });

  it("softens both inks toward the background as contrast falls", () => {
    applyColorScheme(makeInput({ fontContrast: 0 }));

    const result = findUpdater("dark")(makeFakeTheme("dark"));
    expect(luminance(result.colors.foreground)).toBeLessThan(
      luminance(darkTheme.colors.foreground),
    );
    expect(luminance(result.colors.foregroundMuted)).toBeLessThan(
      luminance(darkTheme.colors.foregroundMuted),
    );
  });

  it("keeps primary text ahead of muted text at both ends of the range", () => {
    for (const fontContrast of [0, 1]) {
      applyColorScheme(makeInput({ fontContrast }));
      const result = findUpdater("dark")(makeFakeTheme("dark"));
      expect(luminance(result.colors.foreground)).toBeGreaterThan(
        luminance(result.colors.foregroundMuted),
      );
      updateTheme.mockClear();
    }
  });

  it("carries the resolved inks into their aliases and the terminal's text", () => {
    applyColorScheme(makeInput({ fontContrast: 1 }));

    const result = findUpdater("dark")(makeFakeTheme("dark"));
    expect(result.colors.primary).toBe(result.colors.foreground);
    expect(result.colors.mutedForeground).toBe(result.colors.foregroundMuted);
    expect(result.colors.terminal.foreground).toBe(result.colors.foreground);
  });

  it("leaves the terminal's ANSI slots out of the contrast patch", () => {
    applyColorScheme(makeInput({ fontContrast: 1 }));

    const result = findUpdater("dark")(makeFakeTheme("dark"));
    expect(result.colors.terminal.black).toBe(darkTheme.colors.terminal.black);
  });

  it("pivots the black mirror on its own pure-black backdrop, not the dark variant's", () => {
    applyColorScheme(makeInput({ colorSchemeMode: "dark", fontContrast: 0 }));

    const black = findUpdater("black")(makeFakeTheme("dark"));
    const dark = findUpdater("dark")(makeFakeTheme("dark"));
    // Same slider position, deeper backdrop - the softened ink has further to
    // fall, so it must land darker than the standard dark mirror's.
    expect(luminance(black.colors.foreground)).toBeLessThan(luminance(dark.colors.foreground));
  });

  it("leaves a mirror untouched if its colorScheme narrows away (defensive branch)", () => {
    applyColorScheme(makeInput());

    const lightUpdater = findUpdater("light");
    const wrongScheme = makeFakeTheme("dark");
    expect(lightUpdater(wrongScheme)).toBe(wrongScheme);
  });
});
