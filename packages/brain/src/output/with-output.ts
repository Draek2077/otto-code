/**
 * Wraps a command handler so it can stay pure: the handler returns a typed
 * result, and this wrapper reads the global output options off the commander
 * command, renders to stdout, and routes thrown errors to stderr with exit 1.
 * Interactive commands (the TUI, prompts) bypass this and take a plain action.
 */
import type { Command } from "commander";

import { renderError, renderResult } from "./render.js";
import {
  CommandError,
  type AnyCommandResult,
  type OutputFormat,
  type OutputOptions,
} from "./types.js";

const FORMATS = new Set<OutputFormat>(["table", "json", "yaml"]);

function optionsFromCommand(command: Command): OutputOptions {
  const opts = command.optsWithGlobals() as Record<string, unknown>;
  let format = typeof opts.format === "string" ? opts.format : "table";
  if (opts.json === true) format = "json";
  if (format === "cli") format = "table";
  if (!FORMATS.has(format as OutputFormat)) {
    throw new CommandError({
      code: "INVALID_FORMAT",
      message: `unknown format "${format}"`,
      details: "Supported formats: table, json, yaml",
    });
  }
  return {
    format: format as OutputFormat,
    quiet: opts.quiet === true,
    noHeaders: opts.headers === false,
    noColor: opts.color === false,
  };
}

export function withOutput<A extends unknown[], T>(
  handler: (...args: A) => Promise<AnyCommandResult<T>>,
): (...args: A) => Promise<void> {
  return async (...args: A): Promise<void> => {
    const command = args[args.length - 1] as Command;
    const options = optionsFromCommand(command);
    try {
      const result = await handler(...args);
      process.stdout.write(`${renderResult(result, options)}\n`);
    } catch (error) {
      const shape =
        error instanceof CommandError
          ? { code: error.code, message: error.message, details: error.details }
          : { code: "ERROR", message: error instanceof Error ? error.message : String(error) };
      process.stderr.write(`${renderError(shape, options)}\n`);
      process.exitCode = 1;
    }
  };
}
