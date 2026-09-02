import { beforeEach, describe, expect, it, vi } from "vitest";
import { ICON_SIZE, REGISTERED_THEMES } from "@/styles/theme";
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

  it("patches every registered theme and keeps the icon ladder authored on compact screens", () => {
    applyAppearance({
      uiFontFamily: "",
      monoFontFamily: "",
      uiFontSize: 16,
      contentFontSize: 21,
      codeFontSize: 14,
      syntaxTheme: "default",
      chatWidth: "wide",
    });
    expect(updateTheme).toHaveBeenCalledTimes(Object.keys(REGISTERED_THEMES).length);
    const updater = updateTheme.mock.calls[0]?.[1] as (
      theme: ReturnType<typeof fakeTheme>,
    ) => ReturnType<typeof fakeTheme>;
    const result = updater(fakeTheme());
    expect(result.fontSize.content).toBe(21);
    expect(result.fontSize.code).toBe(14);
    expect(result.iconSize).toEqual(ICON_SIZE);
    expect(result.layout.chatMaxWidth).toBe(1200);
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
    });
    const updater = updateTheme.mock.calls[0]?.[1] as (
      theme: ReturnType<typeof fakeTheme>,
    ) => ReturnType<typeof fakeTheme>;
    expect(updater(fakeTheme()).layout.chatMaxWidth).toBeUndefined();
  });
});
