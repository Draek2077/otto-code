import type { Command } from "commander";
import { CommandError } from "../output/types.js";
import type { BrainTuiHost } from "../tui/host.js";
import type { AppOptions } from "../tui/app.js";

export interface UiTerminalEnvironment {
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  platform: NodeJS.Platform;
  electron: boolean;
}
export interface UiCommandOptions extends Omit<AppOptions, "host"> {
  terminal?: UiTerminalEnvironment;
}
export function addUiOptions(command: Command): Command {
  return command.description("Launch the interactive full-screen UI");
}

export function assertInteractiveTerminal(terminal: UiTerminalEnvironment): void {
  if (terminal.stdinIsTTY && terminal.stdoutIsTTY) return;
  // The bundled GUI-subsystem Windows executable has no raw console input,
  // even when launched from a console. Only a console Node host can run the UI.
  if (terminal.platform === "win32" && terminal.electron) {
    throw new CommandError({
      code: "NO_TTY",
      message: "the bundled Windows CLI cannot run the interactive UI",
      details:
        "Otto.exe is a GUI-subsystem binary with no console input. For the interactive UI, use the standalone npm CLI on Node.js: npm i -g @otto-code/cli. Non-interactive commands remain available: scan, serve, calibrate, sweep.",
    });
  }
  throw new CommandError({
    code: "NO_TTY",
    message: "the interactive UI needs a TTY for both input and output",
    details: "use scan, serve, calibrate, or sweep instead",
  });
}

/** Parent CLI composition owns host construction/teardown. Validate the terminal
 * before constructing that host, so a piped invocation cannot acquire a home. */
export async function runUiCommand(
  createHost: () => Promise<BrainTuiHost>,
  options: UiCommandOptions = {},
): Promise<void> {
  assertInteractiveTerminal(
    options.terminal ?? {
      stdinIsTTY: Boolean(process.stdin.isTTY),
      stdoutIsTTY: Boolean(process.stdout.isTTY),
      platform: process.platform,
      electron: Boolean(process.versions.electron),
    },
  );
  const host = await createHost();
  const { App } = await import("../tui/app.js");
  await new App({ ...options, host }).run();
}
