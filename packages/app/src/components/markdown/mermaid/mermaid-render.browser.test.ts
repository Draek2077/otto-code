import { describe, expect, it } from "vitest";
import type { MermaidThemeConfig } from "./mermaid-contract";
import { peekMermaidOutcome, renderMermaid, resolveMermaidOutcome } from "./mermaid-render";

// Runs in a real browser (the `browser` vitest project): mermaid measures label
// text through the DOM, so there is no honest way to test it in node.
//
// The theme configs are literals rather than `buildMermaidThemeConfig(darkTheme)`
// — importing `@/styles/theme` would drag react-native and unistyles into this
// browser bundle for two colors. That the real themes produce a valid config is
// mermaid-theme.test.ts's job; this file's is what the renderer does with one.

const dark: MermaidThemeConfig = {
  dark: true,
  background: "#26262a",
  surface: "#33333a",
  border: "#3f3f46",
  foreground: "#e4e4e7",
  foregroundMuted: "#a1a1aa",
  accent: "#60a5fa",
  fontFamily: "Inter, sans-serif",
  fontSize: 13,
};

const light: MermaidThemeConfig = {
  dark: false,
  background: "#f4f4f5",
  surface: "#e4e4e7",
  border: "#d4d4d8",
  foreground: "#37373c",
  foregroundMuted: "#62626b",
  accent: "#2563eb",
  fontFamily: "Inter, sans-serif",
  fontSize: 13,
};

const FLOWCHART = `flowchart TD
  Start([Request]) --> Check{Cached?}
  Check -- yes --> Serve[Serve from cache]
  Check -- no --> Fetch[Fetch upstream]
  Fetch --> Serve`;

const SEQUENCE = `sequenceDiagram
  participant App
  participant Daemon
  App->>Daemon: file.read
  Daemon-->>App: contents
  Note over App,Daemon: over the websocket`;

describe("renderMermaid", () => {
  it("renders a flowchart to a sized SVG", async () => {
    const result = await renderMermaid(FLOWCHART, dark);

    expect(result.svg).toContain("<svg");
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    // Node labels survive the strict-mode sanitizer.
    expect(result.svg).toContain("Serve from cache");
  });

  it("renders a sequence diagram", async () => {
    const result = await renderMermaid(SEQUENCE, dark);

    expect(result.svg).toContain("<svg");
    expect(result.width).toBeGreaterThan(0);
    expect(result.svg).toContain("file.read");
    expect(result.svg).toContain("over the websocket");
  });

  it("hands sizing to the caller instead of pinning a max-width", async () => {
    const result = await renderMermaid(FLOWCHART, dark);
    const openingTag = /<svg\b[^>]*>/.exec(result.svg)?.[0] ?? "";

    expect(openingTag).toContain('width="100%"');
    expect(openingTag).not.toMatch(/max-width/i);
    expect(openingTag).not.toMatch(/\sheight=/i);
  });

  it("follows the active theme", async () => {
    const [inDark, inLight] = await Promise.all([
      renderMermaid(FLOWCHART, dark),
      renderMermaid(FLOWCHART, light),
    ]);

    expect(inDark.svg).not.toBe(inLight.svg);
    expect(inDark.svg).toContain(dark.foreground.toLowerCase());
    expect(inLight.svg).toContain(light.foreground.toLowerCase());
  });

  it("rejects malformed source with a readable message", async () => {
    await expect(renderMermaid("flowchart TD\n  A -->", dark)).rejects.toThrow();
    await expect(renderMermaid("this is not a diagram", dark)).rejects.toThrow();
  });

  it("rejects empty source rather than resolving an empty diagram", async () => {
    await expect(renderMermaid("   \n  ", dark)).rejects.toThrow(/empty/i);
  });

  it("leaves no probe elements behind, on success or failure", async () => {
    const before = document.body.children.length;

    await renderMermaid(FLOWCHART, dark);
    await renderMermaid("not a diagram at all", dark).catch(() => undefined);

    expect(document.body.children.length).toBe(before);
  });
});

describe("resolveMermaidOutcome", () => {
  const CLASS_DIAGRAM = `classDiagram
  class Daemon {
    +read(path)
  }`;

  it("reports failure as a value rather than throwing", async () => {
    const outcome = await resolveMermaidOutcome("flowchart TD\n  A -->", light);

    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") {
      expect(outcome.message.length).toBeGreaterThan(0);
    }
  });

  // Fresh node keys per markdown parse remount every block, so a remount has to
  // recall its diagram instead of re-rendering (and flashing the source).
  it("caches by source and theme so a remount is instant", async () => {
    expect(peekMermaidOutcome(CLASS_DIAGRAM, dark)).toBeUndefined();

    const first = await resolveMermaidOutcome(CLASS_DIAGRAM, dark);

    expect(peekMermaidOutcome(CLASS_DIAGRAM, dark)).toBe(first);
    expect(await resolveMermaidOutcome(CLASS_DIAGRAM, dark)).toBe(first);
    // A different theme is a different diagram.
    expect(peekMermaidOutcome(CLASS_DIAGRAM, light)).toBeUndefined();
  });
});
