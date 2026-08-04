import { afterEach, describe, expect, it } from "vitest";
import { resolveSyntaxColors } from "@otto-code/highlight";
import type { EditorThemeSpec } from "../editor-contract";
import { createEditorCore, type EditorCore } from "../editor-core";

// Link and heading completion against a real CodeMirror in a real browser.
//
// The pure half - where a target starts, what an anchor is called, how a path is
// written relative to the document - is covered by markdown-link-completion.test.ts.
// What only a browser can prove is the wiring: that the source is actually
// reachable from a markdown buffer, that the popup opens, and that accepting a
// row puts the right text in the document. A mock of CodeMirror would assert
// none of that.

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

const WORKSPACE_FILES = ["docs/setup.md", "docs/other/deep.md", "README.md"];

const mounted: Array<{ core: EditorCore; host: HTMLElement }> = [];

function mount(options?: { path?: string; doc?: string; targets?: readonly string[] }) {
  const host = document.createElement("div");
  host.style.height = "300px";
  document.body.appendChild(host);
  const core = createEditorCore({
    parent: host,
    path: options?.path ?? "docs/guide.md",
    doc: options?.doc ?? "",
    theme: THEME,
    wordWrap: false,
  });
  core.setMarkdownLinkTargets(options?.targets ?? WORKSPACE_FILES);
  const entry = { core, host };
  mounted.push(entry);
  return entry;
}

function content(host: HTMLElement): HTMLElement {
  const element = host.querySelector(".cm-content");
  if (!(element instanceof HTMLElement)) {
    throw new Error("editor content not mounted");
  }
  return element;
}

function press(host: HTMLElement, key: string, modifiers?: { ctrlKey?: boolean }) {
  content(host).dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      code: key === " " ? "Space" : key,
      ctrlKey: modifiers?.ctrlKey ?? false,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** Ctrl-Space, the completionKeymap's explicit trigger. */
function requestCompletion(host: HTMLElement) {
  press(host, " ", { ctrlKey: true });
}

/**
 * The completion popup is rendered after a state update and a measure pass, so
 * it is never there on the same tick the key was pressed.
 */
async function completionLabels(host: HTMLElement): Promise<string[]> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const rows = host.ownerDocument.querySelectorAll(
      ".cm-tooltip-autocomplete li .cm-completionLabel",
    );
    if (rows.length > 0) {
      return Array.from(rows).map((row) => row.textContent ?? "");
    }
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  return [];
}

/**
 * Wait for the popup, then take the selected row with Enter.
 *
 * The wait is not slop. CodeMirror refuses to accept a completion within
 * `interactionDelay` (75ms) of the popup opening, so that a keystroke already in
 * flight when the list appears cannot accidentally pick a row for you. Pressing
 * Enter the instant a row renders therefore inserts a newline instead, which is
 * exactly what a real user would get if they typed that fast.
 */
async function acceptFirstCompletion(host: HTMLElement): Promise<void> {
  await completionLabels(host);
  await new Promise((resolve) => setTimeout(resolve, 150));
  press(host, "Enter");
}

/** The secondary column: the heading a link anchor points at. */
function completionDetails(host: HTMLElement): string[] {
  return Array.from(
    host.ownerDocument.querySelectorAll(".cm-tooltip-autocomplete li .cm-completionDetail"),
  ).map((row) => row.textContent ?? "");
}

afterEach(() => {
  while (mounted.length > 0) {
    const entry = mounted.pop();
    entry?.core.destroy();
    entry?.host.remove();
  }
});

describe("markdown link completion", () => {
  it("offers workspace files once a link target is opened", async () => {
    const { core, host } = mount();
    core.replaceSelection("[the guide](");
    requestCompletion(host);

    const labels = await completionLabels(host);
    // Workspace-relative in the list, because that is how a file is recognised.
    expect(labels).toEqual(WORKSPACE_FILES);
  });

  it("ranks by what has been typed rather than by prefix", async () => {
    const { core, host } = mount();
    // "deep" appears only in the middle of `docs/other/deep.md`, so a prefix
    // filter would find nothing here.
    core.replaceSelection("[the guide](deep");
    requestCompletion(host);

    expect(await completionLabels(host)).toEqual(["docs/other/deep.md"]);
  });

  it("inserts the path relative to the document being edited", async () => {
    const { core, host } = mount({ path: "docs/guide.md" });
    core.replaceSelection("[the guide](deep");
    requestCompletion(host);
    await acceptFirstCompletion(host);

    // `docs/other/deep.md` seen from `docs/guide.md`. A workspace-relative path
    // would only resolve inside this app; this one resolves anywhere.
    expect(await core.getDoc()).toBe("[the guide](other/deep.md");
  });

  it("climbs out of the directory when the target sits above it", async () => {
    const { core, host } = mount({ path: "docs/guide.md" });
    core.replaceSelection("[home](READ");
    requestCompletion(host);
    await acceptFirstCompletion(host);

    expect(await core.getDoc()).toBe("[home](../README.md");
  });

  it("offers this document's headings after a hash", async () => {
    const doc = ["# Title", "", "## Getting Started", "", "## Options", "", ""].join("\n");
    const { core, host } = mount({ doc });
    core.goToLine(7);
    core.replaceSelection("[jump](#");
    requestCompletion(host);

    expect(await completionLabels(host)).toEqual(["title", "getting-started", "options"]);
    // The heading as written rides alongside, so the list reads as sections
    // rather than as slugs.
    expect(completionDetails(host)).toEqual(["Title", "Getting Started", "Options"]);
  });

  it("stays shut in a file that is not markdown", async () => {
    const { core, host } = mount({ path: "src/index.ts" });
    core.replaceSelection("[the guide](");
    requestCompletion(host);

    expect(await completionLabels(host)).toEqual([]);
  });

  // The link is finished, so the caret is back in prose.
  it("stays shut once the target has been closed", async () => {
    const { core, host } = mount();
    core.replaceSelection("[the guide](docs/setup.md) and then");
    requestCompletion(host);

    expect(await completionLabels(host)).toEqual([]);
  });
});
