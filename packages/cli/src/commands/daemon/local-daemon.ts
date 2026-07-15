import { spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { loadConfig, resolveOttoHome, spawnProcess } from "@otto-code/server";
import treeKill from "tree-kill";
import { tryConnectToDaemon } from "../../utils/client.js";

export interface DaemonStartOptions {
  port?: string;
  listen?: string;
  home?: string;
  foreground?: boolean;
  relay?: boolean;
  relayUseTls?: boolean;
  mcp?: boolean;
  injectMcp?: boolean;
  webUi?: boolean;
  hostnames?: string;
}

export interface LocalDaemonPidInfo {
  pid: number;
  startedAt?: string;
  hostname?: string;
  uid?: number;
  listen?: string;
  desktopManaged?: boolean;
}

export interface LocalDaemonState {
  home: string;
  listen: string;
  relayEnabled: boolean;
  relayEndpoint: string;
  relayUseTls: boolean;
  relayPublicUseTls: boolean;
  logPath: string;
  pidPath: string;
  pidInfo: LocalDaemonPidInfo | null;
  running: boolean;
  stalePidFile: boolean;
}

export interface DetachedStartResult {
  pid: number | null;
  logPath: string;
}

export interface StopLocalDaemonOptions {
  home?: string;
  timeoutMs?: number;
  killTimeoutMs?: number;
  force?: boolean;
}

export interface StopLocalDaemonResult {
  action: "stopped" | "not_running";
  home: string;
  pid: number | null;
  forced: boolean;
  usedLifecycleRpc: boolean;
  reason: "not_running" | "lifecycle_shutdown_rpc" | "owner_pid_signal" | "owner_pid_sigkill";
  message: string;
}

interface ProcessExitDetails {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
}

type DetachedStartupResult = { exitedEarly: false } | ({ exitedEarly: true } & ProcessExitDetails);

export interface DetachedDaemonProcess extends Pick<ChildProcess, "once" | "pid" | "unref"> {}

export interface ForegroundDaemonProcessResult {
  status: number | null;
  error?: Error;
}

export interface DaemonLaunchRuntime {
  resolveRunnerEntry(): string;
  resolveHome(env: NodeJS.ProcessEnv): string;
  spawnDetached(
    command: string,
    args: string[],
    options: Parameters<typeof spawnProcess>[2],
  ): DetachedDaemonProcess;
  spawnForeground(
    command: string,
    args: string[],
    options: Parameters<typeof spawnSync>[2],
  ): ForegroundDaemonProcessResult;
}

const DETACHED_STARTUP_GRACE_MS = 1200;
const PID_POLL_INTERVAL_MS = 100;
const DAEMON_LOG_FILENAME = "daemon.log";
const DAEMON_PID_FILENAME = "otto.pid";

export const DEFAULT_STOP_TIMEOUT_MS = 15_000;
export const DEFAULT_KILL_TIMEOUT_MS = 3_000;

const require = createRequire(import.meta.url);

const defaultDaemonLaunchRuntime: DaemonLaunchRuntime = {
  resolveRunnerEntry: resolveDaemonRunnerEntry,
  resolveHome: resolveOttoHome,
  spawnDetached: spawnProcess,
  spawnForeground: spawnSync,
};

const startupReady = (): DetachedStartupResult => ({ exitedEarly: false });

const startupExited = (details: ProcessExitDetails): DetachedStartupResult => ({
  exitedEarly: true,
  ...details,
});

function envWithHome(home?: string): NodeJS.ProcessEnv {
  if (!home) {
    return process.env;
  }

  return { ...process.env, OTTO_HOME: home };
}

function buildRunnerArgs(options: DaemonStartOptions): string[] {
  const args: string[] = [];
  if (options.relay === false) {
    args.push("--no-relay");
  }
  if (options.relayUseTls === true) {
    args.push("--relay-use-tls");
  }

  if (options.mcp === false) {
    args.push("--no-mcp");
  }
  if (options.injectMcp === false) {
    args.push("--no-inject-mcp");
  }
  if (options.webUi === true) {
    args.push("--web-ui");
  }
  if (options.webUi === false) {
    args.push("--no-web-ui");
  }

  return args;
}

function buildChildEnv(options: DaemonStartOptions): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  if (options.home) {
    childEnv.OTTO_HOME = options.home;
  }
  if (options.listen) {
    childEnv.OTTO_LISTEN = options.listen;
  } else if (options.port) {
    childEnv.OTTO_LISTEN = `127.0.0.1:${options.port}`;
  }
  if (options.hostnames) {
    childEnv.OTTO_HOSTNAMES = options.hostnames;
  }
  if (options.relayUseTls === true) {
    childEnv.OTTO_RELAY_USE_TLS = "true";
  }
  if (options.webUi === true) {
    childEnv.OTTO_WEB_UI_ENABLED = "true";
  }
  if (options.webUi === false) {
    childEnv.OTTO_WEB_UI_ENABLED = "false";
  }
  return childEnv;
}

interface DaemonSpawnInvocation {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

// A packaged desktop build runs this CLI on the Electron binary
// (`process.execPath` is e.g. /opt/Otto/Otto). Spawning the daemon through that
// binary then needs two things the plain-Node path doesn't:
//   1. ELECTRON_RUN_AS_NODE=1 — otherwise the binary boots as the Otto GUI/CLI
//      (commander) and rejects the daemon entry as an "unknown command".
//   2. The unpacked node-entrypoint-runner — the supervisor entry resolves to a
//      path inside app.asar, which can't be the direct entry under
//      ELECTRON_RUN_AS_NODE, so it must be loaded via the runner (mirroring the
//      desktop daemon-manager: `<runner> node-script <entry>`).
// Outside a packaged Electron binary (dev, or a plain-node CLI), neither applies
// and we spawn the entry directly. Returns null when not applicable.
function resolvePackagedNodeEntrypointRunner(daemonRunnerEntry: string): string | null {
  if (!process.versions.electron) {
    return null;
  }
  const marker = `${path.sep}node_modules${path.sep}@otto-code${path.sep}server${path.sep}`;
  const markerIndex = daemonRunnerEntry.lastIndexOf(marker);
  if (markerIndex === -1) {
    return null;
  }
  const appRoot = daemonRunnerEntry.slice(0, markerIndex);
  const runnerPath = path.join(appRoot, "dist", "daemon", "node-entrypoint-runner.js");
  return existsSync(runnerPath) ? runnerPath : null;
}

function buildDaemonSpawnInvocation(
  daemonRunnerEntry: string,
  runnerArgs: string[],
  childEnv: NodeJS.ProcessEnv,
): DaemonSpawnInvocation {
  const packagedRunner = resolvePackagedNodeEntrypointRunner(daemonRunnerEntry);
  if (packagedRunner) {
    return {
      command: process.execPath,
      args: [packagedRunner, "node-script", daemonRunnerEntry, ...runnerArgs],
      env: { ...childEnv, ELECTRON_RUN_AS_NODE: "1" },
    };
  }
  return {
    command: process.execPath,
    args: [...process.execArgv, daemonRunnerEntry, ...runnerArgs],
    env: childEnv,
  };
}

function resolveServerRunnerFromDir(currentDir: string): string | null {
  const packageJsonPath = path.join(currentDir, "package.json");
  if (!existsSync(packageJsonPath)) return null;
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { name?: string };
    if (packageJson.name !== "@otto-code/server") return null;
    const distRunner = path.join(currentDir, "dist", "scripts", "supervisor-entrypoint.js");
    if (existsSync(distRunner)) {
      return distRunner;
    }
    return path.join(currentDir, "scripts", "supervisor-entrypoint.ts");
  } catch {
    return null;
  }
}

function resolveDaemonRunnerEntry(): string {
  const serverExportPath = require.resolve("@otto-code/server");
  let currentDir = path.dirname(serverExportPath);

  while (true) {
    const entry = resolveServerRunnerFromDir(currentDir);
    if (entry) {
      return entry;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  throw new Error("Unable to resolve @otto-code/server package root for daemon runner");
}

function pidFilePath(ottoHome: string): string {
  return path.join(ottoHome, DAEMON_PID_FILENAME);
}

function resolveListenField(listen: unknown, sockPath: unknown): string | undefined {
  if (typeof listen === "string") return listen;
  if (typeof sockPath === "string") return sockPath;
  return undefined;
}

function resolveStopMessage(
  forced: boolean,
  lifecycleRequested: boolean,
  fallbackMessage: string | null | undefined,
): string {
  if (forced) return "Daemon owner process was force-stopped";
  if (lifecycleRequested) return "Daemon stopped gracefully";
  return fallbackMessage ?? "Daemon stopped via owner PID signal";
}

function resolveStopReason(
  forced: boolean,
  lifecycleRequested: boolean,
): StopLocalDaemonResult["reason"] {
  if (forced) return "owner_pid_sigkill";
  if (lifecycleRequested) return "lifecycle_shutdown_rpc";
  return "owner_pid_signal";
}

function readPidFile(pidPath: string): LocalDaemonPidInfo | null {
  try {
    const parsed = JSON.parse(readFileSync(pidPath, "utf-8")) as Record<string, unknown>;
    const pidValue = parsed.pid;
    if (typeof pidValue !== "number" || !Number.isInteger(pidValue) || pidValue <= 0) {
      return null;
    }

    return {
      pid: pidValue,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : undefined,
      hostname: typeof parsed.hostname === "string" ? parsed.hostname : undefined,
      uid: typeof parsed.uid === "number" ? parsed.uid : undefined,
      listen: resolveListenField(parsed.listen, parsed.sockPath),
      desktopManaged: parsed.desktopManaged === true ? true : undefined,
    };
  } catch {
    return null;
  }
}

function tailFile(filePath: string, lines = 30): string | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    return content.split("\n").filter(Boolean).slice(-lines).join("\n");
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readNodeErrnoCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  return typeof error.code === "string" ? error.code : undefined;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = readNodeErrnoCode(err);
    if (code === "EPERM") {
      return true;
    }
    return false;
  }
}

function signalProcess(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch (err) {
    const code = readNodeErrnoCode(err);
    if (code === "ESRCH") {
      return false;
    }
    throw err;
  }
}

function signalProcessSafely(pid: number, signal: NodeJS.Signals): boolean {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) {
    return false;
  }

  try {
    return signalProcess(pid, signal);
  } catch (err) {
    const code = readNodeErrnoCode(err);
    if (code === "EPERM") {
      return true;
    }
    throw err;
  }
}

async function signalProcessTreeSafely(pid: number, signal: NodeJS.Signals): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) {
    return false;
  }

  return new Promise((resolve, reject) => {
    treeKill(pid, signal, (err) => {
      if (!err) {
        resolve(true);
        return;
      }

      const code = readNodeErrnoCode(err);
      if (code === "ESRCH") {
        resolve(false);
        return;
      }
      if (code === "EPERM") {
        resolve(true);
        return;
      }
      reject(err);
    });
  });
}

async function signalProcessTreeOrOwnerSafely(
  pid: number,
  signal: NodeJS.Signals,
): Promise<boolean> {
  try {
    return await signalProcessTreeSafely(pid, signal);
  } catch {
    return signalProcessSafely(pid, signal);
  }
}

async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  async function poll(): Promise<boolean> {
    if (!isProcessRunning(pid)) return true;
    if (Date.now() >= deadline) return !isProcessRunning(pid);
    await sleep(PID_POLL_INTERVAL_MS);
    return poll();
  }
  return poll();
}

async function waitForDaemonUnreachable(
  state: LocalDaemonState,
  timeoutMs: number,
): Promise<boolean> {
  const host = resolveTcpHostFromListen(state.listen);
  if (!host) {
    return true;
  }

  const reachableHost = host;
  const deadline = Date.now() + timeoutMs;
  async function poll(): Promise<boolean> {
    const client = await tryConnectToDaemon({ host: reachableHost, timeout: 500 });
    if (!client) {
      return true;
    }
    await client.close().catch(() => undefined);
    if (Date.now() >= deadline) {
      const finalClient = await tryConnectToDaemon({
        host: reachableHost,
        timeout: PID_POLL_INTERVAL_MS,
      });
      if (!finalClient) {
        return true;
      }
      await finalClient.close().catch(() => undefined);
      return false;
    }
    await sleep(PID_POLL_INTERVAL_MS);
    return poll();
  }

  return poll();
}

function removeStalePidFile(state: LocalDaemonState): void {
  if (!state.stalePidFile) {
    return;
  }

  try {
    unlinkSync(state.pidPath);
  } catch {
    // Best-effort cleanup only. The successful lifecycle stop is authoritative.
  }
}

function createNotRunningStopResult(
  state: LocalDaemonState,
  pid: number | null,
  message: string,
): StopLocalDaemonResult {
  return {
    action: "not_running",
    home: state.home,
    pid,
    forced: false,
    usedLifecycleRpc: false,
    reason: "not_running",
    message,
  };
}

function createStopTimeoutError(
  state: LocalDaemonState,
  pid: number | null,
  timeoutMs: number,
): Error {
  if (!state.running) {
    const host = resolveTcpHostFromListen(state.listen);
    return new Error(
      `Timed out waiting for daemon${host ? ` at ${host}` : ""} to stop after ${Math.ceil(
        timeoutMs / 1000,
      )}s`,
    );
  }
  return new Error(
    `Timed out waiting for daemon PID ${pid} to stop after ${Math.ceil(timeoutMs / 1000)}s`,
  );
}

async function signalDaemonOwnerForStop(
  state: LocalDaemonState,
  pid: number | null,
): Promise<StopLocalDaemonResult | null> {
  if (pid === null) {
    return createNotRunningStopResult(state, null, "Daemon is not running");
  }

  const signaled = await signalProcessTreeOrOwnerSafely(pid, "SIGTERM");
  if (signaled) {
    return null;
  }

  return createNotRunningStopResult(state, pid, "Daemon process was already stopped");
}

async function waitForStopAfterRequest(args: {
  state: LocalDaemonState;
  pid: number | null;
  timeoutMs: number;
  killTimeoutMs: number;
  force?: boolean;
}): Promise<{ stopped: boolean; forced: boolean }> {
  const { state, pid, timeoutMs, killTimeoutMs, force } = args;
  let stopped =
    state.running && pid !== null
      ? await waitForPidExit(pid, timeoutMs)
      : await waitForDaemonUnreachable(state, timeoutMs);

  if (!stopped && force && state.running && pid !== null) {
    await signalProcessTreeOrOwnerSafely(pid, "SIGKILL");
    stopped = await waitForPidExit(pid, killTimeoutMs);
    return { stopped, forced: true };
  }

  return { stopped, forced: false };
}

type LifecycleShutdownAttempt = { requested: true } | { requested: false; reason: string };

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function resolveLocalOttoHome(home?: string): string {
  return resolveOttoHome(envWithHome(home));
}

export function resolveTcpHostFromListen(listen: string): string | null {
  const normalized = listen.trim();
  if (!normalized) {
    return null;
  }

  if (
    normalized.startsWith("/") ||
    normalized.startsWith("unix://") ||
    normalized.startsWith("pipe://") ||
    normalized.startsWith("\\\\.\\pipe\\") ||
    /^[A-Za-z]:[/\\]/.test(normalized)
  ) {
    return null;
  }

  if (/^\d+$/.test(normalized)) {
    return `127.0.0.1:${normalized}`;
  }

  if (normalized.includes(":")) {
    return normalized;
  }

  return null;
}

export function resolveLocalDaemonState(options: { home?: string } = {}): LocalDaemonState {
  const env: NodeJS.ProcessEnv = {
    ...envWithHome(options.home),
    // Status should reflect local persisted config + pid file, not inherited daemon env overrides.
    // This is CLI-side defensive scrubbing; the daemon RPC is authoritative when available.
    OTTO_LISTEN: undefined,
    OTTO_HOSTNAMES: undefined,
    OTTO_ALLOWED_HOSTS: undefined,
    OTTO_RELAY_ENABLED: undefined,
    OTTO_RELAY_ENDPOINT: undefined,
    OTTO_RELAY_PUBLIC_ENDPOINT: undefined,
    OTTO_RELAY_USE_TLS: undefined,
    OTTO_RELAY_PUBLIC_USE_TLS: undefined,
  };
  const home = resolveOttoHome(env);
  const config = loadConfig(home, { env });
  const pidPath = pidFilePath(home);
  const logPath = path.join(home, DAEMON_LOG_FILENAME);
  const pidInfo = existsSync(pidPath) ? readPidFile(pidPath) : null;
  const running = pidInfo ? isProcessRunning(pidInfo.pid) : false;
  const listen = pidInfo?.listen ?? config.listen;

  return {
    home,
    listen,
    relayEnabled: config.relayEnabled ?? true,
    relayEndpoint: config.relayPublicEndpoint ?? config.relayEndpoint ?? "relay.otto-code.me:443",
    relayUseTls: config.relayUseTls ?? false,
    relayPublicUseTls: config.relayPublicUseTls ?? config.relayUseTls ?? false,
    logPath,
    pidPath,
    pidInfo,
    running,
    stalePidFile: Boolean(pidInfo) && !running,
  };
}

export function tailDaemonLog(home?: string, lines = 30): string | null {
  const logPath = path.join(resolveLocalOttoHome(home), DAEMON_LOG_FILENAME);
  return tailFile(logPath, lines);
}

export async function startLocalDaemonDetached(
  options: DaemonStartOptions,
  runtime: DaemonLaunchRuntime = defaultDaemonLaunchRuntime,
): Promise<DetachedStartResult> {
  if (options.listen && options.port) {
    throw new Error("Cannot use --listen and --port together");
  }

  const daemonRunnerEntry = runtime.resolveRunnerEntry();
  const childEnv = buildChildEnv(options);

  const ottoHome = runtime.resolveHome(childEnv);
  const logPath = path.join(ottoHome, DAEMON_LOG_FILENAME);
  const invocation = buildDaemonSpawnInvocation(
    daemonRunnerEntry,
    buildRunnerArgs(options),
    childEnv,
  );
  const child = runtime.spawnDetached(invocation.command, invocation.args, {
    detached: true,
    envMode: "internal",
    env: invocation.env,
    stdio: ["ignore", "ignore", "ignore"],
  });

  child.unref();

  const startup = await new Promise<DetachedStartupResult>((resolve) => {
    let settled = false;

    const finish = (value: DetachedStartupResult) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timer = setTimeout(() => finish(startupReady()), DETACHED_STARTUP_GRACE_MS);

    child.once("error", (error) => {
      clearTimeout(timer);
      finish(startupExited({ code: null, signal: null, error }));
    });

    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      finish(startupExited({ code, signal }));
    });
  });

  if (startup.exitedEarly) {
    const reason = startup.error
      ? startup.error.message
      : `exit code ${startup.code ?? "unknown"}${startup.signal ? ` (${startup.signal})` : ""}`;
    const recentLogs = tailFile(logPath);
    throw new Error(
      [
        `Daemon failed to start in background (${reason}).`,
        recentLogs ? `Recent daemon logs:\n${recentLogs}` : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  }

  return {
    pid: child.pid ?? null,
    logPath,
  };
}

export function startLocalDaemonForeground(
  options: DaemonStartOptions,
  runtime: DaemonLaunchRuntime = defaultDaemonLaunchRuntime,
): number {
  if (options.listen && options.port) {
    throw new Error("Cannot use --listen and --port together");
  }

  const daemonRunnerEntry = runtime.resolveRunnerEntry();
  const childEnv = buildChildEnv(options);
  const invocation = buildDaemonSpawnInvocation(
    daemonRunnerEntry,
    buildRunnerArgs(options),
    childEnv,
  );
  const result = runtime.spawnForeground(invocation.command, invocation.args, {
    env: invocation.env,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

async function requestLifecycleShutdown(
  state: LocalDaemonState,
  timeoutMs: number,
): Promise<LifecycleShutdownAttempt> {
  const host = resolveTcpHostFromListen(state.listen);
  if (!host) {
    return {
      requested: false,
      reason: "daemon listen target is not TCP, falling back to owner PID signal",
    };
  }

  const deadline = Date.now() + timeoutMs;
  const remainingTimeoutMs = () => Math.max(1, deadline - Date.now());
  const client = await tryConnectToDaemon({ host, timeout: Math.min(remainingTimeoutMs(), 5000) });
  if (!client) {
    return {
      requested: false,
      reason: `daemon websocket at ${host} is not reachable, falling back to owner PID signal`,
    };
  }

  try {
    await client.shutdownServer({ timeout: Math.min(remainingTimeoutMs(), 5000) });
    return { requested: true };
  } catch (error) {
    return {
      requested: false,
      reason: `daemon lifecycle shutdown request failed (${getErrorMessage(
        error,
      )}), falling back to owner PID signal`,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function stopLocalDaemon(
  options: StopLocalDaemonOptions = {},
): Promise<StopLocalDaemonResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  const killTimeoutMs = options.killTimeoutMs ?? DEFAULT_KILL_TIMEOUT_MS;
  const state = resolveLocalDaemonState({ home: options.home });
  const deadline = Date.now() + timeoutMs;
  const remainingTimeoutMs = () => Math.max(1, deadline - Date.now());

  const shutdownAttempt = await requestLifecycleShutdown(state, remainingTimeoutMs());
  const lifecycleRequested = shutdownAttempt.requested;

  if (!state.pidInfo || (!state.running && !lifecycleRequested)) {
    const staleSuffix =
      state.stalePidFile && state.pidInfo ? ` (stale PID file for ${state.pidInfo.pid})` : "";
    return createNotRunningStopResult(
      state,
      state.pidInfo?.pid ?? null,
      `Daemon is not running${staleSuffix}`,
    );
  }

  const pid = state.pidInfo?.pid ?? null;
  const fallbackMessage = shutdownAttempt.requested ? null : shutdownAttempt.reason;
  if (!lifecycleRequested) {
    const notRunningResult = await signalDaemonOwnerForStop(state, pid);
    if (notRunningResult) return notRunningResult;
  }

  const { stopped, forced } = await waitForStopAfterRequest({
    state,
    pid,
    timeoutMs: remainingTimeoutMs(),
    killTimeoutMs,
    force: options.force,
  });
  if (!stopped) {
    throw createStopTimeoutError(state, pid, timeoutMs);
  }

  if (lifecycleRequested) {
    removeStalePidFile(state);
  }

  return {
    action: "stopped",
    home: state.home,
    pid,
    forced,
    usedLifecycleRpc: lifecycleRequested,
    reason: resolveStopReason(forced, lifecycleRequested),
    message: resolveStopMessage(forced, lifecycleRequested, fallbackMessage),
  };
}
