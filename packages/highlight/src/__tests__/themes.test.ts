import { describe, it, expect } from "vitest";
import { darkHighlightColors, lightHighlightColors } from "../colors.js";
import { SYNTAX_THEME_IDS, isSyntaxThemeId, resolveSyntaxColors } from "../themes.js";
import type { HighlightStyle } from "../types.js";

const allStyles: HighlightStyle[] = [
  "keyword",
  "comment",
  "string",
  "number",
  "literal",
  "function",
  "definition",
  "class",
  "type",
  "tag",
  "attribute",
  "property",
  "variable",
  "operator",
  "punctuation",
  "regexp",
  "escape",
  "meta",
  "heading",
  "link",
];

const colorSchemes: ("light" | "dark")[] = ["light", "dark"];

describe("resolveSyntaxColors", () => {
  for (const id of SYNTAX_THEME_IDS) {
    for (const colorScheme of colorSchemes) {
      describe(`${id} (${colorScheme})`, () => {
        const colors = resolveSyntaxColors(id, colorScheme);

        it("covers all HighlightStyle values", () => {
          for (const style of allStyles) {
            expect(colors[style]).toBeDefined();
            expect(typeof colors[style]).toBe("string");
          }
        });

        it("has valid hex color values", () => {
          for (const style of allStyles) {
            expect(colors[style]).toMatch(/^#[0-9a-fA-F]{6}$/);
          }
        });

        it("has semi-transparent rgba diff background colors", () => {
          expect(colors.diffAdded).toMatch(/^rgba\(\d+, \d+, \d+, 0(\.\d+)?\)$/);
          expect(colors.diffRemoved).toMatch(/^rgba\(\d+, \d+, \d+, 0(\.\d+)?\)$/);
        });

        it("derives intraline emphasis colors that share the diff hues", () => {
          const hue = (rgba: string) => rgba.slice(0, rgba.lastIndexOf(","));
          expect(colors.diffAddedEmphasis).toMatch(/^rgba\(\d+, \d+, \d+, 0(\.\d+)?\)$/);
          expect(colors.diffRemovedEmphasis).toMatch(/^rgba\(\d+, \d+, \d+, 0(\.\d+)?\)$/);
          expect(hue(colors.diffAddedEmphasis)).toBe(hue(colors.diffAdded));
          expect(hue(colors.diffRemovedEmphasis)).toBe(hue(colors.diffRemoved));
        });
      });
    }
  }

  it("github + light deep-equals lightHighlightColors", () => {
    expect(resolveSyntaxColors("github", "light")).toEqual(lightHighlightColors);
  });

  it("github + dark deep-equals darkHighlightColors", () => {
    expect(resolveSyntaxColors("github", "dark")).toEqual(darkHighlightColors);
  });

  it("every theme ships a distinct light and dark palette (no dark-only shortcuts)", () => {
    for (const id of SYNTAX_THEME_IDS) {
      const light = resolveSyntaxColors(id, "light");
      const dark = resolveSyntaxColors(id, "dark");
      expect(light).not.toEqual(dark);
    }
  });

  it("light palettes never use pure white as the base/variable text color", () => {
    for (const id of SYNTAX_THEME_IDS) {
      const light = resolveSyntaxColors(id, "light");
      expect(light.variable.toLowerCase()).not.toBe("#ffffff");
    }
  });

  it("dark palettes never use pure black as the base/variable text color", () => {
    for (const id of SYNTAX_THEME_IDS) {
      const dark = resolveSyntaxColors(id, "dark");
      expect(dark.variable.toLowerCase()).not.toBe("#000000");
    }
  });

  it("jetbrains uses a light text palette in light mode", () => {
    const light = resolveSyntaxColors("jetbrains", "light");
    const dark = resolveSyntaxColors("jetbrains", "dark");

    expect(light).not.toEqual(dark);
    expect(light.variable).toBe("#000000");
    expect(light.comment).toBe("#8c8c8c");
  });
});

describe("isSyntaxThemeId", () => {
  it("accepts every id in SYNTAX_THEME_IDS", () => {
    for (const id of SYNTAX_THEME_IDS) {
      expect(isSyntaxThemeId(id)).toBe(true);
    }
  });

  it("rejects unknown ids", () => {
    expect(isSyntaxThemeId("auto")).toBe(false);
    expect(isSyntaxThemeId("github-light")).toBe(false);
    expect(isSyntaxThemeId("dracula")).toBe(false);
    expect(isSyntaxThemeId("one")).toBe(false);
    expect(isSyntaxThemeId("nope")).toBe(false);
  });
});
