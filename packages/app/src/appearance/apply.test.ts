import { beforeEach, describe, expect, it, vi } from "vitest";
import { ICON_SIZE, ICON_SIZE_COMPACT, REGISTERED_THEMES } from "@/styles/theme";
import { applyAppearance } from "./apply";

const { runtime, updateTheme } = vi.hoisted(() => {
  const updateThemeSpy = vi.fn();
  return {
    runtime: { themeName: undefined as string | undefined, updateTheme: updateThemeSpy },
    updateTheme: updateThemeSpy,
  };
});
vi.mock("react-native-unistyles", () => ({ UnistylesRuntime: runtime }));

function fakeTheme(colorScheme: "light" | "dark" = "dark") {
  return {
    colorScheme,
    fontFamily: { ui: "seed", mono: "seed-mono" },
    fontSize: {
      xs: 12,
      sm: 14,
      base: 16,
      content: 17,
      lg: 18,
      xl: 20,
      "2xl": 22,
      "3xl": 26,
      "4xl": 34,
      code: 12,
    },
    iconSize: ICON_SIZE,
    lineHeight: { diff: 22 },
    layout: { chatMaxWidth: 820 },
    colors: { syntax: {} },
  };
}

describe("applyAppearance", () => {
  beforeEach(() => updateTheme.mockClear());

  it("patches every registered theme with one compact typography and icon scale", () => {
    applyAppearance({
      uiFontFamily: "",
      monoFontFamily: "",
      uiFontSize: 16,
      contentFontSize: 21,
      codeFontSize: 14,
      syntaxTheme: "default",
      chatWidth: "wide",
      isCompact: true,
    });
    expect(updateTheme).toHaveBeenCalledTimes(Object.keys(REGISTERED_THEMES).length);
    const updater = updateTheme.mock.calls[0]?.[1] as (
      theme: ReturnType<typeof fakeTheme>,
    ) => ReturnType<typeof fakeTheme>;
    const result = updater(fakeTheme());
    expect(result.fontSize).toMatchObject({
      xs: 14,
      sm: 16,
      base: 18,
      content: 23,
      lg: 20,
      xl: 23,
      "2xl": 25,
      "3xl": 29,
      "4xl": 38,
      code: 16,
    });
    expect(result.lineHeight.diff).toBe(24);
    expect(result.iconSize).toEqual(ICON_SIZE_COMPACT);
    expect(result.layout.chatMaxWidth).toBe(1200);
  });

  it("keeps the authored icon ladder on non-compact screens", () => {
    applyAppearance({
      uiFontFamily: "",
      monoFontFamily: "",
      uiFontSize: 16,
      contentFontSize: 17,
      codeFontSize: 12,
      syntaxTheme: "default",
      chatWidth: "default",
      isCompact: false,
    });
    const updater = updateTheme.mock.calls[0]?.[1] as (
      theme: ReturnType<typeof fakeTheme>,
    ) => ReturnType<typeof fakeTheme>;
    expect(updater(fakeTheme()).iconSize).toEqual(ICON_SIZE);
    expect(updater(fakeTheme()).fontSize).toMatchObject({ sm: 14, content: 17, code: 12 });
  });

  it("removes the chat cap for the full-width setting", () => {
    applyAppearance({
      uiFontFamily: "",
      monoFontFamily: "",
      uiFontSize: 16,
      contentFontSize: 17,
      codeFontSize: 12,
      syntaxTheme: "default",
      chatWidth: "full",
      isCompact: false,
    });
    const updater = updateTheme.mock.calls[0]?.[1] as (
      theme: ReturnType<typeof fakeTheme>,
    ) => ReturnType<typeof fakeTheme>;
    expect(updater(fakeTheme()).layout.chatMaxWidth).toBeUndefined();
  });
});
