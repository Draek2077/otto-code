import { describe, expect, it } from "vitest";
import { editorCommandArguments, editorLaunchArguments } from "./terminal-command.js";

describe("terminal file-editor argv", () => {
  it("keeps quoted Windows executables and literal shell metacharacters out of a shell", () => {
    expect(
      editorCommandArguments(
        '"C:\\Program Files\\Neovim\\bin\\nvim.exe" --clean "a b" "$HOME;$(whoami)"',
      ),
    ).toEqual(["C:\\Program Files\\Neovim\\bin\\nvim.exe", "--clean", "a b", "$HOME;$(whoami)"]);
    expect(() => editorCommandArguments('nvim "unterminated')).toThrow("quote");
    expect(() => editorCommandArguments('""')).toThrow("executable");
  });
  it("appends a filename as one argument and separates built-in editor options", () => {
    const file = "C:\\workspace\\+danger ; $(command).ts";
    expect(editorLaunchArguments("neovim", "", file, 12)).toEqual({
      command: "nvim",
      args: ["+12", "--", file],
    });
    expect(editorLaunchArguments("custom", "my-editor --wait", file, null)).toEqual({
      command: "my-editor",
      args: ["--wait", file],
    });
  });
});
