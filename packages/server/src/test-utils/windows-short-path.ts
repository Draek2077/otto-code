import { execFileSync } from "node:child_process";

/** A real 8.3 spelling, when the fixture's Windows volume supports one. */
export function windowsShortPath(directory: string): string {
  return execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:OTTO_SHORT_PATH_FIXTURE).ShortPath",
    ],
    { encoding: "utf8", env: { ...process.env, OTTO_SHORT_PATH_FIXTURE: directory } },
  ).trim();
}
