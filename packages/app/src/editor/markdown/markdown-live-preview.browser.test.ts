import { afterEach, describe, expect, it } from "vitest";
import { resolveSyntaxColors } from "@otto-code/highlight";
import type { EditorThemeSpec } from "../editor-contract";
import { createEditorCore, type EditorCore } from "../editor-core";

// Live preview against a real CM6 in a real browser. None of this survives a
// mock: the behaviour IS the interaction between the markdown parse tree, the
// selection, and CodeMirror's decoration/measurement pipeline. What is asserted
// here is what the user can see — the rendered text of the content DOM — rather
// than the decoration set, because a decoration that exists but does not hide
// anything would pass a structural assertion and fail the user.

const THEME: EditorThemeSpec = {
  background: "#101014",
  foreground: "#e6e6e6",
  gutterBackground: "#16161c",
  gutterForeground: "#6b6b76",
  gutterActiveForeground: "#e6e6e6",
  gutterBorder: "#26262e",
  rulerColumn: null,
  rulerColor: "#26262e",
  overviewRulerWidth: 14,
  overviewRulerBackground: "#16161c",
  overviewRulerBorder: "#26262e",
  overviewRulerThumb: "rgba(230, 230, 230, 0.18)",
  overviewRulerCursor: "#e6e6e6",
  overviewRulerSelection: "rgba(80, 130, 200, 0.20)",
  overviewRulerMatch: "#e0a030",
  scrollbarHandle: "#8a8a8a",
  tooltipBackground: "#2a2a2a",
  tooltipBorder: "#3a3a3a",
  tooltipShadow: "0px 6px 16px rgba(0, 0, 0, 0.6)",
  selectionBackground: "#2b3a55",
  cursor: "#e6e6e6",
  cursorWidth: 2,
  activeLineBackground: "rgba(255, 255, 255, 0.04)",
  searchMatchBackground: "rgba(255, 191, 0, 0.28)",
  searchMatchBorder: "rgba(255, 191, 0, 0.7)",
  activeSearchMatchBackground: "rgba(255, 191, 0, 0.45)",
  activeSearchMatchBorder: "#ffbf00",
  fontFamily: "monospace",
  fontSize: 13,
  lineHeight: 20,
  syntax: resolveSyntaxColors("default", "dark"),
  diagnostic: { error: "#dc2626", warning: "#f59e0b", info: "#38bdf8", hint: "#94a3b8" },
};

const DOC = ["# Title", "", "Some **bold** and *italic* text.", "", "> quoted", ""].join("\n");

const mounted: Array<{ core: EditorCore; host: HTMLElement }> = [];

function mount(options?: { doc?: string; livePreview?: boolean; path?: string }): {
  core: EditorCore;
  host: HTMLElement;
} {
  const host = document.createElement("div");
  host.style.height = "300px";
  document.body.appendChild(host);
  const core = createEditorCore({
    parent: host,
    path: options?.path ?? "notes/example.md",
    doc: options?.doc ?? DOC,
    theme: THEME,
    wordWrap: false,
    markdownLivePreview: options?.livePreview ?? true,
  });
  const entry = { core, host };
  mounted.push(entry);
  return entry;
}

/** What the user can actually read, with CM6's line separators normalised. */
function visibleText(host: HTMLElement): string {
  const content = host.querySelector(".cm-content");
  return Array.from(content?.querySelectorAll(".cm-line") ?? [])
    .map((line) => line.textContent ?? "")
    .join("\n");
}

afterEach(() => {
  while (mounted.length > 0) {
    const entry = mounted.pop();
    entry?.core.destroy();
    entry?.host.remove();
  }
});

describe("markdown live preview", () => {
  it("hides emphasis and heading markers while the caret is elsewhere", () => {
    const { core, host } = mount();
    // Caret at the very start, so only line 1 is revealed.
    core.goToLine(6);
    const text = visibleText(host);
    expect(text).toContain("Some bold and italic text.");
    expect(text).not.toContain("**bold**");
    expect(text).not.toContain("*italic*");
  });

  it("reveals the source of the line the caret is on, and only that line", () => {
    const { core, host } = mount();
    core.goToLine(3);
    const lines = visibleText(host).split("\n");
    // Line 3 is the emphasis line; it shows its markers again.
    expect(lines[2]).toBe("Some **bold** and *italic* text.");
    // The heading on line 1 is untouched by the caret and stays rendered.
    expect(lines[0]).toBe("Title");
  });

  it("leaves the document itself alone — decorations never rewrite text", async () => {
    const { core } = mount();
    expect(await core.getDoc()).toBe(DOC);
  });

  it("shows every marker when live preview is off", () => {
    const { core, host } = mount({ livePreview: false });
    core.goToLine(6);
    const text = visibleText(host);
    expect(text).toContain("# Title");
    expect(text).toContain("**bold**");
  });

  it("toggles at runtime without remounting", () => {
    const { core, host } = mount({ livePreview: false });
    core.goToLine(6);
    expect(visibleText(host)).toContain("**bold**");
    core.setMarkdownLivePreview(true);
    expect(visibleText(host)).not.toContain("**bold**");
    core.setMarkdownLivePreview(false);
    expect(visibleText(host)).toContain("**bold**");
  });

  // A fence's own ``` lines are CodeMarks too, and hiding them would collapse
  // the block into the prose around it.
  it("keeps fence markers visible", () => {
    const { core, host } = mount({
      doc: ["intro", "", "```ts", "const a = 1;", "```", "", "end"].join("\n"),
    });
    core.goToLine(1);
    expect(visibleText(host)).toContain("```ts");
  });

  it("does nothing at all in a file that is not markdown", () => {
    const { host } = mount({ path: "src/example.ts", doc: "const a = 1; // **not bold**\n" });
    expect(visibleText(host)).toContain("**not bold**");
  });
});
