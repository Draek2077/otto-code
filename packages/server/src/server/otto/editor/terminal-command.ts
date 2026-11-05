import { EditorError } from "./errors.js";

/** An argv grammar, not a shell: quotes group arguments; backslashes remain
 * literal (including Windows paths). No substitution, pipes or redirects. */
export function editorCommandArguments(command: string): string[] {
  const result: string[] = [];
  let word = "";
  let quote: string | null = null;
  let started = false;
  for (const character of command) {
    if (character === quote) {
      quote = null;
      continue;
    }
    if (!quote && (character === '"' || character === "'")) {
      quote = character;
      started = true;
      continue;
    }
    if (!quote && /\s/u.test(character)) {
      if (started) result.push(word);
      word = "";
      started = false;
      continue;
    }
    word += character;
    started = true;
  }
  if (quote) throw new EditorError("invalid", "Close the quote in the editor command.");
  if (started) result.push(word);
  if (!result[0])
    throw new EditorError("invalid", "Enter an editor executable and optional arguments.");
  return result;
}
export function editorLaunchArguments(
  mode: "vim" | "neovim" | "custom",
  custom: string,
  file: string,
  line: number | null,
) {
  if (mode === "custom") {
    const [command, ...args] = editorCommandArguments(custom);
    if (!command) throw new EditorError("invalid", "Enter an editor executable.");
    return { command, args: [...args, file] };
  }
  return {
    command: mode === "vim" ? "vim" : "nvim",
    args: [...(line ? [`+${line}`] : []), "--", file],
  };
}
