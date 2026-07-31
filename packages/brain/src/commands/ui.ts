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

export async function runUiCommand(_options: unknown, _command: Command): Promise<void> {
  if (!process.stdout.isTTY) {
    throw new CommandError({
      code: "NO_TTY",
      message: "the interactive UI needs a TTY",
      details: "use `scan`, `serve`, `calibrate`, or `sweep` instead",
    });
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
