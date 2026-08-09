import { extname } from "node:path";

export interface WindowsCommandScriptInvocation {
  command: string;
  args: string[];
  windowsVerbatimArguments: true;
}

export function isWindowsCommandScript(executablePath: string): boolean {
  const extension = extname(executablePath).toLowerCase();
  return process.platform === "win32" && (extension === ".cmd" || extension === ".bat");
}

function escapeWindowsCmdValue(value: string): string {
  if (process.platform !== "win32") return value;

  const isQuoted = value.startsWith('"') && value.endsWith('"');
  const unquoted = isQuoted ? value.slice(1, -1) : value;
  // Do NOT double `%` here. cmd.exe only collapses `%%` → `%` inside batch
  // files; on the command line / `cmd /c "..."` `%%` stays literal, which
  // breaks args like git's `--format=%(refname)` (git treats `%%` as the
  // escape for a literal `%`, so the format atoms become literals).
  if (isQuoted || /[\s"]/u.test(unquoted)) {
    // cmd treats metacharacters inside quotes as literal. Escaping them here
    // would pass the caret through to a batch script's argv.
    const quoted = unquoted
      .split('"')
      .map((segment) => {
        let trailingStart = segment.length;
        while (trailingStart > 0 && segment.charCodeAt(trailingStart - 1) === 92) {
          trailingStart -= 1;
        }
        const trailing = segment.slice(trailingStart);
        return `${segment.slice(0, trailingStart)}${trailing}${trailing}`;
      })
      .join('\\"');
    return `"${quoted}"`;
  }

  return unquoted.replace(/([&|^<>()!])/g, "^$1");
}

/**
 * When spawning with `shell: true` on Windows, the command is passed to
 * `cmd.exe /d /s /c "command args"`. The `/s` strips outer quotes, so a
 * command path with spaces (e.g. `C:\Program Files\...`) is split at the
 * space. Wrapping it in quotes produces the correct `"C:\Program Files\..." args`.
 */
export function quoteWindowsCommand(command: string): string {
  return escapeWindowsCmdValue(command);
}

/**
 * `spawn(..., { shell: true })` on Windows also passes argv through `cmd.exe`.
 * Any argument containing spaces must be quoted or it will be split before the
 * child process sees it.
 */
export function quoteWindowsArgument(argument: string): string {
  return escapeWindowsCmdValue(argument);
}

/**
 * Node no longer supports invoking `.cmd` and `.bat` files directly. Run a
 * resolved command script through ComSpec ourselves instead of asking Node for
 * `shell: true`: that keeps native executables on CreateProcess and keeps the
 * script's argv explicitly quoted.
 */
export function planWindowsCommandScriptInvocation(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): WindowsCommandScriptInvocation | null {
  if (!isWindowsCommandScript(command)) return null;

  const quotedCommand = [quoteWindowsCommand(command), ...args.map(quoteWindowsArgument)].join(" ");
  return {
    command: env.ComSpec ?? env.COMSPEC ?? "C:\\Windows\\System32\\cmd.exe",
    args: ["/d", "/s", "/c", `"${quotedCommand}"`],
    windowsVerbatimArguments: true,
  };
}
