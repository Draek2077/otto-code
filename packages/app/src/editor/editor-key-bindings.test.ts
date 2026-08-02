import { describe, expect, it } from "vitest";
import { buildEffectiveBindings } from "@/keyboard/keyboard-shortcuts";
import { DEFAULT_EDITOR_KEY_BINDINGS } from "./editor-contract";
import { buildEditorKeyBindings, comboStringToCodeMirrorKey } from "./editor-key-bindings";

describe("comboStringToCodeMirrorKey", () => {
  it("translates the registry's spelling into CodeMirror's", () => {
    // Mod survives as Mod: it means the same Cmd-on-mac/Ctrl-elsewhere thing in
    // both systems, which is what lets one registry row serve both platforms.
    expect(comboStringToCodeMirrorKey("Mod+S")).toBe("Mod-s");
    expect(comboStringToCodeMirrorKey("Mod+Shift+F")).toBe("Mod-Shift-f");
    expect(comboStringToCodeMirrorKey("Cmd+G")).toBe("Meta-g");
    expect(comboStringToCodeMirrorKey("Ctrl+Alt+P")).toBe("Ctrl-Alt-p");
    // Keys with no printable character are named by their code, which for this
    // set is already the KeyboardEvent.key CodeMirror matches on.
    expect(comboStringToCodeMirrorKey("F2")).toBe("F2");
    expect(comboStringToCodeMirrorKey("Shift+F12")).toBe("Shift-F12");
    expect(comboStringToCodeMirrorKey("Mod+ArrowUp")).toBe("Mod-ArrowUp");
  });

  it("returns null rather than a wrong key for anything untranslatable", () => {
    expect(comboStringToCodeMirrorKey("Mod+Digit")).toBeNull();
    expect(comboStringToCodeMirrorKey("Ctrl+Nonsense")).toBeNull();
    expect(comboStringToCodeMirrorKey("")).toBeNull();
  });
});

describe("buildEditorKeyBindings", () => {
  it("keeps the core's fallback defaults in step with the registry", () => {
    // The native webview cannot read the registry and restates these; if the two
    // drift, a phone gets a different editor from a desktop. Fail here instead.
    expect(buildEditorKeyBindings()).toEqual([...DEFAULT_EDITOR_KEY_BINDINGS]);
  });

  it("takes the File Editor and Markdown Editor sections, and nothing else", () => {
    const actions = new Set(buildEditorKeyBindings().map((binding) => binding.action));
    expect(actions).toEqual(
      new Set([
        "save",
        "find",
        "goToLine",
        "goToDefinition",
        "findReferences",
        "renameSymbol",
        "markdownBold",
        "markdownItalic",
        "markdownCode",
        "markdownStrikethrough",
        "markdownLink",
        "markdownBulletList",
        "markdownOrderedList",
        "markdownTaskList",
        "markdownToggleTask",
        "markdownBlockquote",
      ]),
    );
    // No general binding leaks in. Mod-k IS in the keymap now, but as the
    // markdown link command rather than the command center: the editor claims it
    // through a registry row of its own, scoped to markdown, not by accident.
    const modK = buildEditorKeyBindings().filter((binding) => binding.key === "Mod-k");
    expect(modK).toEqual([{ action: "markdownLink", key: "Mod-k" }]);
  });

  // The single most load-bearing detail of the markdown keymap. The commands
  // decline outside markdown and CM6 tries same-key bindings in array order, so
  // bold must be OFFERED Mod-b first for both meanings to survive.
  it("offers markdown bold Mod-b before go-to-definition", () => {
    const keys = buildEditorKeyBindings();
    const bold = keys.findIndex((binding) => binding.action === "markdownBold");
    const definition = keys.findIndex(
      (binding) => binding.action === "goToDefinition" && binding.key === "Mod-b",
    );
    expect(bold).toBeGreaterThanOrEqual(0);
    expect(definition).toBeGreaterThan(bold);
    expect(keys[bold]?.key).toBe("Mod-b");
  });

  it("carries a user rebind into the editor keymap", () => {
    const bindings = buildEditorKeyBindings(
      buildEffectiveBindings({ "editor-save-mod-s": "Ctrl+Alt+W" }),
    );
    expect(bindings).toContainEqual({ action: "save", key: "Ctrl-Alt-w" });
    expect(bindings).not.toContainEqual({ action: "save", key: "Mod-s" });
    // Everything else is untouched — a rebind is per row, not per section.
    expect(bindings).toContainEqual({ action: "find", key: "Mod-f" });
  });

  it("keeps both go-to-definition keys, including the alias with no settings row", () => {
    const keys = buildEditorKeyBindings()
      .filter((binding) => binding.action === "goToDefinition")
      .map((binding) => binding.key);
    expect(keys).toEqual(["Mod-b", "F12"]);
  });

  it("drops a command rebound to a chord rather than binding its first step", () => {
    // CodeMirror is not running the app's chord state machine; a half-matched
    // chord that fired on its prefix would be a different shortcut, not this one.
    const bindings = buildEditorKeyBindings(
      buildEffectiveBindings({ "editor-find-mod-f": "Ctrl+K Ctrl+F" }),
    );
    expect(bindings.some((binding) => binding.action === "find")).toBe(false);
    expect(bindings.some((binding) => binding.key === "Ctrl-k")).toBe(false);
  });

  it("survives a corrupt stored override by dropping only that binding", () => {
    const bindings = buildEditorKeyBindings(
      buildEffectiveBindings({ "editor-rename-symbol-f2": "Ctrl+" }),
    );
    // buildEffectiveBindings already refuses an unparseable override and keeps
    // the default; either way the rest of the keymap has to come through whole.
    expect(bindings.filter((binding) => binding.action === "find")).toHaveLength(1);
    expect(bindings.length).toBeGreaterThanOrEqual(6);
  });
});
