import { describe, expect, it } from "vitest";
import {
  DEFAULT_FONT_CONTRAST,
  daylightColors,
  emberDarkColors,
  evergreenDarkColors,
  graphiteDarkColors,
  horizonColors,
  ivoryColors,
  meadowColors,
  neotokyoDarkColors,
  neutralDarkColors,
  nightfallDarkColors,
  obsidianDarkColors,
  powderColors,
  resolveInkOverrides,
  sherbetColors,
  slateDarkColors,
  terracottaColors,
} from "@/styles/theme-palettes";

const themePalettes = [
  daylightColors,
  sherbetColors,
  meadowColors,
  terracottaColors,
  horizonColors,
  powderColors,
  ivoryColors,
  neutralDarkColors,
  evergreenDarkColors,
  graphiteDarkColors,
  nightfallDarkColors,
  emberDarkColors,
  slateDarkColors,
  neotokyoDarkColors,
  obsidianDarkColors,
];

describe("theme interaction surfaces", () => {
  it("derives Daylight's full state ladder from its golden-sun accent", () => {
    expect(daylightColors.surfaceInteractiveSelected).toBe("rgba(198, 151, 0, 0.06)");
    expect(daylightColors.surfaceInteractiveHover).toBe("rgba(198, 151, 0, 0.1)");
    expect(daylightColors.surfaceInteractivePressed).toBe("rgba(198, 151, 0, 0.16)");
    expect(daylightColors.borderInteractiveHover).toBe("rgba(198, 151, 0, 0.45)");
    expect(daylightColors.surfaceSidebarPanelInteractiveHoverOpaque).toBe("#e6dfc9");
  });

  it.each(themePalettes)(
    "keeps legacy component-family aliases on one interaction ladder",
    (colors) => {
      expect(colors.surfaceHover).toBe(colors.surfaceInteractiveHover);
      expect(colors.surfaceSidebarHover).toBe(colors.surfaceInteractiveHover);
      expect(colors.surfaceToggleHover).toBe(colors.surfaceInteractiveHover);
      expect(colors.surfaceSidebarSelected).toBe(colors.surfaceInteractiveSelected);
      expect(colors.surfaceToggleSelected).toBe(colors.surfaceInteractiveSelected);
      expect(colors.surfaceInteractiveHover).not.toBe(colors.surfaceInteractiveSelected);
      expect(colors.surfaceInteractivePressed).not.toBe(colors.surfaceInteractiveHover);
    },
  );
});

// The font-contrast slider is the app's one ink-strength control, and "ink"
// includes the accent: selected tab labels, toggled title-bar icons and commit
// checkboxes all paint from `accent`/`accentBright`. Before this was wired up
// they ignored the slider entirely, which was merely odd on the tinted themes
// and glaring on monochrome Obsidian, where the accent is pure #ffffff.
describe("font contrast reaches accent ink", () => {
  it.each(themePalettes)("changes nothing at the default slider position", (colors) => {
    const ink = resolveInkOverrides(colors, DEFAULT_FONT_CONTRAST);
    expect(ink.colors.foreground).toBe(colors.foreground);
    expect(ink.colors.accent).toBe(colors.accent);
    expect(ink.colors.accentBright).toBe(colors.accentBright);
  });

  it.each(themePalettes)("keeps `success` on the same value as `accent`", (colors) => {
    // Both builders define `success` as `accent` verbatim, so the two must not
    // drift once the slider starts restating one of them.
    expect(colors.success).toBe(colors.accent);
    const ink = resolveInkOverrides(colors, 0);
    expect(ink.colors.success).toBe(ink.colors.accent);
  });

  it("softens Obsidian's pure-white accent in lockstep with its body text", () => {
    const softened = resolveInkOverrides(obsidianDarkColors, 0);
    expect(obsidianDarkColors.accent).toBe("#ffffff");
    expect(softened.colors.accent).not.toBe("#ffffff");
    // Same ink, same backdrop, same gain - a selected tab label must not read
    // brighter than the prose beside it.
    expect(softened.colors.accent).toBe(softened.colors.foreground);
  });

  it("softens Ivory's pure-black accent the other way", () => {
    const softened = resolveInkOverrides(ivoryColors, 0);
    expect(ivoryColors.accent).toBe("#000000");
    expect(softened.colors.accent).not.toBe("#000000");
    expect(softened.colors.accent).toBe(softened.colors.foreground);
  });

  it("leaves a tinted accent recognisably its own colour at the soft end", () => {
    // The gain scales each channel's distance from the backdrop, so hue order
    // survives. Mixing toward grey/black instead would collapse this to a
    // neutral and every tinted theme would lose its identity on the low half
    // of the slider.
    const softened = resolveInkOverrides(neutralDarkColors, 0);
    const [r, g, b] = [1, 3, 5].map((i) =>
      Number.parseInt(softened.colors.accent.slice(i, i + 2), 16),
    );
    expect(b).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(r);
  });

  it("leaves ink that sits on the accent FILL alone", () => {
    // `accentForeground`/`accentFillInk` pivot on the accent fill, not on the
    // app background, so `surface0` is the wrong backdrop to scale them from.
    const ink = resolveInkOverrides(obsidianDarkColors, 0);
    expect(ink.colors).not.toHaveProperty("accentForeground");
    expect(ink.colors).not.toHaveProperty("accentFillInk");
  });
});
