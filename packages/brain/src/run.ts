/**
 * Standalone CLI runner for `bin/otto-brain`. Builds a root program named
 * `otto-brain`, mounts the brain verbs directly on it (so `otto-brain serve`, not
 * `otto-brain brain serve`), and sets process.exitCode rather than exiting, so
 * the same code path is testable.
 */
import { Command } from "commander";

import { registerBrainCommands } from "./cli.js";
import { resolveVersion } from "./version.js";

export interface RunOptions {
  from?: "user" | "node";
}

export async function runBrainCli(argv: string[], options: RunOptions = {}): Promise<number> {
  const program = new Command()
    .name("otto-brain")
    .description("Otto Brain - host local GGUF models with measured VRAM budgeting")
    .version(resolveVersion(), "-v, --version", "output the version number");

  registerBrainCommands(program);

  await program.parseAsync(argv, { from: options.from ?? "user" });
  return typeof process.exitCode === "number" ? process.exitCode : 0;
}
