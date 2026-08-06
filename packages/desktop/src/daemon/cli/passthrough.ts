import { spawn } from "node:child_process";
import os from "node:os";
import { getBundledCliShimPath } from "../../integrations/cli-install/paths.js";
import type { NodeEntrypointInvocation } from "../node-entrypoint-launcher.js";
import { createNodeEntrypointInvocation } from "../runtime-paths.js";
import { resolveExternalCliEntrypoint } from "./entrypoints.js";

const DESKTOP_CLI_ENV = "OTTO_DESKTOP_CLI";
// Chromium/Electron flags that must not flip a launch into CLI-passthrough
// mode. --ozone-platform=, --use-gl=, and --use-angle= are the rendering
// escape hatches for VM guests without 3D acceleration; they have to arrive
// as real process argv (OTTO_ELECTRON_FLAGS/appendSwitch is too late for the
// browser process's Ozone platform selection), so the arg parser must let
// them through.
// --updated is handed to the app by the Windows installer, not by a user:
// electron-builder's StartApp forwards it from the installer's own command line
// both from the finish page's "Run Otto" checkbox and from the silent
// auto-update relaunch. It means "you were just updated", never "run a CLI
// command", so it must not flip a GUI launch into passthrough mode - that
// launch would run the CLI, fail on an unrecognized command, and exit with no
// window, no log line, and no crash dump.
const IGNORED_ARG_PREFIXES = [
  "-psn_",
  "--no-sandbox",
  "--updated",
  "--remote-debugging-port=",
  "--ozone-platform=",
  "--use-gl=",
  "--use-angle=",
];

export type PassthroughCliInvocationBuilder = (args: string[]) => NodeEntrypointInvocation;
export type PassthroughCliLauncher = (invocation: NodeEntrypointInvocation) => Promise<number>;

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

/**
 * The command line for the CLI child: the same one `resources/bin/otto` builds
 * by hand - this app's own binary re-entered with ELECTRON_RUN_AS_NODE=1,
 * running @otto-code/cli through the node entrypoint runner.
 */
export function buildPassthroughInvocation(args: string[]): NodeEntrypointInvocation {
  const invocation = createNodeEntrypointInvocation({
    entrypoint: resolveExternalCliEntrypoint(),
    argvMode: "node-script",
    args,
    baseEnv: process.env,
  });

  return {
    ...invocation,
    env: {
      ...invocation.env,
      // Mirror resources/bin/otto: a daemon started through this process is
      // desktop-managed (restarted on app upgrade), and OTTO_CLI names the
      // wrapper terminals should re-invoke, never the GUI binary.
      OTTO_DESKTOP_MANAGED: "1",
      OTTO_CLI: getBundledCliShimPath(),
    },
  };
}

/**
 * Run the CLI child to completion and report its exit code, mapping a fatal
 * signal to the shell's 128+n convention.
 */
export function launchPassthroughCli(invocation: NodeEntrypointInvocation): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      env: invocation.env,
      stdio: "inherit",
      windowsHide: true,
    });

    // A terminal signals the whole foreground process group, so Ctrl+C already
    // reached the child - re-sending SIGINT would run its shutdown twice. A
    // directed `kill` reaches only this process, so SIGTERM/SIGHUP are
    // forwarded, otherwise the child outlives the terminal that owned it.
    const swallow = (): void => undefined;
    const forward = (signal: NodeJS.Signals) => (): void => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill(signal);
      }
    };
    const forwarded: [NodeJS.Signals, () => void][] = [
      ["SIGINT", swallow],
      ["SIGTERM", forward("SIGTERM")],
      ...(process.platform === "win32"
        ? []
        : ([["SIGHUP", forward("SIGHUP")]] as [NodeJS.Signals, () => void][])),
    ];
    for (const [signal, handler] of forwarded) {
      process.on(signal, handler);
    }
    const release = (): void => {
      for (const [signal, handler] of forwarded) {
        process.off(signal, handler);
      }
    };

    child.on("error", (error) => {
      release();
      reject(error);
    });
    child.on("exit", (code, signal) => {
      release();
      if (signal) {
        resolve(128 + (os.constants.signals[signal] ?? 0));
        return;
      }
      resolve(code ?? 0);
    });
  });
}

/**
 * Run CLI-style argv handed to the GUI executable (`/usr/bin/otto status`, an
 * AppImage invoked with arguments, `Otto.exe --version`).
 *
 * This spawns the CLI as a child rather than importing it into the Electron
 * main process. In-process was wrong in two ways that only showed up on
 * long-lived commands: Electron quits when the command's promise resolves and
 * does not wait on open handles, so `otto brain serve` announced itself ready
 * and died seconds later leaving an orphaned llama-server on its port; and
 * `process.argv[1]` is a CLI verb here rather than a script path, so any
 * command that re-spawns itself (`otto brain start`) composed argv with a verb
 * where the entry script belongs and the child parsed `brain brain serve`.
 */
export async function runPassthroughCli(
  args: string[],
  options: { build?: PassthroughCliInvocationBuilder; launch?: PassthroughCliLauncher } = {},
): Promise<number> {
  const build = options.build ?? buildPassthroughInvocation;
  const launch = options.launch ?? launchPassthroughCli;
  return await launch(build(args));
}
