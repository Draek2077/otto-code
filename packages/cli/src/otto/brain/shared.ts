/** Adopt shared Brain commands; the handler never substitutes an invoker-local owner. */
import type { Command } from "commander";
import { createBrainCommand, withBrainCommandHost, CommandError } from "@getpaseo/brain/cli";
import { TuiActionError } from "@getpaseo/brain/tui";
import { connectToDaemon } from "../../utils/client.js";
import {
  addDaemonHostOption,
  addLocalDaemonOptions,
  withGlobalOptions,
} from "../../utils/command-options.js";
import type { CommandOptions } from "../../output/index.js";
import { BrainCliError } from "./rpc.js";
import { openBrainCommandHost } from "./command-host.js";

export async function executeBrainCommand<T>(
  command: Command,
  execute: () => Promise<T>,
): Promise<T> {
  try {
    return await withGlobalOptions(async (options: CommandOptions, _command: Command) => {
      if (command.name() === "serve") {
        if (options.daemonTarget.kind !== "instance")
          throw new BrainCliError(
            "LOCAL_OPERATION",
            "Foreground Brain is local. Use --home; remote hosts use start/restart.",
          );
        const { withBrainLocalEnvironment } = await import("@getpaseo/brain/cli-target");
        return withBrainLocalEnvironment(
          {
            ...process.env,
            OTTO_HOME: options.daemonTarget.home,
            PASEO_HOME: options.daemonTarget.home,
          },
          execute,
        );
      }
      const client = await connectToDaemon({ target: options.daemonTarget }).catch(
        (cause: unknown) => {
          throw new BrainCliError("BRAIN_UNAVAILABLE", "The selected Otto daemon is unavailable.", {
            cause,
          });
        },
      );
      try {
        if (command.parent?.name() === "config" || command.name() === "share") {
          const { withBrainSettingsTarget } = await import("@getpaseo/brain/cli-target");
          const { daemonBrainSettings } = await import("./settings.js");
          return await withBrainSettingsTarget(daemonBrainSettings(client), execute);
        }
        return await withBrainCommandHost(await openBrainCommandHost(client), execute);
      } finally {
        await client.close().catch(() => undefined);
      }
    })(command.opts(), command);
  } catch (error) {
    if (error instanceof BrainCliError)
      throw new CommandError({ code: error.code, message: error.message }, { cause: error });
    if (error instanceof TuiActionError)
      throw new CommandError(
        { code: `BRAIN_${error.status.toUpperCase()}`, message: error.message },
        { cause: error },
      );
    throw error;
  }
}

function addSelectors(command: Command): void {
  if (!command.options.some((option) => option.long === "--host")) addDaemonHostOption(command);
  for (const child of command.commands) addSelectors(child);
}
/** Keep the current low-level management commands until each remaining domain
 * has its reviewed portable owner port. The adopted groups have one definition. */
export function adoptSharedBrainCommands(brain: Command): void {
  const shared = createBrainCommand({ execute: executeBrainCommand });
  const groups = new Set([
    "scan",
    "bench",
    "config",
    "share",
    "serve",
    "catalog",
    "search",
    "pull",
    "add",
    "calibrate",
    "sweep",
    "runtime",
    "report",
    "rescore",
  ]);
  for (const option of shared.options) {
    if (!brain.options.some((current) => current.long === option.long)) brain.addOption(option);
  }
  for (const command of shared.commands) {
    if (!groups.has(command.name())) continue;
    if (brain.commands.some((current) => current.name() === command.name()))
      throw new Error(`Brain command is already registered: ${command.name()}`);
    if (command.name() === "serve") addLocalDaemonOptions(command);
    else addSelectors(command);
    brain.addCommand(command);
  }
}
