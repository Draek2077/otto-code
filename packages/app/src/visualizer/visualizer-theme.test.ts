import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DARK_VARIANT_THEMES,
  LIGHT_VARIANT_THEMES,
} from "@/screens/settings/appearance/apply-color-scheme";
import { buildVisualizerPalette, resolveVisualizerTheme } from "./visualizer-theme";

// Every variant the app ships, in the exact shape the resolver consumes.
const ALL_VARIANTS = [
  ...Object.values(LIGHT_VARIANT_THEMES).map((t) => ({
    colorScheme: "light" as const,
    colors: t.colors,
  })),
  ...Object.values(DARK_VARIANT_THEMES).map((t) => ({
    colorScheme: "dark" as const,
    colors: t.colors,
  })),
];

function relativeLuminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  return (
    (0.2126 * ((value >> 16) & 0xff) + 0.7152 * ((value >> 8) & 0xff) + 0.0722 * (value & 0xff)) /
    255
  );
}

// Shape classes the vendor page depends on (see the FORMAT RULES note in
// visualizer-theme.ts): draw/component code appends hex alphas to solid
// tokens and `withAlpha` appends ` <a>)` to partial rgba bases.
type Shape = "hex6" | "hex8" | "rgba" | "partial-rgba" | "compound";
function shapeOf(value: string): Shape {
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return "hex6";
  if (/^#[0-9a-fA-F]{8}$/.test(value)) return "hex8";
  if (/^rgba?\([^)]*,$/.test(value.trim())) return "partial-rgba";
  if (/^rgba?\([^)]*\)$/.test(value.trim())) return "rgba";
  return "compound"; // gradients, box-shadow lists
}

/** The vendor COLORS registry, key → value, parsed from source so the test
 * fails loudly when an upstream pull adds/renames tokens the palette misses. */
function vendorColors(): Record<string, string> {
  const source = readFileSync(
    fileURLToPath(new URL("../../../../vendor/agent-flow/web/lib/colors.ts", import.meta.url)),
    "utf8",
  );
  const block = source.slice(
    source.indexOf("export const COLORS = {"),
    source.indexOf("} as const"),
  );
  const entries: Record<string, string> = {};
  for (const match of block.matchAll(/^ {2}(\w+): '((?:[^'\\]|\\.)*)',?\s*(?:\/\/.*)?$/gm)) {
    entries[match[1]] = match[2];
  }
  return entries;
}

describe("buildVisualizerPalette", () => {
  it("produces well-formed values for every shipped variant", () => {
    for (const variant of ALL_VARIANTS) {
      const palette = buildVisualizerPalette(variant);
      for (const [key, value] of Object.entries({ ...palette.colors, ...palette.css })) {
        expect(value, `${variant.colorScheme}/${key}`).not.toMatch(/NaN|undefined/);
      }
    }
  });

  it("covers the vendor COLORS registry exactly, shape for shape", () => {
    const vendor = vendorColors();
    expect(Object.keys(vendor).length).toBeGreaterThan(100);
    for (const variant of ALL_VARIANTS) {
      const overlay = buildVisualizerPalette(variant).colors;
      for (const key of Object.keys(vendor)) {
        expect(overlay[key], `missing overlay for vendor token "${key}"`).toBeTypeOf("string");
        expect(shapeOf(overlay[key]), `${variant.colorScheme}/${key} shape`).toBe(
          shapeOf(vendor[key]),
        );
      }
      for (const key of Object.keys(overlay)) {
        expect(vendor[key], `overlay token "${key}" no longer exists upstream`).toBeTypeOf(
          "string",
        );
      }
    }
  });

  it("keeps the stage darker than the app background in every variant", () => {
    for (const variant of ALL_VARIANTS) {
      const palette = buildVisualizerPalette(variant);
      expect(
        relativeLuminance(palette.background),
        `${variant.colorScheme} void vs background`,
      ).toBeLessThan(relativeLuminance(variant.colors.background));
    }
  });

  it("keeps light variants light with dark glyphs, dark variants near-black with light text", () => {
    for (const variant of ALL_VARIANTS) {
      const palette = buildVisualizerPalette(variant);
      const stage = relativeLuminance(palette.background);
      const text = relativeLuminance(palette.colors.textPrimary);
      if (variant.colorScheme === "light") {
        expect(stage, "light stage stays light").toBeGreaterThan(0.6);
        expect(text, "light glyphs are dark").toBeLessThan(0.35);
      } else {
        expect(stage, "dark stage is near-black").toBeLessThan(0.1);
        expect(text, "dark glyphs are light").toBeGreaterThan(0.5);
      }
    }
  });
});

describe("resolveVisualizerTheme", () => {
  it("resolves system mode from the OS scheme, defaulting to dark", () => {
    const base = { lightTheme: "daylight" as const, darkTheme: "dark" as const };
    const light = resolveVisualizerTheme({
      ...base,
      colorSchemeMode: "system",
      systemColorScheme: "light",
    });
    const dark = resolveVisualizerTheme({
      ...base,
      colorSchemeMode: "system",
      systemColorScheme: null,
    });
    expect(relativeLuminance(light.background)).toBeGreaterThan(0.6);
    expect(relativeLuminance(dark.background)).toBeLessThan(0.1);
  });

  it("returns the palette JSON with the stage background embedded", () => {
    const theme = resolveVisualizerTheme({
      colorSchemeMode: "dark",
      lightTheme: "daylight",
      darkTheme: "cyberpunk",
      systemColorScheme: "light",
    });
    const parsed = JSON.parse(theme.json) as { colors: Record<string, string> };
    expect(parsed.colors.void).toBe(theme.background);
  });
});
