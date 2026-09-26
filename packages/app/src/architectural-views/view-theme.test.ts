import { describe, expect, it } from "vitest";
import { darkTheme, daylightTheme } from "@/styles/theme";
import { buildInteractiveViewTheme } from "./view-theme";

describe("buildInteractiveViewTheme", () => {
  it("maps the active Otto theme onto the viewer's colour variables", () => {
    const { scheme, css } = buildInteractiveViewTheme({ theme: darkTheme });

    expect(scheme).toBe("dark");
    expect(css).toContain(`--bg: ${darkTheme.colors.surface0};`);
    expect(css).toContain(`--text: ${darkTheme.colors.foreground};`);
    expect(css).toContain(`--panel-border: ${darkTheme.colors.border};`);
    expect(css).toContain(`--arrow-emphasis: ${darkTheme.colors.accent};`);
    expect(css).toContain(`--backend-stroke: ${darkTheme.colors.syntax.tag};`);
  });

  it("follows a light Otto theme", () => {
    const { scheme, css } = buildInteractiveViewTheme({ theme: daylightTheme });

    expect(scheme).toBe("light");
    expect(css).toContain(`--bg: ${daylightTheme.colors.surface0};`);
  });

  it("uses the content font as the typographic baseline and leaves sizing to the viewer", () => {
    const { css } = buildInteractiveViewTheme({ theme: darkTheme });

    expect(css).toContain(`font-size: ${darkTheme.fontSize.content}px;`);
    expect(css).toContain(`font-family: ${darkTheme.fontFamily.ui};`);
    // Only the root size is set; the viewer's relative sizes are untouched.
    expect(css.match(/font-size:/g)).toHaveLength(1);
  });

  it("outranks the viewer's theme and preset selectors", () => {
    const { css } = buildInteractiveViewTheme({ theme: darkTheme });

    expect(css).toContain("html[data-otto-view][data-theme] {");
  });

  it("hides the viewer chrome the Otto toolbar replaces", () => {
    const { css } = buildInteractiveViewTheme({ theme: darkTheme });

    for (const selector of [".toolbar", ".header", ".diagram-nav"]) {
      expect(css).toContain(`html[data-otto-view] ${selector}`);
    }
    expect(css).toMatch(/\.diagram-nav \{\n {2}display: none !important;/);
  });

  it("sets diagram text in the user's monospace font", () => {
    const { css } = buildInteractiveViewTheme({ theme: darkTheme });

    expect(css).toContain(
      `html[data-otto-view] .diagram-container svg {\n  font-family: ${darkTheme.fontFamily.mono};`,
    );
  });

  it("embeds provided font faces ahead of the rules", () => {
    const ui = "@font-face { font-family: 'Inter_400Regular'; src: url(data:font/ttf;base64,AA); }";
    const mono =
      "@font-face { font-family: 'JetBrainsMono_400Regular'; src: url(data:font/ttf;base64,BB); }";
    const { css } = buildInteractiveViewTheme({ theme: darkTheme, fontFaces: [ui, null, mono] });

    expect(css.startsWith(`${ui}\n${mono}\n`)).toBe(true);
  });
});
