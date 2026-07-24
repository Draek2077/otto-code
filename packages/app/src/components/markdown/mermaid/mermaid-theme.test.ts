import { describe, expect, it } from "vitest";
import { darkTheme, daylightTheme } from "@/styles/theme";
import { buildMermaidThemeConfig, buildMermaidThemeVariables } from "./mermaid-theme";

describe("buildMermaidThemeConfig", () => {
  it("reports the scheme so mermaid picks matching derived shades", () => {
    expect(buildMermaidThemeConfig(darkTheme).dark).toBe(true);
    expect(buildMermaidThemeConfig(daylightTheme).dark).toBe(false);
  });

  it("produces different palettes per scheme", () => {
    expect(buildMermaidThemeConfig(darkTheme).background).not.toBe(
      buildMermaidThemeConfig(daylightTheme).background,
    );
  });
});

describe("buildMermaidThemeVariables", () => {
  // Mermaid runs color math over every variable it is handed, so a CSS var()
  // reference (what themeColorRef would emit on web) yields NaN shades and an
  // unstyled diagram. This is the regression guard for that.
  it.each([
    ["dark", darkTheme],
    ["light", daylightTheme],
  ])("emits only concrete values in the %s theme", (_name, theme) => {
    const variables = buildMermaidThemeVariables(buildMermaidThemeConfig(theme));

    expect(Object.keys(variables).length).toBeGreaterThan(0);
    for (const [key, value] of Object.entries(variables)) {
      expect(typeof value, key).toBe("string");
      expect(String(value), key).not.toContain("var(");
      expect(String(value).trim().length, key).toBeGreaterThan(0);
    }
  });

  it("covers the diagram families that derive nothing from the primaries", () => {
    const variables = buildMermaidThemeVariables(buildMermaidThemeConfig(darkTheme));

    // Sequence actors and notes are the two that ship illegible defaults.
    expect(variables.actorBkg).toBeDefined();
    expect(variables.actorTextColor).toBeDefined();
    expect(variables.signalColor).toBeDefined();
    expect(variables.noteBkgColor).toBeDefined();
    expect(variables.noteTextColor).toBeDefined();
  });

  it("passes the font size through as a CSS length", () => {
    const config = buildMermaidThemeConfig(daylightTheme);
    const variables = buildMermaidThemeVariables(config);

    expect(variables.fontSize).toBe(`${config.fontSize}px`);
  });
});
