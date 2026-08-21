import { describe, expect, it } from "vitest";
import {
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
