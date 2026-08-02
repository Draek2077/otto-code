import { describe, expect, it } from "vitest";
import { formatShortcut } from "@/utils/format-shortcut";

// Mirrors the alias table in keyboard-shortcuts-dialog.tsx. The dialog itself is
// a React component; the part worth pinning is the matching rule, which is why
// the aliases live in a pure function there and are re-derived here.
function shortcutSearchAliases(keys: string[], isMac: boolean): string {
  return keys
    .flatMap((key) => {
      if (isMac) {
        if (key === "mod" || key === "meta") return ["cmd", "command"];
        if (key === "alt") return ["alt", "option"];
        return [key];
      }
      if (key === "mod" || key === "ctrl") return ["ctrl", "control"];
      if (key === "meta") return ["win", "windows"];
      return [key];
    })
    .join(" ");
}

function searchText(keys: string[], isMac: boolean): string {
  return [
    keys.join(" "),
    formatShortcut(keys, isMac ? "mac" : "non-mac"),
    shortcutSearchAliases(keys, isMac),
  ]
    .join(" ")
    .toLocaleLowerCase();
}

describe("shortcut search matching", () => {
  // The whole reason aliases exist: on a Mac the key is `mod` and the chord
  // renders as a glyph, so neither the stored key nor the rendered label
  // contains the letters someone actually types.
  it("finds a mac shortcut typed as cmd or command", () => {
    const text = searchText(["mod", "k"], true);
    expect(text).toContain("cmd");
    expect(text).toContain("command");
  });

  it("finds the same shortcut typed as ctrl off mac", () => {
    const text = searchText(["mod", "k"], false);
    expect(text).toContain("ctrl");
    expect(text).toContain("control");
    expect(text).not.toContain("command");
  });

  it("maps alt to option on mac only", () => {
    expect(searchText(["alt", "left"], true)).toContain("option");
    expect(searchText(["alt", "left"], false)).not.toContain("option");
  });

  it("maps meta to the windows key off mac", () => {
    const text = searchText(["meta", "e"], false);
    expect(text).toContain("win");
    expect(text).toContain("windows");
  });

  it("still matches the plain key name", () => {
    expect(searchText(["mod", "shift", "f"], true)).toContain("shift");
  });
});
