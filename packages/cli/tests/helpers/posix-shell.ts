/**
 * POSIX shell resolution for the CLI E2E suite.
 *
 * Every test file here drives the CLI through zx's `$`, and zx picks its shell
 * exactly once, at import time, by probing PATH for `bash`. When it finds none
 * it swallows the failure and leaves `$.quote` undefined, so the first `$` call
 * dies with the opaque "No quote function is defined".
 *
 * Windows hosts land there by default. The only `bash` normally on PATH is the
 * WSL app-execution stub under WindowsApps: zx cannot resolve it, and even if
 * it could, running the suite inside WSL would hand the CLI a Linux filesystem
 * where none of these Windows temp paths exist. Git Bash is a real POSIX shell
 * that stays on win32, but it lives in Git's `bin` directory and the installer
 * only puts `cmd` on PATH.
 *
 * This module is pure so the runner can ask whether the host can run the suite
 * without mutating zx's globals. Test files import `./zx-shell.ts`, which
 * applies the configuration as a side effect.
 */

import { existsSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { $, quote } from "zx";

export const MISSING_SHELL_MESSAGE =
  "No POSIX shell available: this suite runs every CLI command through bash, and zx could not " +
  "resolve one. On Windows, install Git for Windows and either add its bin directory to PATH " +
  '(for example "C:\\Program Files\\Git\\bin") or point OTTO_TEST_BASH at bash.exe. The bash.exe ' +
  "under WindowsApps is the WSL launcher and cannot run these tests, which drive Windows paths.";

/** WindowsApps holds app-execution aliases, including the WSL `bash.exe` stub. */
const WINDOWS_APPS = "windowsapps";

function gitBashCandidates(): string[] {
  const candidates: string[] = [];
  const add = (path: string | undefined): void => {
    if (path && !candidates.includes(path)) {
      candidates.push(path);
    }
  };

  // Standard install locations first, so the canonical `<git install>\bin\bash.exe`
  // wins over the `usr\bin` copy that a Git Bash session puts on PATH.
  const roots = [
    process.env.GIT_INSTALL_ROOT,
    process.env.ProgramFiles ? join(process.env.ProgramFiles, "Git") : undefined,
    process.env.ProgramW6432 ? join(process.env.ProgramW6432, "Git") : undefined,
    process.env["ProgramFiles(x86)"] ? join(process.env["ProgramFiles(x86)"], "Git") : undefined,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs", "Git") : undefined,
  ];
  for (const root of roots) {
    if (root) add(join(root, "bin", "bash.exe"));
  }

  // Then derive from PATH, which picks up non-default install locations. The
  // installer puts `<git install>\cmd` on PATH; bash sits one directory over.
  for (const entry of (process.env.PATH ?? "").split(delimiter)) {
    const dir = entry.trim().replace(/[\\/]+$/, "");
    const lower = dir.toLowerCase();
    if (!dir || !lower.includes("git") || lower.includes(WINDOWS_APPS)) {
      continue;
    }
    add(resolve(dir, "..", "bin", "bash.exe"));
    add(join(dir, "bash.exe"));
  }

  return candidates;
}

/**
 * POSIX single-quoting, which zx does not offer.
 *
 * zx's own `quote` emits bash ANSI-C literals (`$'...'`) and doubles every
 * backslash inside them. That is correct on Linux and wrong through Git Bash:
 * the MSYS runtime re-parses the Windows command line before bash ever sees it
 * and collapses `\\` back to `\`, so bash's ANSI-C pass then reads the `\n` in
 * `C:\nodejs` as a newline and the path is destroyed. Lone backslashes pass
 * through MSYS untouched, and bash performs no escape processing at all inside
 * single quotes, so this form survives both layers.
 */
export function quotePosix(arg: string): string {
  if (arg === "") return "''";
  if (/^[\w/.\-@:=]+$/.test(arg)) return arg;
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

/** Returns the bash zx will use, or null when the host has none. */
export function findPosixShell(): string | null {
  const override = process.env.OTTO_TEST_BASH;
  if (override) {
    return existsSync(override) ? override : null;
  }
  if (typeof $.quote === "function") {
    // zx already resolved a bash of its own on this host.
    return typeof $.shell === "string" ? $.shell : "bash";
  }
  if (process.platform !== "win32") {
    return null;
  }
  return gitBashCandidates().find((candidate) => existsSync(candidate)) ?? null;
}

/** Points zx at a POSIX shell when it could not find one itself. */
export function configureZxShell(): void {
  const shell = findPosixShell();
  if (!shell) {
    throw new Error(MISSING_SHELL_MESSAGE);
  }
  if (typeof $.quote !== "function" || process.env.OTTO_TEST_BASH) {
    // Mirrors what zx's own useBash() would have done.
    $.shell = shell;
    $.prefix = "set -euo pipefail;";
    $.postfix = "";
    $.quote = quote;
  }

  // Correct the quoting even when zx resolved a shell on its own, which it
  // does from inside a Git Bash session: the ANSI-C literals it emits are
  // wrong through MSYS no matter who picked the shell. Everywhere else zx's
  // own quoting stands, so this cannot change how CI runs the suite.
  if (process.platform === "win32") {
    $.quote = quotePosix;
  }
}
