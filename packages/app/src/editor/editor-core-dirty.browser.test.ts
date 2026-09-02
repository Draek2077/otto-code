import { userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it } from "vitest";
import { resolveSyntaxColors } from "@otto-code/highlight";
import type { EditorThemeSpec } from "./editor-contract";
import { createEditorCore, type EditorCore } from "./editor-core";

// Dirty tracking, against a real CM6 in a real browser. The whole point of the
// comparison-based baseline is that it holds for edits the editor never hears
// about individually - an undo, a paste that happens to restore what a cut took
// - so the interesting cases are the ones driven through actual key events and
// the host's own edit commands rather than through a mocked view.

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

const SAVED = "const a = 1;\nconst b = 2;\n";

// CM6's history keymap is platform-shaped: Mod is Cmd on mac and Ctrl
// elsewhere, and redo is Mod-Shift-Z on mac but Ctrl-Y on Windows/Linux.
const IS_MAC = /Mac/i.test(navigator.platform);
const UNDO_KEYS = IS_MAC ? "{Meta>}z{/Meta}" : "{Control>}z{/Control}";
const REDO_KEYS = IS_MAC ? "{Meta>}{Shift>}z{/Shift}{/Meta}" : "{Control>}y{/Control}";

interface Mounted {
  core: EditorCore;
  host: HTMLElement;
  /** Every value the core reported, in order. */
  dirtyEvents: boolean[];
  /** The last reported value, or null when it never reported. */
  reported: () => boolean | null;
}

const mounted: Array<{ core: EditorCore; host: HTMLElement }> = [];

function mount(options?: { doc?: string; cleanDoc?: string }): Mounted {
  const host = document.createElement("div");
  host.style.height = "300px";
  document.body.appendChild(host);
  const dirtyEvents: boolean[] = [];
  const core = createEditorCore({
    parent: host,
    path: "src/example.ts",
    doc: options?.doc ?? SAVED,
    cleanDoc: options?.cleanDoc,
    theme: THEME,
    wordWrap: false,
    onDirtyChanged: (dirty) => dirtyEvents.push(dirty),
  });
  mounted.push({ core, host });
  return {
    core,
    host,
    dirtyEvents,
    reported: () => (dirtyEvents.length === 0 ? null : dirtyEvents[dirtyEvents.length - 1]),
  };
}

async function typeIntoEditor(core: EditorCore, keys: string): Promise<void> {
  core.focus();
  await userEvent.keyboard(keys);
}

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    entry.core.destroy();
    entry.host.remove();
  }
});

describe("editor core dirty tracking", () => {
  it("keeps the line-number gutter at its intrinsic width", () => {
    const editor = mount();
    const gutter = editor.host.querySelector<HTMLElement>(".cm-gutters");
    const content = editor.host.querySelector<HTMLElement>(".cm-content");

    if (gutter === null || content === null) {
      throw new Error("editor gutters did not mount");
    }

    // A gutter is a fixed margin, never the pane's growing flex child. The
    // content must retain the overwhelming majority of the editor width.
    expect(getComputedStyle(gutter).flex).toBe("0 0 auto");
    expect(gutter.getBoundingClientRect().width).toBeLessThan(80);
    expect(content.getBoundingClientRect().width).toBeGreaterThan(
      gutter.getBoundingClientRect().width * 8,
    );
  });

  it("stays quiet on a document that opens at its saved text", () => {
    const editor = mount();
    expect(editor.reported()).toBe(null);
  });

  it("reports dirty on a typed edit and clean again when it is undone", async () => {
    const editor = mount();
    await typeIntoEditor(editor.core, "x");
    expect(editor.core.getDoc()).not.toBe(SAVED);
    expect(editor.reported()).toBe(true);

    await userEvent.keyboard(UNDO_KEYS);
    expect(editor.core.getDoc()).toBe(SAVED);
    expect(editor.reported()).toBe(false);
    expect(editor.dirtyEvents).toEqual([true, false]);
  });

  it("goes dirty again when the undone edit is redone", async () => {
    const editor = mount();
    await typeIntoEditor(editor.core, "x");
    await userEvent.keyboard(UNDO_KEYS);
    await userEvent.keyboard(REDO_KEYS);
    expect(editor.core.getDoc()).not.toBe(SAVED);
    expect(editor.reported()).toBe(true);
  });

  it("reports clean when a cut is put back by a paste", () => {
    const editor = mount();
    // What the host's cut/paste actions do: select, overwrite with "", then
    // overwrite with the clipboard text.
    editor.core.selectAll();
    editor.core.replaceSelection("");
    expect(editor.reported()).toBe(true);

    editor.core.selectAll();
    editor.core.replaceSelection(SAVED);
    expect(editor.core.getDoc()).toBe(SAVED);
    expect(editor.reported()).toBe(false);
  });

  it("stays dirty for an edit that keeps the document length", () => {
    const editor = mount();
    editor.core.selectLines(1, 1);
    editor.core.replaceSelection("const a = 9;");
    expect(editor.core.getDoc()).toHaveLength(SAVED.length);
    expect(editor.reported()).toBe(true);
  });

  it("adopts a replaced document as the saved text", () => {
    const editor = mount();
    editor.core.selectAll();
    editor.core.replaceSelection("edited\n");
    expect(editor.reported()).toBe(true);

    // Revert / reload-from-disk.
    editor.core.setDoc(SAVED);
    expect(editor.reported()).toBe(false);
  });

  it("mounts a recovered draft dirty and clears it once that draft is the saved text", () => {
    const editor = mount({ doc: "recovered\n", cleanDoc: SAVED });
    expect(editor.dirtyEvents).toEqual([true]);

    // A save landing on the recovered text: the host hands over the new baseline.
    editor.core.setCleanDoc("recovered\n");
    expect(editor.reported()).toBe(false);
  });

  it("keeps a save that landed mid-edit dirty against what was actually written", () => {
    const editor = mount();
    editor.core.selectLines(1, 1);
    editor.core.replaceSelection("const a = 9;");
    const written = editor.core.getDoc();

    // The user types again while the write is in flight...
    editor.core.selectLines(2, 2);
    editor.core.replaceSelection("const b = 7;");
    // ...so the landed save does not make the buffer clean.
    editor.core.setCleanDoc(written);
    expect(editor.reported()).toBe(true);

    editor.core.setCleanDoc(editor.core.getDoc());
    expect(editor.reported()).toBe(false);
  });
});
