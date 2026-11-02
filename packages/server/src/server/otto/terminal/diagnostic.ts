import { execFile } from "node:child_process";
import { mkdtemp, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { findExecutableWithoutProbing } from "../../../executable-resolution/executable-resolution.js";
import type { TerminalManager } from "../../../terminal/terminal-manager.js";
import type { TerminalCheck, TerminalDiagnostic } from "@getpaseo/plugin/otto/terminal";

function check(
  id: string,
  label: string,
  status: TerminalCheck["status"],
  detail: string,
): TerminalCheck {
  return { id, label, status, detail };
}
async function command(executable: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      { timeout: 2000, maxBuffer: 65536, windowsHide: true },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}
export function alternateScreenPassed(alternate: string, restored: string): boolean {
  return (
    alternate.includes("OTTO_ALT") &&
    !alternate.includes("OTTO_PRIMARY") &&
    restored.includes("OTTO_PRIMARY") &&
    restored.includes("OTTO_DONE") &&
    !restored.includes("OTTO_ALT")
  );
}
/** Only a deliberate check starts this bounded scratch process, never settings reads. */
async function probePty(manager: TerminalManager): Promise<TerminalCheck[]> {
  const cwd = await mkdtemp(path.join(tmpdir(), "otto-terminal-check-"));
  let session: Awaited<ReturnType<TerminalManager["createTerminal"]>> | null = null;
  try {
    let executable = "/bin/sh";
    let args = [
      "-c",
      "printf OTTO_PRIMARY; sleep 0.2; printf '\\033[?1049h\\033[2J\\033[HOTTO_ALT'; sleep 0.5; printf '\\033[?1049l\\r\\nOTTO_DONE'; sleep 0.2",
    ];
    if (process.platform === "win32") {
      executable = path.win32.join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      );
      args = [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        '$e=[char]27; [Console]::Write(\'OTTO_PRIMARY\'); Start-Sleep -Milliseconds 200; [Console]::Write("$e[?1049h$e[2J${e}[HOTTO_ALT"); Start-Sleep -Milliseconds 500; [Console]::Write("$e[?1049l`r`nOTTO_DONE"); Start-Sleep -Milliseconds 200',
      ];
    }
    session = await manager.createTerminal({
      cwd,
      workspaceId: "__otto_terminal_check__",
      command: executable,
      args,
      rows: 24,
      cols: 80,
    });
    const id = session.id;
    session.send({ type: "resize", rows: 32, cols: 100 });
    let alternate = "";
    let restored = "";
    let resized = false;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const snapshot = await manager.getTerminalState(id);
      if (snapshot) {
        const state = snapshot.state;
        const text = state.grid.map((row) => row.map((cell) => cell.char).join("")).join("\n");
        resized ||= state.rows === 32 && state.cols === 100;
        if (text.includes("OTTO_ALT")) alternate = text;
        if (text.includes("OTTO_DONE")) {
          restored = text;
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return [
      check(
        "resize",
        "PTY resize",
        resized ? "pass" : "warn",
        resized
          ? "The existing PTY reported 32 rows × 100 columns."
          : "The requested size was not observed before the probe ended.",
      ),
      check(
        "alternate-screen",
        "Alternate screen",
        alternateScreenPassed(alternate, restored) ? "pass" : "warn",
        "Pass requires an isolated alternate buffer and restoration of the original primary buffer. This does not test client input or rendering.",
      ),
    ];
  } finally {
    try {
      if (session) await manager.killTerminalAndWait(session.id);
    } finally {
      await rmdir(cwd);
    }
  }
}
async function executableCheck(name: string, label: string): Promise<TerminalCheck> {
  try {
    const executable = await findExecutableWithoutProbing(name, { cwd: process.cwd() });
    return check(
      name,
      label,
      executable ? "pass" : "warn",
      executable
        ? `Available on the owning host: ${executable}`
        : `${name} was not found on the owning host PATH. Otto will not install it.`,
    );
  } catch {
    return check(name, label, "unknown", "Host executable discovery failed.");
  }
}
async function terminfo(): Promise<TerminalCheck[]> {
  const executable = await findExecutableWithoutProbing("infocmp", { cwd: process.cwd() });
  if (!executable)
    return [
      check(
        "terminfo",
        "terminfo",
        "unknown",
        "infocmp is unavailable. The host terminal database was not checked.",
      ),
    ];
  try {
    // Paseo's PTY launches with this TERM; the daemon's own TERM is unrelated.
    const output = await command(executable, ["-1", "xterm-256color"]);
    const rgb = /(?:RGB|Tc)(?:,|=|\s)/u.test(output);
    return [
      check(
        "terminfo",
        "terminfo",
        "pass",
        "xterm-256color is available in the host terminal database.",
      ),
      check(
        "true-color",
        "True color",
        rgb ? "pass" : "unknown",
        rgb
          ? "The host terminfo entry advertises RGB/Tc."
          : "True-color support was not established by this terminfo entry. Terminal brand metadata is not proof.",
      ),
    ];
  } catch {
    return [
      check("terminfo", "terminfo", "warn", "The host database did not provide xterm-256color."),
    ];
  }
}
export async function diagnose(manager: TerminalManager): Promise<TerminalDiagnostic> {
  const checks: TerminalCheck[] = [];
  for (const [name, label] of [
    ["vim", "Vim"],
    ["nvim", "Neovim"],
    ["tmux", "tmux"],
    ["difft", "Difftastic"],
  ])
    checks.push(await executableCheck(name, label));
  try {
    checks.push(...(await terminfo()));
  } catch {
    checks.push(
      check("terminfo", "terminfo", "unknown", "Host terminal database discovery failed."),
    );
  }
  try {
    checks.push(...(await probePty(manager)));
  } catch {
    checks.push(
      check(
        "pty",
        "PTY probe",
        "unknown",
        "The temporary PTY probe could not complete. Existing terminals were left unchanged.",
      ),
    );
  }
  checks.push(
    check(
      "glyphs",
      "Nerd Font symbols",
      "unknown",
      "Otto bundles Symbols Nerd Font Mono. Host diagnostics cannot verify rendering on the connected client.",
    ),
  );
  checks.push(
    check(
      "interaction",
      "Clipboard, mouse and reconnect",
      "unknown",
      "These require interactive client verification. No user editor, configuration or terminal was changed.",
    ),
  );
  return { checkedAt: new Date().toISOString(), checks };
}
