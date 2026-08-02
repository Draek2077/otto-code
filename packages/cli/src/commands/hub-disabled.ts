/**
 * DISABLED(hub): CLI half of the Hub switch.
 *
 * `packages/server/src/server/hub-disabled.ts` carries the full rationale. The
 * short version: Hub is a documented permanent exclusion that landed anyway in
 * the Paseo v0.2.5 merge, and we turn it off by redirecting import specifiers
 * rather than deleting wiring, so upstream's edits to the call sites keep
 * auto-merging.
 *
 * `cli.ts` still calls `createHubCommand()` on a byte-identical line. It just
 * resolves here instead of `./commands/hub/index.js`, which keeps that whole
 * subtree, and the daemon client calls it makes, out of the CLI's module graph.
 *
 * The command stays registered, carries "(disabled in this build)" in its own
 * description, and answers every invocation with one honest sentence. That
 * beats removing it outright: `otto hub connect` explains itself instead of
 * dying on "unknown command". Hiding it from `--help` would need an option on
 * `addCommand`, and that call site is deliberately left untouched.
 */
import { Command } from "commander";

const HUB_DISABLED_MESSAGE = "Otto Hub is disabled in this build. See docs/upstream-merges.md.";

export function createHubCommand(_environment?: unknown): Command {
  return new Command("hub")
    .description("Manage this daemon's Otto Hub relationship (disabled in this build)")
    .addHelpText("after", `\n${HUB_DISABLED_MESSAGE}`)
    .allowUnknownOption()
    .allowExcessArguments()
    .argument("[command...]", "Hub subcommand")
    .action(() => {
      process.stderr.write(`${HUB_DISABLED_MESSAGE}\n`);
      process.exitCode = 1;
    });
}
