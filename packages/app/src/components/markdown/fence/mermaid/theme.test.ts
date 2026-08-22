import { describe, expect, it } from "vitest";
import { darkTheme, daylightTheme } from "@/styles/theme";
import { buildMermaidDiagramTheme } from "./theme";

describe("buildMermaidDiagramTheme", () => {
  it("hands mermaid concrete values only - khroma NaNs on var() refs", () => {
    for (const theme of [darkTheme, daylightTheme]) {
      const { variables } = buildMermaidDiagramTheme(theme);
      for (const [name, value] of Object.entries(variables)) {
        expect(typeof value, name).toBe("string");
        expect(value, name).not.toContain("var(");
      }
    }
  });

  it("carries the color scheme and a palette-specific key", () => {
    const dark = buildMermaidDiagramTheme(darkTheme);
    const light = buildMermaidDiagramTheme(daylightTheme);

    expect(dark.colorScheme).toBe("dark");
    expect(dark.variables.darkMode).toBe("true");
    expect(light.colorScheme).toBe("light");
    expect(light.variables.darkMode).toBe("false");
    expect(dark.key).not.toBe(light.key);
  });

  it("returns one stable object per theme so render inputs stay referentially equal", () => {
    expect(buildMermaidDiagramTheme(darkTheme)).toBe(buildMermaidDiagramTheme(darkTheme));
  });
});
