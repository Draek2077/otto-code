import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { closeSync, openSync } from "node:fs";
import { readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import { getE2EDaemonPort } from "./daemon-port";
import { withDisabledE2ESpeechEnv } from "./speech-env";

let registeredReplacementStop: (() => Promise<void>) | null = null;

/**
 * Restarts the isolated E2E daemon against the SAME OTTO_HOME and SAME port so
 * persisted state reloads and existing clients can reconnect. This exercises the
 * post-restart rehydration path (the daemon rebuilding workspace/agent links
 * from disk), which is where the worktree-branch regression lives.
 *
 * The daemon is owned by Playwright's `globalSetup`, which keeps its child
 * handle in module scope we can't reach from a spec. Instead we drive it the
 * same way an operator would: read the supervisor PID from
 * `$OTTO_HOME/otto.pid`, SIGTERM it (the supervisor forwards the signal to its
 * worker and releases the lock), wait for the port to free, then re-spawn the
 * supervisor with the identical environment globalSetup used. The relay and
 * Metro processes are untouched, so we reuse their already-published ports.
 *
 * This NEVER targets the developer daemon: the port comes from
 * `getE2EDaemonPort()`, which refuses 6868, and OTTO_HOME is the isolated E2E
 * worker home. A worker ordinarily has no relay; relay-backed lanes retain
 * their endpoint when one is present.
 */

function getEnvOrThrow(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set (expected from Playwright globalSetup).`);
  }
  return value;
}

async function readSupervisorPid(ottoHome: string): Promise<number> {
  const pidPath = path.join(ottoHome, "otto.pid");
  const content = await readFile(pidPath, "utf8");
  const parsed = JSON.parse(content) as { pid?: unknown };
  if (typeof parsed.pid !== "number") {
    throw new Error(`Malformed PID lock at ${pidPath}: ${content}`);
  }
  return parsed.pid;
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isPortListening(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, host, () => {
      socket.end();
      resolve(true);
    });
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
}

async function waitUntil(
  predicate: () => Promise<boolean> | boolean,
  options: { timeoutMs: number; label: string },
): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out after ${options.timeoutMs}ms waiting for ${options.label}.`);
}

function spawnSupervisor(args: {
  ottoHome: string;
  port: string;
  relayPort?: string;
  metroPort: string;
  editorRecordPath: string;
}): ChildProcess {
  // This helper lives under packages/app/e2e/support/helpers, so the server
  // package is a sibling under packages/, not packages/packages/server.
  const serverDir = path.resolve(__dirname, "../../../../server");
  // Run the supervisor through the resolved tsx CLI under the current node
  // binary. Spawning the `node_modules/.bin/tsx` shim directly is unreliable
  // inside the Playwright worker (the shim is a .mjs symlink, not an executable),
  // so resolve the CLI module and load it with node.
  const tsxCli = createRequire(path.join(serverDir, "package.json")).resolve("tsx/cli");
  const env = withDisabledE2ESpeechEnv({
    ...process.env,
    OTTO_HOME: args.ottoHome,
    OTTO_E2E_EDITOR_RECORD_PATH: args.editorRecordPath,
    // Keep the rehydrated daemon attached to the same browser host entry. The
    // worker fixture assigns a unique server id; inventing a new one here
    // leaves the app subscribed to the pre-restart host.
    OTTO_SERVER_ID: process.env.E2E_SERVER_ID ?? "srv_e2e_test_daemon",
    OTTO_LISTEN: `0.0.0.0:${args.port}`,
    ...(args.relayPort ? { OTTO_RELAY_ENDPOINT: `127.0.0.1:${args.relayPort}` } : {}),
    OTTO_CORS_ORIGINS: `http://localhost:${args.metroPort}`,
    // Worker-owned T1/T2 daemons deliberately have no relay. Restarts must
    // preserve that topology instead of reviving the default relay path.
    OTTO_RELAY_ENABLED: args.relayPort ? undefined : "0",
    OTTO_NODE_ENV: "development",
    NODE_ENV: "development",
  });

  // The restarted daemon outlives the worker that spawned it, so its stdio must NOT be a pipe
  // back into that worker. Playwright recycles a worker as soon as one of its tests fails; the
  // pipe then has no reader, the daemon's (very chatty) logger fills the 64 KB kernel buffer,
  // and every subsequent write blocks forever. The port stays open, so nothing looks dead -
  // every later daemon-dependent test in the shard just hangs to its own timeout. That is
  // exactly how one failing test used to poison the ~2 hours of shard 3 that followed it.
  //
  // A file has no such backpressure and keeps the diagnostics: `$OTTO_HOME/daemon-restart.log`.
  const logPath = path.join(args.ottoHome, "daemon-restart.log");
  const logFd = openSync(logPath, "a");
  const child = spawn(process.execPath, [tsxCli, "scripts/supervisor-entrypoint.ts", "--dev"], {
    cwd: serverDir,
    env,
    stdio: ["ignore", logFd, logFd],
    // Own process group, so tearing down the worker's group never takes the daemon with it.
    // The worker teardown reaps it through the registered replacement cleanup below.
    detached: true,
  });
  closeSync(logFd);

  // Nothing here may hold the worker's event loop open, or the run hangs in teardown instead.
  child.unref();
  return child;
}

/** Stop the replacement supervisor created by {@link restartTestDaemon}. */
async function stopRestartedSupervisor(args: { ottoHome: string; port: string }): Promise<void> {
  let pid: number;
  try {
    pid = await readSupervisorPid(args.ottoHome);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (!isPidRunning(pid)) return;

  process.kill(pid, "SIGTERM");
  await waitUntil(() => !isPidRunning(pid), {
    timeoutMs: 15_000,
    label: `restarted supervisor PID ${pid} to exit`,
  });
  await waitUntil(async () => !(await isPortListening(Number(args.port))), {
    timeoutMs: 15_000,
    label: `restarted daemon port ${args.port} to free`,
  });
}

/**
 * Stop the detached replacement created during this worker's tests. This is
 * deliberately called by the worker fixture only after its per-test project
 * cleanup and dangling-project sweep finish.
 */
export async function stopRegisteredRestartedTestDaemon(): Promise<void> {
  const stop = registeredReplacementStop;
  registeredReplacementStop = null;
  await stop?.();
}

/**
 * Restart the isolated E2E daemon. The worker fixture owns the original child
 * handle, so this registers the detached replacement for worker teardown.
 */
export async function restartTestDaemon(): Promise<void> {
  const port = getE2EDaemonPort();
  const ottoHome = getEnvOrThrow("E2E_OTTO_HOME");
  // Per-worker T1/T2 harnesses intentionally delete this value because their
  // isolated daemon has no relay. Older global-setup-owned lanes still supply
  // it and must preserve their relay endpoint across the restart.
  const relayPort = process.env.E2E_RELAY_PORT;
  const metroPort = getEnvOrThrow("E2E_METRO_PORT");
  const editorRecordPath =
    process.env.E2E_EDITOR_RECORD_PATH ?? path.join(ottoHome, "editor-open-records.jsonl");

  const pid = await readSupervisorPid(ottoHome);
  process.kill(pid, "SIGTERM");

  await waitUntil(() => !isPidRunning(pid), {
    timeoutMs: 15_000,
    label: `supervisor PID ${pid} to exit`,
  });
  await waitUntil(async () => !(await isPortListening(Number(port))), {
    timeoutMs: 15_000,
    label: `port ${port} to free`,
  });

  spawnSupervisor({ ottoHome, port, relayPort, metroPort, editorRecordPath });

  await waitUntil(async () => isPortListening(Number(port)), {
    timeoutMs: 30_000,
    label: `restarted daemon to listen on port ${port}`,
  });

  registeredReplacementStop = () => stopRestartedSupervisor({ ottoHome, port });
}
