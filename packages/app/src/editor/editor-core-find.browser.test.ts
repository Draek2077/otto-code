import { userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it } from "vitest";
import { resolveSyntaxColors } from "@otto-code/highlight";
import type { EditorFindState, EditorThemeSpec } from "./editor-contract";
import { createEditorCore, type EditorCore } from "./editor-core";

// Find highlighting, against a real CM6 in a real browser. The decorations are
// the whole point of the feature and they are pure DOM - a mocked view would
// assert nothing about whether a match is actually painted, or still painted
// after the strip closes.

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

const DOC = "const a = 1;\nconst b = 2;\nconst c = 3;\n";

const FIND: EditorFindState = {
  search: "const",
  replace: "",
  caseSensitive: false,
  wholeWord: false,
  regexp: false,
};

const mounted: Array<{ core: EditorCore; host: HTMLElement }> = [];

function mount(): {
  core: EditorCore;
  host: HTMLElement;
  matchCount: () => number;
  closeRequests: () => number;
} {
  const host = document.createElement("div");
  host.style.height = "300px";
  document.body.appendChild(host);
  let closeRequests = 0;
  const core = createEditorCore({
    parent: host,
    path: "src/example.ts",
    doc: DOC,
    theme: THEME,
    wordWrap: false,
    onCloseFindShortcut: () => {
      closeRequests += 1;
      // What the host does with it, which is the part that clears the matches.
      core.setFind(null);
    },
  });
  mounted.push({ core, host });
  return {
    core,
    host,
    matchCount: () => host.querySelectorAll(".cm-searchMatch").length,
    closeRequests: () => closeRequests,
  };
}

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    entry.core.destroy();
    entry.host.remove();
  }
});

describe("editor core find highlighting", () => {
  it("paints every match of the query", () => {
    const editor = mount();
    editor.core.setFind(FIND);
    expect(editor.matchCount()).toBe(3);
  });

  it("clears every match when the find strip closes", () => {
    const editor = mount();
    editor.core.setFind(FIND);
    editor.core.findNext();
    expect(editor.matchCount()).toBe(3);

    editor.core.setFind(null);
    expect(editor.matchCount()).toBe(0);
  });

  it("clears every match when the query is emptied", () => {
    const editor = mount();
    editor.core.setFind(FIND);
    editor.core.setFind({ ...FIND, search: "" });
    expect(editor.matchCount()).toBe(0);
  });

  it("clears the matches on Escape pressed in the file contents", async () => {
    const editor = mount();
    editor.core.setFind(FIND);
    // Stepping through results puts focus back in the text, which is where
    // Escape is actually pressed.
    editor.core.findNext();
    editor.core.focus();
    expect(editor.matchCount()).toBe(3);

    await userEvent.keyboard("{Escape}");
    expect(editor.closeRequests()).toBe(1);
    expect(editor.matchCount()).toBe(0);
  });

  it("leaves Escape alone when no query is running", async () => {
    const editor = mount();
    editor.core.focus();
    await userEvent.keyboard("{Escape}");
    expect(editor.closeRequests()).toBe(0);
  });

  it("keeps the match the user landed on selected after Escape", async () => {
    const editor = mount();
    editor.core.setFind(FIND);
    editor.core.findNext();
    editor.core.focus();
    const selected = editor.core.getSelection().text;

    await userEvent.keyboard("{Escape}");
    // The highlights go; where you got to does not. Escape dismisses the tool,
    // it does not undo the navigation.
    expect(editor.core.getSelection().text).toBe(selected);
  });
});
