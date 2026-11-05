import { describe, expect, it } from "vitest";
import {
  buildEffectiveBindings,
  buildKeyboardShortcutHelpSections,
  resolveKeyboardShortcut,
} from "@/keyboard/keyboard-shortcuts";
import { buildEditorKeyBindings } from "./bindings";
function match(scope: "other" | "code-editor" | "markdown-editor") {
  return resolveKeyboardShortcut({
    event: {
      key: "b",
      code: "KeyB",
      ctrlKey: true,
      altKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
    },
    context: { isMac: false, isDesktop: true, focusScope: scope, commandCenterOpen: false },
    chordState: { candidateIndices: [], step: 0, timeoutId: null },
    onChordReset() {},
  }).match?.action;
}
describe("editor shortcuts through the existing Settings registry", () => {
  it("keeps general navigation outside the editor and gives the focused Markdown command priority", () => {
    expect(match("other")).toBe("sidebar.toggle.left");
    expect(match("code-editor")).toBe("editor.goToDefinition");
    expect(match("markdown-editor")).toBe("editor.markdown.bold");
    const sections = buildKeyboardShortcutHelpSections({ isMac: false, isDesktop: true });
    expect(
      sections.find((section) => section.id === "editor")?.rows.map((row) => row.id),
    ).toContain("editor-rename-symbol");
  });
  it("retains old binding identities, unassignment, function-key aliases and every step of a rebound chord", () => {
    const keys = buildEditorKeyBindings(
      buildEffectiveBindings({ "editor-save-mod-s": "Ctrl+K Ctrl+S", "editor-find-mod-f": null }),
    );
    expect(keys).toContainEqual({ action: "save", key: "Ctrl-k Ctrl-s" });
    expect(keys.some((binding) => binding.action === "find")).toBe(false);
    expect(keys).toContainEqual({ action: "goToDefinition", key: "F12" });
  });
  it("honors a chord prefix without giving CodeMirror a conflicting regular key", () => {
    const keys = buildEditorKeyBindings(buildEffectiveBindings({ "editor-save-mod-s": "Mod+B X" }));
    expect(keys).toContainEqual({ action: "save", key: "Mod-b x" });
    expect(keys.some((binding) => binding.key === "Mod-b")).toBe(false);
  });
});
