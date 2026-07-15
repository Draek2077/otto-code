import { pathToFileURL } from "node:url";
import { resolvePassthroughCliEntrypoint } from "./entrypoints.js";

const DESKTOP_CLI_ENV = "OTTO_DESKTOP_CLI";
// Chromium/Electron flags that must not flip a launch into CLI-passthrough
// mode. --ozone-platform= and --use-gl= are the rendering escape hatches for
// VM guests without 3D acceleration; they have to arrive as real process argv
// (OTTO_ELECTRON_FLAGS/appendSwitch is too late for the browser process's
// Ozone platform selection), so the arg parser must let them through.
const IGNORED_ARG_PREFIXES = [
  "-psn_",
  "--no-sandbox",
  "--remote-debugging-port=",
  "--ozone-platform=",
  "--use-gl=",
];

export type PassthroughCliRunner = (argv: string[]) => Promise<number>;

export function parsePassthroughCliArgs(input: {
  argv: string[];
  isDefaultApp: boolean;
  forceCli: boolean;
}): string[] | null {
  const startIndex = input.isDefaultApp ? 2 : 1;
  const effective: string[] = [];

  for (const arg of input.argv.slice(startIndex)) {
    if (IGNORED_ARG_PREFIXES.some((prefix) => arg.startsWith(prefix))) {
      continue;
    }
    effective.push(arg);
  }

  if (input.forceCli) {
    return effective;
  }

  return effective.length > 0 ? effective : null;
}

export function parsePassthroughCliArgsFromArgv(argv: string[]): string[] | null {
  return parsePassthroughCliArgs({
    argv,
    isDefaultApp: process.defaultApp,
    forceCli: process.env[DESKTOP_CLI_ENV] === "1",
  });
}

async function importPassthroughCliRunner(): Promise<PassthroughCliRunner> {
  const entrypoint = resolvePassthroughCliEntrypoint();
  const imported = (await import(pathToFileURL(entrypoint).href)) as {
    runCli?: unknown;
  };
  if (typeof imported.runCli !== "function") {
    throw new Error(`Passthrough CLI entrypoint did not export runCli: ${entrypoint}`);
  }
  return imported.runCli as PassthroughCliRunner;
}

export async function runPassthroughCli(
  args: string[],
  options: { runCli?: PassthroughCliRunner } = {},
): Promise<number> {
  const runCli = options.runCli ?? (await importPassthroughCliRunner());
  return await runCli(args);
}
