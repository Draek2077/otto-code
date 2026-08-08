import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

export type WindowsTerminalShellId = "command-prompt" | "windows-powershell" | "powershell-7";

export interface WindowsTerminalShell {
  id: WindowsTerminalShellId;
  label: string;
}

function isOnPath(command: string, env: NodeJS.ProcessEnv): boolean {
  const pathValue = env.Path || env.PATH || "";
  return pathValue.split(delimiter).some((directory) => {
    const trimmed = directory.trim();
    return trimmed.length > 0 && existsSync(join(trimmed, command));
  });
}

/** The host-owned, synchronous discovery used to populate Windows Terminal settings. */
export function detectWindowsTerminalShells(
  env: NodeJS.ProcessEnv = process.env,
): WindowsTerminalShell[] {
  const shells: WindowsTerminalShell[] = [{ id: "command-prompt", label: "Command Prompt" }];
  const systemRoot = env.SystemRoot || env.WINDIR || "C:\\Windows";
  if (existsSync(join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"))) {
    shells.push({ id: "windows-powershell", label: "Windows PowerShell" });
  }
  if (isOnPath("pwsh.exe", env)) {
    shells.push({ id: "powershell-7", label: "PowerShell 7" });
  }
  return shells;
}
