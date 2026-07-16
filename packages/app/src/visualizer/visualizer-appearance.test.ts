import { describe, expect, it } from "vitest";
import { DEFAULT_MONO_FONT_STACK, DEFAULT_UI_FONT_STACK } from "@/styles/theme";
import { resolveVisualizerAppearance } from "./visualizer-appearance";

describe("resolveVisualizerAppearance", () => {
  it("falls back to the default stacks for empty families", () => {
    const resolved = resolveVisualizerAppearance({
      uiFontFamily: "",
      monoFontFamily: "  ",
      uiFontSize: 16,
      isCompact: false,
    });
    expect(resolved.uiFontFamily).toBe(DEFAULT_UI_FONT_STACK);
    expect(resolved.codeFontFamily).toBe(DEFAULT_MONO_FONT_STACK);
  });

  it("passes custom families through", () => {
    const resolved = resolveVisualizerAppearance({
      uiFontFamily: "Comic Sans MS",
      monoFontFamily: "Fira Code",
      uiFontSize: 16,
      isCompact: false,
    });
    expect(resolved.uiFontFamily).toBe("Comic Sans MS");
    expect(resolved.codeFontFamily).toBe("Fira Code");
  });

  it("resolves chat size to fontSize.sm scaled by the UI size, like applyAppearance", () => {
    // Authored ramp: sm=14 at base=16.
    expect(
      resolveVisualizerAppearance({
        uiFontFamily: "",
        monoFontFamily: "",
        uiFontSize: 16,
        isCompact: false,
      }).chatFontSize,
    ).toBe(14);
    expect(
      resolveVisualizerAppearance({
        uiFontFamily: "",
        monoFontFamily: "",
        uiFontSize: 18,
        isCompact: false,
      }).chatFontSize,
    ).toBe(Math.round(14 * (18 / 16)));
  });

  it("bumps the UI size on compact form factors before scaling", () => {
    expect(
      resolveVisualizerAppearance({
        uiFontFamily: "",
        monoFontFamily: "",
        uiFontSize: 16,
        isCompact: true,
      }).chatFontSize,
    ).toBe(Math.round(14 * (18 / 16)));
  });
});
