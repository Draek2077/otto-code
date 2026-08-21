import { execFile, spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { promisify } from "node:util";

import { createExternalCommandProcessEnv, type ProcessEnvRecord } from "../server/otto-env.js";
import {
  planWindowsCommandScriptInvocation,
  quoteWindowsArgument,
  quoteWindowsCommand,
} from "./windows-command.js";

const execFileAsync = promisify(execFile);

interface ExternalEnvOptions {
  baseEnv?: ProcessEnvRecord;
  envMode?: "external" | "internal";
  env?: ProcessEnvRecord;
  envOverlay?: ProcessEnvRecord;
}

export type SpawnProcessOptions = Omit<SpawnOptions, "env"> & ExternalEnvOptions;

interface ExecCommandOptions extends ExternalEnvOptions {
  cwd?: string;
  encoding?: BufferEncoding;
  killSignal?: NodeJS.Signals;
  timeout?: number;
  maxBuffer?: number;
  shell?: boolean | string;
  signal?: AbortSignal;
}

interface ExecCommandResult {
  stdout: string;
  stderr: string;
}

interface ResolvedCommandLaunch {
  command: string;
  args: string[];
  shell: boolean | string;
  windowsVerbatimArguments?: true;
}

function resolveCommandLaunch(
  command: string,
  args: string[],
  requestedShell: boolean | string | undefined,
  env: NodeJS.ProcessEnv,
): ResolvedCommandLaunch {
  const commandScript = planWindowsCommandScriptInvocation(command, args, env);
  if (commandScript) {
    return { ...commandScript, shell: false };
  }

  const shell = requestedShell ?? false;
  if (process.platform === "win32" && shell !== false) {
    return {
      command: quoteWindowsCommand(command),
      args: args.map(quoteWindowsArgument),
      shell,
    };
  }

  return { command, args, shell };
}

export function spawnProcess(
  command: string,
  args: string[],
  options?: SpawnProcessOptions,
): ChildProcess {
  const { baseEnv, env, envOverlay, ...spawnOptions } = options ?? {};
  const resolvedBaseEnv = env ?? baseEnv ?? process.env;
  const childEnv =
    options?.envMode === "internal"
      ? ({ ...resolvedBaseEnv, ...envOverlay } as NodeJS.ProcessEnv)
      : createExternalCommandProcessEnv(
          command,
          resolvedBaseEnv,
          ...(envOverlay ? [envOverlay] : []),
        );
  const launch = resolveCommandLaunch(command, args, spawnOptions.shell, childEnv);

  return spawn(launch.command, launch.args, {
    ...spawnOptions,
    env: childEnv,
    shell: launch.shell,
    ...(launch.windowsVerbatimArguments
      ? { windowsVerbatimArguments: launch.windowsVerbatimArguments }
      : {}),
    windowsHide: true,
  });
}

export async function execCommand(
  command: string,
  args: string[],
  options?: ExecCommandOptions,
): Promise<ExecCommandResult> {
  const { baseEnv, env, envOverlay } = options ?? {};
  const resolvedBaseEnv = env ?? baseEnv ?? process.env;
  const childEnv =
    options?.envMode === "internal"
      ? ({ ...resolvedBaseEnv, ...envOverlay } as NodeJS.ProcessEnv)
      : createExternalCommandProcessEnv(
          command,
          resolvedBaseEnv,
          ...(envOverlay ? [envOverlay] : []),
        );
  const launch = resolveCommandLaunch(command, args, options?.shell, childEnv);

  return execFileAsync(launch.command, launch.args, {
    cwd: options?.cwd,
    env: childEnv,
    encoding: options?.encoding ?? "utf8",
    killSignal: options?.killSignal,
    timeout: options?.timeout,
    maxBuffer: options?.maxBuffer,
    shell: launch.shell,
    ...(launch.windowsVerbatimArguments
      ? { windowsVerbatimArguments: launch.windowsVerbatimArguments }
      : {}),
    windowsHide: true,
  }) as Promise<ExecCommandResult>;
}
