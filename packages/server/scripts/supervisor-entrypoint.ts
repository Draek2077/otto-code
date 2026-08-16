import { fileURLToPath } from "url";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  acquirePidLock,
  PidLockError,
  releasePidLock,
  startPidLockHeartbeat,
  updatePidLock,
  type PidLockInfo,
} from "../src/server/pid-lock.js";
import {
  describeDaemonConflict,
  portFromListen,
  waitForDaemonToQuit,
} from "../src/server/daemon-lock-guard.js";
import { resolveOttoHome } from "../src/server/otto-home.js";
import { loadPersistedConfig } from "../src/server/persisted-config.js";
import { runSupervisor } from "./supervisor.js";
import { resolveSupervisorLogFile } from "./supervisor-log-config.js";
import { applySherpaLoaderEnv } from "../src/server/speech/providers/local/sherpa/sherpa-runtime-env.js";

process.title = "Otto Supervisor";

interface DaemonRunnerConfig {
  devMode: boolean;
  reclaimStalePidLock: boolean;
  waitOnConflict: boolean;
  workerArgs: string[];
}

function parseConfig(argv: string[]): DaemonRunnerConfig {
  let devMode = false;
  let reclaimStalePidLock = false;
  let waitOnConflict = true;
  const workerArgs: string[] = [];

  for (const arg of argv) {
    if (arg === "--dev") {
      devMode = true;
      continue;
    }
    if (arg === "--reclaim-stale-pid-lock") {
      reclaimStalePidLock = true;
      continue;
    }
    if (arg === "--no-wait-on-conflict") {
      waitOnConflict = false;
      continue;
    }
    workerArgs.push(arg);
  }

  return { devMode, reclaimStalePidLock, waitOnConflict, workerArgs };
}

/**
 * When a live daemon already owns the single-instance lock, pause the start and
 * let the user quit it before continuing - instead of exiting and leaving a
 * half-broken client bound to the pre-existing daemon.
 *
 * Interactive starts (a real TTY on stdin, i.e. `npm run dev` in a terminal)
 * wait until the lock is released and then retry acquisition. Non-interactive
 * starts (CI, spawned pipelines) cannot surface a prompt, so they fail fast with
 * the same clear, actionable message as before. This only ever gates the Otto
 * daemon's own lock - it knows nothing about whatever port or command a preview
 * launch.json happens to configure, and it never kills the existing daemon.
 */
async function acquirePidLockWithConflictGuard(
  ottoHome: string,
  config: DaemonRunnerConfig,
  acquire: () => Promise<void>,
): Promise<void> {
  for (;;) {
    try {
      await acquire();
      return;
    } catch (error) {
      if (!(error instanceof PidLockError) || !error.existingLock) {
        throw error;
      }
      const lock: PidLockInfo = error.existingLock;
      if (!config.waitOnConflict || !process.stdin.isTTY) {
        process.stderr.write(`${describeDaemonConflict(lock)}\n`);
        process.stderr.write(
          "Quit the existing daemon (its own terminal, or `taskkill`/kill on " +
            `PID ${lock.pid}), then start this one again.\n`,
        );
        process.exit(1);
        return;
      }
      process.stderr.write("\n");
      // No supervisor signal handler exists yet at this point (runSupervisor
      // wires its own later), so a Ctrl-C would kill the process with no clean
      // message. Catch it here for the duration of the wait: first Ctrl-C
      // aborts, a second Ctrl-C exits hard (the familiar "press again to force").
      let interrupted = false;
      const onSigint = (): void => {
        if (interrupted) {
          process.stderr.write("\nAborted.\n");
          process.exit(130);
        }
        interrupted = true;
      };
      process.on("SIGINT", onSigint);
      let outcome;
      try {
        outcome = await waitForDaemonToQuit({
          ottoHome,
          lock,
          port: portFromListen(lock.listen) ?? undefined,
          isInterrupted: () => interrupted,
        });
      } finally {
        process.off("SIGINT", onSigint);
      }
      if (outcome.kind !== "cleared") {
        process.stderr.write(
          `\nNot starting: ${outcome.reason}. ` +
            `Quit the existing daemon (PID ${lock.pid}) and start again, ` +
            "or start with --no-wait-on-conflict to fail immediately.\n",
        );
        process.exit(1);
        return;
      }
      // The lock is released - loop back and acquire. A fresh conflict in that
      // window (another daemon grabbed it in the gap) is handled by the next
      // iteration the same way, so the user is waited on again, not handed a raw
      // stack.
    }
  }
}

function resolveWorkerEntry(): string {
  const candidates = [
    fileURLToPath(new URL("../server/server/daemon-worker.js", import.meta.url)),
    fileURLToPath(new URL("../dist/server/server/daemon-worker.js", import.meta.url)),
    fileURLToPath(new URL("../src/server/daemon-worker.ts", import.meta.url)),
    fileURLToPath(new URL("../../src/server/daemon-worker.ts", import.meta.url)),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function resolveDevWorkerEntry(): string {
  const candidate = fileURLToPath(new URL("../src/server/daemon-worker.ts", import.meta.url));
  if (!existsSync(candidate)) {
    throw new Error(`Dev worker entry not found: ${candidate}`);
  }
  return candidate;
}

function resolveWorkerExecArgv(workerEntry: string, devMode: boolean): string[] {
  const execArgv = workerEntry.endsWith(".ts") ? ["--import", "tsx"] : [];
  if (!devMode) {
    return execArgv;
  }
  const devArgs = [
    "--heapsnapshot-near-heap-limit=3",
    "--max-old-space-size=3072",
    "--report-on-fatalerror",
    "--report-directory=/tmp/otto-reports",
  ];
  const inspectArg = process.env.OTTO_NODE_INSPECT ?? "--inspect";
  if (inspectArg !== "0" && inspectArg !== "false" && inspectArg !== "off") {
    devArgs.push(inspectArg);
  }
  return [...devArgs, ...execArgv];
}

function resolvePackagedNodeEntrypointRunnerPath(currentScriptPath: string): string | null {
  const packageMarker = `${path.sep}node_modules${path.sep}@otto-code${path.sep}server${path.sep}`;
  const markerIndex = currentScriptPath.lastIndexOf(packageMarker);
  if (markerIndex === -1) {
    return null;
  }

  const appRoot = currentScriptPath.slice(0, markerIndex);
  const runnerPath = path.join(appRoot, "dist", "daemon", "node-entrypoint-runner.js");
  return existsSync(runnerPath) ? runnerPath : null;
}

async function main(): Promise<void> {
  const config = parseConfig(process.argv.slice(2));
  const workerEntry = config.devMode ? resolveDevWorkerEntry() : resolveWorkerEntry();
  const workerExecArgv = resolveWorkerExecArgv(workerEntry, config.devMode);
  const workerEnv: NodeJS.ProcessEnv = { ...process.env };
  const packagedNodeEntrypointRunner =
    process.env.ELECTRON_RUN_AS_NODE === "1"
      ? resolvePackagedNodeEntrypointRunnerPath(fileURLToPath(import.meta.url))
      : null;

  applySherpaLoaderEnv(workerEnv);

  const ottoHome = resolveOttoHome(workerEnv);
  const persistedConfig = loadPersistedConfig(ottoHome);
  const supervisorLogFile = resolveSupervisorLogFile(ottoHome, persistedConfig, workerEnv);

  await acquirePidLockWithConflictGuard(ottoHome, config, () =>
    acquirePidLock(ottoHome, null, {
      ownerPid: process.pid,
      reclaimStaleDesktopLock: config.reclaimStalePidLock,
    }),
  );

  let lockReleased = false;
  let requestSupervisorShutdown: ((reason: string) => void) | null = null;
  const stopLockHeartbeat = startPidLockHeartbeat(ottoHome, {
    ownerPid: process.pid,
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`PID lock heartbeat failed: ${message}\n`);
      if (error instanceof PidLockError) {
        requestSupervisorShutdown?.("pid_lock_ownership_lost");
      }
    },
  });
  const releaseLock = async (): Promise<void> => {
    if (lockReleased) {
      return;
    }
    lockReleased = true;
    stopLockHeartbeat();
    await releasePidLock(ottoHome, {
      ownerPid: process.pid,
    });
  };

  const supervisor = runSupervisor({
    name: "DaemonRunner",
    startupMessage: "Starting daemon worker (IPC restart and crash restart enabled)",
    resolveWorkerEntry: () => workerEntry,
    workerArgs: config.workerArgs,
    workerEnv,
    workerExecArgv,
    resolveWorkerSpawnSpec: packagedNodeEntrypointRunner
      ? (resolvedWorkerEntry) => ({
          command: process.execPath,
          args: [
            packagedNodeEntrypointRunner,
            "node-script",
            resolvedWorkerEntry,
            ...config.workerArgs,
          ],
          env: {
            ...workerEnv,
            ELECTRON_RUN_AS_NODE: "1",
          },
        })
      : undefined,
    restartOnCrash: true,
    logFile: supervisorLogFile,
    onWorkerReady: async ({ listen }) => {
      await updatePidLock(ottoHome, { listen }, { ownerPid: process.pid });
    },
    onSupervisorExit: releaseLock,
  });
  requestSupervisorShutdown = supervisor.requestShutdown;
}

void main().catch((error) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
