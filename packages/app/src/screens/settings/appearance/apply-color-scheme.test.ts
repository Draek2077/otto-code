import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyColorScheme, type ColorSchemeInput } from "./apply-color-scheme";

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
  colors: { accent: string; syntax: Record<string, string> };
  shadow: { sm: { shadowColor: string } };
}

function makeFakeTheme(colorScheme: "light" | "dark"): FakeTheme {
  return {
    colorScheme,
    colors: { accent: "#seed", syntax: { base: "#seed-syntax" } },
    shadow: { sm: { shadowColor: "#seed-shadow" } },
  };
}

function makeInput(overrides: Partial<ColorSchemeInput> = {}): ColorSchemeInput {
  return {
    colorSchemeMode: "system",
    lightTheme: "daylight",
    darkTheme: "dark",
    ...overrides,
  };
}

function findUpdater(key: "light" | "dark"): ThemeUpdater {
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
    expect(result.colors.accent).toBe("#20744A"); // meadowTheme's accent
  });

  it("paints the dark mirror with the chosen dark variant's colors", () => {
    applyColorScheme(makeInput({ darkTheme: "claude" }));

    const updater = findUpdater("dark");
    const result = updater(makeFakeTheme("dark"));
    expect(result.colors.accent).toBe("#d96b45"); // emberDarkColors' accent
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

  it("leaves a mirror untouched if its colorScheme narrows away (defensive branch)", () => {
    applyColorScheme(makeInput());

    const lightUpdater = findUpdater("light");
    const wrongScheme = makeFakeTheme("dark");
    expect(lightUpdater(wrongScheme)).toBe(wrongScheme);
  });
});
