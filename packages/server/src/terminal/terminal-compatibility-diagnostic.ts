import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type {
  TerminalCompatibilityDiagnosticCheck,
  TerminalCompatibilityDiagnosticResponse,
} from "@otto-code/protocol/messages";
import { findExecutable } from "../executable-resolution/executable-resolution.js";
import type { TerminalManager } from "./terminal-manager.js";

const execFile = promisify(execFileCallback);
const DIAGNOSTIC_TIMEOUT_MS = 2_000;
const PTY_PROBE_TIMEOUT_MS = 1_500;
const PTY_PROBE_OUTPUT_DELAY_MS = 250;
const PTY_PROBE_WORKSPACE_ID = "__otto_terminal_compatibility_diagnostic__";
const PTY_PROBE_SCRIPT = [
  `setTimeout(() => process.stdout.write("\\x1b[?1049h\\x1b[2JHALT_SCREEN_OK"), ${PTY_PROBE_OUTPUT_DELAY_MS});`,
  `setTimeout(() => { process.stdout.write("\\x1b[?1049lNORMAL_SCREEN_OK"); process.exit(0); }, ${PTY_PROBE_OUTPUT_DELAY_MS + 150});`,
].join(" ");
const WINDOWS_PTY_PROBE_SCRIPT = [
  `Start-Sleep -Milliseconds ${PTY_PROBE_OUTPUT_DELAY_MS}`,
  '[Console]::Out.Write("`e[?1049h`e[2JHALT_SCREEN_OK")',
  "Start-Sleep -Milliseconds 150",
  '[Console]::Out.Write("`e[?1049lNORMAL_SCREEN_OK")',
].join("; ");

type DiagnosticCheck = TerminalCompatibilityDiagnosticCheck;
type DiagnosticPayload = TerminalCompatibilityDiagnosticResponse["payload"];

interface CommandResult {
  stdout: string;
  stderr: string;
}

interface DiagnosticDependencies {
  terminalManager: TerminalManager | null;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  now?: () => Date;
  findExecutable?: (name: string) => Promise<string | null>;
  runCommand?: (command: string, args: string[], env: NodeJS.ProcessEnv) => Promise<CommandResult>;
}

export function getPtyProbeLaunch(platform: NodeJS.Platform): {
  command: string;
  args: string[];
} {
  // In the desktop app process.execPath is Electron, not plain Node. Electron
  // interprets `-e <script>` as an application path unless run-as-node is set,
  // and terminal environment sanitization deliberately removes that internal
  // runtime flag before launching user-visible processes.
  if (platform === "win32") {
    return {
      command: "powershell.exe",
      args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_PTY_PROBE_SCRIPT],
    };
  }
  return { command: process.execPath, args: ["-e", PTY_PROBE_SCRIPT] };
}

function check(
  id: string,
  label: string,
  status: DiagnosticCheck["status"],
  detail: string,
  evidence?: string,
): DiagnosticCheck {
  return {
    id,
    label,
    status,
    detail,
    ...(evidence ? { evidence } : {}),
  };
}

function normalizeCommandOutput(result: CommandResult): string {
  return `${result.stdout}\n${result.stderr}`.trim();
}

function firstLine(value: string): string | undefined {
  const line = value
    .split(/\r?\n/u)
    .map((candidate) => candidate.trim())
    .find(Boolean);
  return line ? line.slice(0, 240) : undefined;
}

function stateText(state: { grid: Array<Array<{ char: string }>> }): string {
  return state.grid.map((row) => row.map((cell) => cell.char).join("")).join("\n");
}

async function runDefaultCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  const result = await execFile(command, args, {
    env,
    timeout: DIAGNOSTIC_TIMEOUT_MS,
    maxBuffer: 64 * 1024,
    windowsHide: true,
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

async function checkExecutable(
  name: string,
  label: string,
  dependencies: Required<Pick<DiagnosticDependencies, "findExecutable">>,
): Promise<DiagnosticCheck> {
  let executable: string | null;
  try {
    executable = await dependencies.findExecutable(name);
  } catch {
    return check(
      name,
      label,
      "unknown",
      `${name} availability could not be determined by the host executable resolver.`,
    );
  }
  if (!executable) {
    return check(name, label, "fail", `${name} was not found on the host PATH.`);
  }
  return check(name, label, "pass", `${name} is available.`, executable);
}

async function checkTerminfo(
  term: string | null,
  env: NodeJS.ProcessEnv,
  dependencies: Required<Pick<DiagnosticDependencies, "findExecutable" | "runCommand">>,
): Promise<DiagnosticCheck> {
  if (!term) {
    return check(
      "terminfo",
      "terminfo",
      "unknown",
      "TERM is not set, so the host terminfo entry cannot be checked.",
    );
  }

  const infocmp = await dependencies.findExecutable("infocmp");
  if (!infocmp) {
    return check(
      "terminfo",
      "terminfo",
      "unknown",
      "infocmp is unavailable; the terminal type was not verified against a terminfo database.",
      `TERM=${term}`,
    );
  }

  try {
    const result = await dependencies.runCommand(infocmp, ["-1", term], env);
    const output = normalizeCommandOutput(result);
    return check(
      "terminfo",
      "terminfo",
      "pass",
      `The ${term} entry is present in the host terminfo database.`,
      firstLine(output) ?? `TERM=${term}`,
    );
  } catch {
    return check(
      "terminfo",
      "terminfo",
      "fail",
      `The host terminfo database does not contain a usable ${term} entry.`,
      `TERM=${term}`,
    );
  }
}

async function checkTrueColor(
  term: string | null,
  colorTerm: string | null,
  env: NodeJS.ProcessEnv,
  dependencies: Required<Pick<DiagnosticDependencies, "findExecutable" | "runCommand">>,
): Promise<DiagnosticCheck> {
  if (/^(truecolor|24bit)$/iu.test(colorTerm ?? "")) {
    return check(
      "true-color",
      "true-color",
      "pass",
      "COLORTERM declares 24-bit color support.",
      `COLORTERM=${colorTerm}`,
    );
  }

  if (!term) {
    return check("true-color", "true-color", "unknown", "TERM is not set.");
  }

  const infocmp = await dependencies.findExecutable("infocmp");
  if (!infocmp) {
    return check(
      "true-color",
      "true-color",
      "unknown",
      "Neither COLORTERM nor a terminfo capability could verify 24-bit color.",
    );
  }

  try {
    const result = await dependencies.runCommand(infocmp, ["-1", term], env);
    const output = normalizeCommandOutput(result);
    if (/\b(?:Tc|RGB)\b/iu.test(output) || /setrgb[fb]/u.test(output)) {
      return check(
        "true-color",
        "true-color",
        "pass",
        `The ${term} terminfo entry declares 24-bit color support.`,
        "terminfo RGB/Tc capability",
      );
    }
    return check(
      "true-color",
      "true-color",
      "warn",
      `The ${term} entry does not declare 24-bit color and COLORTERM is not set accordingly.`,
      `TERM=${term}`,
    );
  } catch {
    return check(
      "true-color",
      "true-color",
      "unknown",
      "The terminfo entry could not be inspected for 24-bit color.",
    );
  }
}

async function checkNerdFont(
  env: NodeJS.ProcessEnv,
  dependencies: Required<Pick<DiagnosticDependencies, "findExecutable" | "runCommand">>,
): Promise<DiagnosticCheck> {
  const fcMatch = await dependencies.findExecutable("fc-match");
  if (!fcMatch) {
    return check(
      "nerd-font",
      "Nerd Font",
      "unknown",
      "The host font database could not be queried, so Nerd Font availability is unknown.",
    );
  }

  try {
    const result = await dependencies.runCommand(
      fcMatch,
      ["-f", "%{family}\\n", "Symbols Nerd Font"],
      env,
    );
    const family = firstLine(normalizeCommandOutput(result));
    if (family && /nerd|symbols/i.test(family)) {
      return check("nerd-font", "Nerd Font", "pass", `${family} is available.`, family);
    }
    return check(
      "nerd-font",
      "Nerd Font",
      "unknown",
      "The font database answered, but it resolved to a fallback rather than proving a Nerd Font.",
      family,
    );
  } catch {
    return check(
      "nerd-font",
      "Nerd Font",
      "unknown",
      "The host font database could not verify Nerd Font availability.",
    );
  }
}

async function runPtyProbe(
  terminalManager: TerminalManager | null,
  platform: NodeJS.Platform,
): Promise<DiagnosticCheck[]> {
  if (!terminalManager) {
    return [
      check(
        "pty-resize",
        "resize",
        "unknown",
        "The daemon terminal manager is unavailable, so PTY resize was not tested.",
      ),
      check(
        "alternate-screen",
        "alternate screen",
        "unknown",
        "The daemon terminal manager is unavailable, so alternate-screen behavior was not tested.",
      ),
      check(
        "terminal-restore",
        "reconnect and restore",
        "unknown",
        "The daemon terminal manager is unavailable, so session restore was not inspected.",
      ),
    ];
  }

  let session: Awaited<ReturnType<TerminalManager["createTerminal"]>> | null = null;
  try {
    const launch = getPtyProbeLaunch(platform);
    // createTerminal starts the child immediately. Delay the probe's first output
    // so its stream listener is attached before the alternate-screen entry marker.
    session = await terminalManager.createTerminal({
      cwd: process.cwd(),
      workspaceId: PTY_PROBE_WORKSPACE_ID,
      name: "Otto compatibility diagnostic",
      ...launch,
      rows: 24,
      cols: 80,
    });

    const beforeResize = session.getSize();
    session.send({ type: "resize", rows: 32, cols: 100 });
    const afterResize = session.getSize();
    const resizeCheck =
      beforeResize.rows === 24 &&
      beforeResize.cols === 80 &&
      afterResize.rows === 32 &&
      afterResize.cols === 100
        ? check(
            "pty-resize",
            "resize",
            "pass",
            "The daemon PTY accepted a live resize.",
            "24x80 → 32x100",
          )
        : check(
            "pty-resize",
            "resize",
            "fail",
            "The daemon PTY did not report the requested live resize.",
            `${beforeResize.rows}x${beforeResize.cols} → ${afterResize.rows}x${afterResize.cols}`,
          );

    const output: string[] = [];
    const unsubscribe = session.subscribe((message) => {
      if (message.type === "output") {
        output.push(message.data);
      }
    });
    const exited = new Promise<void>((resolve) => {
      session?.onExit(() => resolve());
    });
    await Promise.race([
      exited,
      new Promise<void>((resolve) => setTimeout(resolve, PTY_PROBE_TIMEOUT_MS)),
    ]);
    unsubscribe();

    const finalText = stateText(session.getState());
    const streamText = output.join("");
    const altScreenPassed =
      streamText.includes("ALT_SCREEN_OK") && finalText.includes("NORMAL_SCREEN_OK");
    const alternateScreenCheck = altScreenPassed
      ? check(
          "alternate-screen",
          "alternate screen",
          "pass",
          "The existing PTY and headless terminal completed an alternate-screen round trip.",
          "ALT_SCREEN_OK → NORMAL_SCREEN_OK",
        )
      : check(
          "alternate-screen",
          "alternate screen",
          "unknown",
          "The diagnostic could not observe both sides of the alternate-screen round trip before timeout.",
          finalText.slice(-200),
        );
    return [
      resizeCheck,
      alternateScreenCheck,
      check(
        "terminal-restore",
        "reconnect and restore",
        "warn",
        "The daemon exposes snapshot restore for reconnects, but this one-shot diagnostic does not disconnect the user’s client.",
        "subscribe_terminal.restore modes: live, visible-snapshot, full-snapshot",
      ),
    ];
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return [
      check("pty-resize", "resize", "unknown", `The PTY probe could not run: ${detail}`),
      check("alternate-screen", "alternate screen", "unknown", "The PTY probe could not run."),
      check(
        "terminal-restore",
        "reconnect and restore",
        "warn",
        "The daemon exposes snapshot restore, but the PTY probe did not complete.",
      ),
    ];
  } finally {
    if (session) {
      await terminalManager.killTerminalAndWait(session.id).catch(() => {});
    }
  }
}

export async function runTerminalCompatibilityDiagnostic(
  dependencies: DiagnosticDependencies,
  requestId: string,
): Promise<DiagnosticPayload> {
  const env = dependencies.env ?? process.env;
  const platform = dependencies.platform ?? process.platform;
  const runCommand = dependencies.runCommand ?? runDefaultCommand;
  const find = dependencies.findExecutable ?? findExecutable;
  const commandDependencies = { findExecutable: find, runCommand };
  const term = env.TERM?.trim() || null;
  const termProgram = env.TERM_PROGRAM?.trim() || null;
  const checks: DiagnosticCheck[] = [];

  for (const [name, label] of [
    ["vim", "Vim"],
    ["nvim", "Neovim"],
    ["tmux", "tmux"],
    ["difft", "Difftastic"],
  ] as const) {
    checks.push(await checkExecutable(name, label, { findExecutable: find }));
  }

  checks.push(await checkTerminfo(term, env, commandDependencies));
  checks.push(await checkTrueColor(term, env.COLORTERM?.trim() || null, env, commandDependencies));
  checks.push(await checkNerdFont(env, commandDependencies));
  checks.push(
    check(
      "clipboard",
      "clipboard",
      "unknown",
      "Clipboard behavior depends on the connected app surface and browser/Electron permissions; the host cannot verify it without user interaction.",
      "xterm ClipboardAddon is installed in Otto’s terminal runtime",
    ),
  );
  checks.push(
    check(
      "mouse",
      "mouse",
      "unknown",
      "Mouse reporting is wired through the existing xterm terminal, but this host-only diagnostic cannot exercise pointer input.",
      "terminal_input mouse messages are supported by the existing session controller",
    ),
  );
  checks.push(
    check(
      "kitty-compatibility",
      "Kitty compatibility",
      "unknown",
      "Otto does not claim Kitty compatibility from TERM_PROGRAM alone; Kitty-specific behavior was not verified by this diagnostic.",
      termProgram ? `TERM_PROGRAM=${termProgram}` : "TERM_PROGRAM is not set",
    ),
  );
  checks.push(...(await runPtyProbe(dependencies.terminalManager, platform)));

  return {
    requestId,
    success: true,
    error: null,
    generatedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    platform,
    term,
    termProgram,
    checks,
  };
}
