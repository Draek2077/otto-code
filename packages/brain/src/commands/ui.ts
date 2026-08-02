/**
 * `otto brain ui` (and the bare `otto brain`) — the full-screen interactive TUI,
 * the tool's signature experience. Gated on a TTY; falls back with guidance when
 * piped. Bypasses the output layer since it owns the whole screen.
 */
import type { Command } from "commander";

import { loadBrainConfig } from "../config/index.js";
import { CommandError } from "../output/types.js";
import { resolveRuntime } from "../runtime/index.js";

export function addUiOptions(cmd: Command): Command {
  return cmd.description("Launch the interactive full-screen UI");
}

const NON_INTERACTIVE_HINT = "use `scan`, `serve`, `calibrate`, or `sweep` instead";

/**
 * The bundled Windows `otto` runs the CLI inside Otto.exe with
 * ELECTRON_RUN_AS_NODE=1. Otto.exe is an IMAGE_SUBSYSTEM_WINDOWS_GUI binary, so
 * Node classifies its inherited stdio as non-TTY even from a real console:
 * measured in a freshly allocated console, Otto.exe reports
 * stdout/stdin.isTTY=false where node.exe in the same console reports true.
 * stdin is the fatal half: the TUI needs setRawMode and there is no console
 * input to switch. No launcher change fixes this while Otto.exe is the only
 * Node host shipped in the installer, so point the user at the npm CLI, which
 * runs on console-subsystem node.exe.
 */
function isBundledWindowsCli(): boolean {
  return process.platform === "win32" && Boolean(process.versions.electron);
}

function noTtyError(): CommandError {
  if (isBundledWindowsCli()) {
    return new CommandError({
      code: "NO_TTY",
      message: "the bundled Windows CLI cannot run the interactive UI",
      details: [
        "`otto` from the desktop app runs inside Otto.exe, a GUI-subsystem binary",
        "with no console input, so the full-screen UI cannot start.",
        "For interactive commands install the standalone CLI: npm i -g @otto-code/cli",
        "Every non-interactive command still works here: `scan`, `serve`, `calibrate`, `sweep`.",
      ].join("\n  "),
    });
  }
  return new CommandError({
    code: "NO_TTY",
    message: "the interactive UI needs a TTY",
    details: NON_INTERACTIVE_HINT,
  });
}

export async function runUiCommand(_options: unknown, _command: Command): Promise<void> {
  // Both streams matter: the screen needs stdout, and onKeys() needs stdin raw
  // mode. Gating on stdout alone let a stdin-less run start and then hang.
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    throw noTtyError();
  }
  const config = loadBrainConfig();
  const runtime = resolveRuntime(config);
  if (!runtime) {
    throw new CommandError({
      code: "NO_RUNTIME",
      message: "no llama.cpp runtime available",
      details: "run `otto brain runtime install`",
    });
  }
  const { App } = await import("../tui/app.js");
  const app = new App({ runtime, listenPort: config.listen.port, listenHost: config.listen.host });
  await app.run();
}
