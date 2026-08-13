import { userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it } from "vitest";
import { resolveSyntaxColors } from "@otto-code/highlight";
import type { EditorThemeSpec } from "./editor-contract";
import { createEditorCore, type EditorCore } from "./editor-core";
import { normalizeVimMappingSettings, type VimMappingAction } from "./vim-mappings";

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

const mounted: Array<{ core: EditorCore; host: HTMLElement }> = [];

function mount(
  options: {
    vimKeybindings?: boolean;
    onVimModeChanged?: (mode: "NORMAL" | "INSERT" | "VISUAL" | "REPLACE" | null) => void;
    onVimMappingPendingChanged?: (pending: boolean) => void;
    onSaveShortcut?: () => void;
    onFindShortcut?: () => void;
    onGoToDefinitionShortcut?: () => void;
    onFindReferencesShortcut?: () => void;
    onRenameSymbolShortcut?: () => void;
    vimMappings?: ReturnType<typeof normalizeVimMappingSettings>;
    onVimAction?: (action: VimMappingAction) => void;
  } = {},
): EditorCore {
  const host = document.createElement("div");
  host.style.height = "300px";
  document.body.appendChild(host);
  const core = createEditorCore({
    parent: host,
    path: "src/example.ts",
    doc: "const value = true;\n",
    theme: THEME,
    wordWrap: false,
    ...options,
  });
  mounted.push({ core, host });
  return core;
}

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    entry.core.destroy();
    entry.host.remove();
  }
});

describe("editor core Vim mode", () => {
  it("reports NORMAL and INSERT and can be toggled without remounting", async () => {
    const modes: Array<string | null> = [];
    const core = mount({
      vimKeybindings: true,
      onVimModeChanged: (mode) => modes.push(mode),
    });

    core.focus();
    expect(modes.at(-1)).toBe("NORMAL");
    await userEvent.keyboard("i");
    expect(modes.at(-1)).toBe("INSERT");
    await userEvent.keyboard("{Escape}");
    expect(modes.at(-1)).toBe("NORMAL");

    core.setVimKeybindings(false);
    expect(modes.at(-1)).toBe(null);
    await userEvent.keyboard("i");
    expect(core.getDoc()).toContain("i");
  });

  it("keeps Otto editor shortcuts available in Vim mode", async () => {
    const calls = {
      save: 0,
      find: 0,
      definition: 0,
      references: 0,
      rename: 0,
    };
    const core = mount({
      vimKeybindings: true,
      onSaveShortcut: () => (calls.save += 1),
      onFindShortcut: () => (calls.find += 1),
      onGoToDefinitionShortcut: () => (calls.definition += 1),
      onFindReferencesShortcut: () => (calls.references += 1),
      onRenameSymbolShortcut: () => (calls.rename += 1),
    });

    core.focus();
    await userEvent.keyboard("{Control>}s{/Control}");
    await userEvent.keyboard("{Control>}f{/Control}");
    await userEvent.keyboard("{F12}");
    await userEvent.keyboard("{Shift>}{F12}{/Shift}");
    await userEvent.keyboard("{F2}");

    expect(calls).toEqual({ save: 1, find: 1, definition: 1, references: 1, rename: 1 });
  });

  it("runs only configured leader mappings in normal mode and leaves Otto chords alone", async () => {
    const actions: VimMappingAction[] = [];
    const calls = { find: 0 };
    const pending: boolean[] = [];
    const core = mount({
      vimKeybindings: true,
      vimMappings: normalizeVimMappingSettings({
        leader: "Space",
        mappings: { openChanges: "c", find: "f", unsupported: "x" },
      }),
      onVimAction: (action) => actions.push(action),
      onVimMappingPendingChanged: (value) => pending.push(value),
      onFindShortcut: () => (calls.find += 1),
    });

    core.focus();
    await userEvent.keyboard("{Space}");
    expect(pending.at(-1)).toBe(true);
    await userEvent.keyboard("c");
    expect(actions).toEqual(["openChanges"]);
    expect(pending.at(-1)).toBe(false);

    await userEvent.keyboard("{Control>}f{/Control}");
    expect(calls.find).toBe(1);

    await userEvent.keyboard("i{Space}f{Escape}");
    expect(actions).toEqual(["openChanges"]);
  });
});
