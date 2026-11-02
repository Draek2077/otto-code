import path from "node:path";
import { TerminalShellUnavailableError } from "./errors.js";
import { existsSync } from "node:fs";
import { findExecutableWithoutProbing } from "../../../executable-resolution/executable-resolution.js";
import type { TerminalPreferences } from "@getpaseo/plugin/otto/terminal";

export async function terminalShellOverride(input: {
  command?: string;
  shell?: string;
  ottoPreferences?: TerminalPreferences;
}) {
  if (input.command || input.shell || !input.ottoPreferences) return input.shell;
  return terminalShell(input.ottoPreferences);
}
export function terminalTitleMode(
  mode: "auto" | "manual",
  preferences: TerminalPreferences | undefined,
): "auto" | "manual" {
  return preferences?.terminalTitleMode === "default" ? "manual" : mode;
}
export function terminalInitialTitle(input: {
  manual: string | undefined;
  initial: string | undefined;
  process: string | null;
  name: string;
  preferences: TerminalPreferences | undefined;
}) {
  if (input.manual || !input.preferences) return input.initial;
  if (input.preferences.terminalTitleMode === "default") return input.name;
  const title = input.preferences.terminalTitleIncludePaths ? input.process : input.initial;
  return terminalAutomaticTitle(title ?? "", input.preferences.terminalTitleIncludePaths);
}
export function terminalNextTitle(value: string, preferences: TerminalPreferences | undefined) {
  if (!preferences) return value.trim() || undefined;
  return terminalAutomaticTitle(value, preferences.terminalTitleIncludePaths);
}

export async function terminalShellChoices(platform = process.platform, env = process.env) {
  const shells: Array<{
    id: TerminalPreferences["defaultTerminalShell"];
    label: string;
    available: boolean;
  }> = [{ id: "system", label: "System default", available: true }];
  if (platform !== "win32") return shells;
  const root = env.SystemRoot ?? env.WINDIR ?? "C:\\Windows";
  const candidates: Array<{
    id: TerminalPreferences["defaultTerminalShell"];
    label: string;
    available: boolean;
  }> = [
    {
      id: "command-prompt",
      label: "Command Prompt",
      available: existsSync(env.ComSpec ?? path.win32.join(root, "System32", "cmd.exe")),
    },
    {
      id: "windows-powershell",
      label: "Windows PowerShell",
      available: existsSync(
        path.win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      ),
    },
    {
      id: "powershell-7",
      label: "PowerShell 7",
      available: (await findExecutableWithoutProbing("pwsh.exe", { cwd: process.cwd() })) !== null,
    },
  ];
  return [...shells, ...candidates];
}

export async function terminalShell(preferences: TerminalPreferences): Promise<string | undefined> {
  if (process.platform !== "win32" || preferences.defaultTerminalShell === "system")
    return undefined;
  const root = process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
  switch (preferences.defaultTerminalShell) {
    case "command-prompt":
      return requireShell(process.env.ComSpec ?? path.win32.join(root, "System32", "cmd.exe"));
    case "windows-powershell":
      return requireShell(
        path.win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      );
    case "powershell-7": {
      const executable = await findExecutableWithoutProbing("pwsh.exe", { cwd: process.cwd() });
      if (!executable) throw new TerminalShellUnavailableError("PowerShell 7");
      return executable;
    }
  }
}

function requireShell(executable: string): string {
  if (!existsSync(executable))
    throw new TerminalShellUnavailableError("The selected terminal shell");
  return executable;
}

/** OSC titles can contain Windows paths even when observed from a POSIX client. */
export function terminalAutomaticTitle(value: string, includePaths: boolean): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (includePaths) return trimmed;
  return trimmed.replace(/(?:[A-Za-z]:)?[\\/][^\s"']+/gu, (token) => {
    const parts = token.replace(/[\\/]+$/u, "").split(/[\\/]/u);
    return parts.at(-1) || token;
  });
}
