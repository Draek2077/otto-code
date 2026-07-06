import { beforeEach, describe, expect, it, vi } from "vitest";
import { darkHighlightColors, resolveSyntaxColors } from "@otto-code/highlight";
import { DEFAULT_UI_FONT_STACK } from "@/styles/theme";
import { applyAppearance, type AppearanceInput } from "./apply-appearance";

// Override the global react-native-unistyles mock (vitest.setup.ts) so that
// UnistylesRuntime.updateTheme is a spy that records (themeName, updater) calls.
const { updateTheme } = vi.hoisted(() => ({ updateTheme: vi.fn() }));
vi.mock("react-native-unistyles", () => ({ UnistylesRuntime: { updateTheme } }));

// The registered Unistyles theme keys, in the order applyAppearance patches them.
const ALL_THEME_KEYS = ["light", "dark", "black"] as const;

// The signature of the updater passed to UnistylesRuntime.updateTheme.
type ThemeUpdater = (theme: FakeTheme) => FakeTheme;

// The subset of the theme shape the updater reads / spreads. The real Theme type
// is a frozen `as const` literal; the updater only touches these fields. Casting a
// fake of this shape through `unknown` to ThemeUpdater's param is test-only.
interface FakeTheme {
  colorScheme: "light" | "dark";
  fontFamily: { ui: string; mono: string };
  fontSize: {
    xs: number;
    code: number;
    sm: number;
    base: number;
    lg: number;
    xl: number;
    "2xl": number;
    "3xl": number;
    "4xl": number;
  };
  lineHeight: { diff: number };
  layout: { chatMaxWidth: number | undefined };
  colors: { foreground: string; syntax: Record<string, string> };
  iconSize: { xs: number; sm: number; md: number; lg: number };
}

function makeFakeTheme(): FakeTheme {
  return {
    colorScheme: "dark",
    fontFamily: { ui: "seed-ui-stack", mono: "seed-mono-stack" },
    fontSize: {
      xs: 12,
      code: 12,
      sm: 14,
      base: 16,
      lg: 18,
      xl: 20,
      "2xl": 22,
      "3xl": 26,
      "4xl": 34,
    },
    lineHeight: { diff: 22 },
    layout: { chatMaxWidth: 820 },
    colors: { foreground: "#fff", syntax: {} },
    iconSize: { xs: 12, sm: 14, md: 16, lg: 20 },
  };
}

function makeInput(overrides: Partial<AppearanceInput> = {}): AppearanceInput {
  return {
    uiFontFamily: "",
    monoFontFamily: "",
    uiFontSize: 16,
    codeFontSize: 12,
    syntaxTheme: "default",
    chatWidth: "default",
    isCompact: false,
    ...overrides,
  };
}

// Run a single captured updater (default the first) against a fresh fake theme.
function runCapturedUpdater(call = 0): FakeTheme {
  const updater = updateTheme.mock.calls[call]?.[1] as unknown as ThemeUpdater;
  return updater(makeFakeTheme());
}

describe("applyAppearance", () => {
  beforeEach(() => {
    updateTheme.mockClear();
  });

  it("patches every registered Unistyles theme exactly once", () => {
    applyAppearance(makeInput());

    expect(updateTheme).toHaveBeenCalledTimes(3);
    expect(updateTheme.mock.calls.map((call) => call[0])).toEqual([...ALL_THEME_KEYS]);
  });

  it("resolves an empty UI font family to the default stack", () => {
    applyAppearance(makeInput({ uiFontFamily: "" }));

    expect(runCapturedUpdater().fontFamily.ui).toBe(DEFAULT_UI_FONT_STACK);
  });

  it("passes a non-empty UI font family through trimmed", () => {
    applyAppearance(makeInput({ uiFontFamily: "  Menlo  " }));

    expect(runCapturedUpdater().fontFamily.ui).toBe("Menlo");
  });

  it("scales the whole UI ramp proportionally while preserving ratios", () => {
    applyAppearance(makeInput({ uiFontSize: 14 }));

    const { fontSize } = runCapturedUpdater();
    // r = 14 / 16 = 0.875
    expect(fontSize.base).toBe(14); // round(16 * 0.875)
    expect(fontSize.lg).toBe(16); // round(18 * 0.875) = round(15.75)
    expect(fontSize.xs).toBe(11); // round(12 * 0.875) = round(10.5)
    expect(fontSize["4xl"]).toBe(30); // round(34 * 0.875) = round(29.75)
  });

  it("derives the UI ramp from the canonical sizes, not the live theme (no compounding)", () => {
    applyAppearance(makeInput({ uiFontSize: 14 }));

    // Simulate a theme whose fontSize was already scaled by a prior apply; the
    // updater must ignore it and rebuild from the authored FONT_SIZE ramp.
    const updater = updateTheme.mock.calls[0]?.[1] as unknown as ThemeUpdater;
    const alreadyScaled = makeFakeTheme();
    alreadyScaled.fontSize = {
      xs: 4,
      code: 4,
      sm: 4,
      base: 4,
      lg: 4,
      xl: 4,
      "2xl": 4,
      "3xl": 4,
      "4xl": 4,
    };

    const { fontSize } = updater(alreadyScaled);
    expect(fontSize.base).toBe(14); // not 4 * 0.875 — rebuilt from FONT_SIZE
    expect(fontSize.lg).toBe(16);
  });

  it("leaves the UI ramp at authored sizes when only the code size changes", () => {
    applyAppearance(makeInput({ uiFontSize: 16, codeFontSize: 10 }));

    const { fontSize } = runCapturedUpdater();
    expect(fontSize.base).toBe(16);
    expect(fontSize.sm).toBe(14);
    expect(fontSize.code).toBe(10);
  });

  it("sets fontSize.code to codeFontSize regardless of the UI font size", () => {
    applyAppearance(makeInput({ uiFontSize: 14, codeFontSize: 18 }));

    expect(runCapturedUpdater().fontSize.code).toBe(18);
  });

  it("couples lineHeight.diff to the code font size", () => {
    applyAppearance(makeInput({ codeFontSize: 18 }));

    expect(runCapturedUpdater().lineHeight.diff).toBe(Math.round(18 * 1.5)); // 27
  });

  it("swaps colors.syntax to the resolved palette for the named theme", () => {
    applyAppearance(makeInput({ syntaxTheme: "nightshade" }));

    const { colors } = runCapturedUpdater();
    expect(colors.syntax).toEqual(resolveSyntaxColors("nightshade", "dark"));
  });

  it("resolves a syntax theme using the theme's own color scheme", () => {
    applyAppearance(makeInput({ syntaxTheme: "github" }));

    // makeFakeTheme().colorScheme === "dark" -> github resolves to the dark palette.
    expect(runCapturedUpdater().colors.syntax).toEqual(darkHighlightColors);
    expect(runCapturedUpdater().colors.syntax).toEqual(resolveSyntaxColors("github", "dark"));
  });

  it.each([
    ["default", 820],
    ["wide", 1200],
    ["full", undefined],
  ] as const)("resolves chatWidth %s to chatMaxWidth %s", (chatWidth, expected) => {
    applyAppearance(makeInput({ chatWidth }));

    expect(runCapturedUpdater().layout.chatMaxWidth).toBe(expected);
  });

  it("leaves iconSize at authored values when not compact", () => {
    applyAppearance(makeInput({ isCompact: false }));

    expect(runCapturedUpdater().iconSize).toEqual({ xs: 12, sm: 14, md: 16, lg: 20 });
  });

  it("doubles every iconSize token when compact", () => {
    applyAppearance(makeInput({ isCompact: true }));

    expect(runCapturedUpdater().iconSize).toEqual({ xs: 24, sm: 28, md: 32, lg: 40 });
  });

  it("bumps the interface font size by 2px before scaling the ramp when compact", () => {
    applyAppearance(makeInput({ uiFontSize: 14, isCompact: true }));

    // effective uiSize = 14 + 2 = 16 -> r = 1.0 -> ramp at authored values.
    expect(runCapturedUpdater().fontSize.base).toBe(16);
  });

  it("bumps a non-default interface font size by 2px when compact, preserving ratios", () => {
    applyAppearance(makeInput({ uiFontSize: 16, isCompact: true }));

    // effective uiSize = 16 + 2 = 18 -> r = 1.125
    const { fontSize } = runCapturedUpdater();
    expect(fontSize.base).toBe(18); // round(16 * 1.125)
    expect(fontSize.sm).toBe(16); // round(14 * 1.125) = round(15.75)
  });

  it("does not bump the interface font size when not compact", () => {
    applyAppearance(makeInput({ uiFontSize: 16, isCompact: false }));

    expect(runCapturedUpdater().fontSize.base).toBe(16);
  });

  it("bumps the code (mono) font size by 2px when compact", () => {
    applyAppearance(makeInput({ codeFontSize: 12, isCompact: true }));

    expect(runCapturedUpdater().fontSize.code).toBe(14);
  });

  it("does not bump the code (mono) font size when not compact", () => {
    applyAppearance(makeInput({ codeFontSize: 12, isCompact: false }));

    expect(runCapturedUpdater().fontSize.code).toBe(12);
  });

  it("couples lineHeight.diff to the compact-bumped code font size", () => {
    applyAppearance(makeInput({ codeFontSize: 12, isCompact: true }));

    expect(runCapturedUpdater().lineHeight.diff).toBe(Math.round(14 * 1.5)); // 21
  });
});
