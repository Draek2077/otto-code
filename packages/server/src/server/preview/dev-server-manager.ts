import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as net from "node:net";
import { EXTERNAL_PREVIEW_SERVER_ID_PREFIX } from "@otto-code/protocol/messages";
import type { Logger } from "pino";

import {
  findLaunchConfiguration,
  LAUNCH_CONFIG_RELATIVE_PATH,
  readLaunchConfig,
  resolveLaunchConfigPath,
  type LaunchConfiguration,
} from "./launch-config.js";

/**
 * Subsystem A of the preview bridge (projects/preview-mcp/preview-mcp-implementation.md):
 * pure dev-server process supervision. Spawns configured commands from
 * `.claude/launch.json`, tracks them by serverId, captures output into a
 * bounded ring buffer, polls the port for readiness, and tree-kills on stop
 * (dev servers fork children — plain proc.kill orphans them).
 *
 * Browser-side verification (subsystem B) lives in browser-tools/ and is
 * joined to this by navigating a browser host at the returned url.
 */

const DEFAULT_MAX_LOG_LINES = 2000;
const DEFAULT_READINESS_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;
const PORT_PROBE_TIMEOUT_MS = 1_000;
/** Keyword grep used by the `level: "error"` log filter (matches the Claude Preview contract). */
const ERROR_LINE_PATTERN = /error|exception|failed|fatal/i;
/** serverId prefix for running servers observed by port probe, not by in-memory record. */
const EXTERNAL_SERVER_ID_PREFIX = EXTERNAL_PREVIEW_SERVER_ID_PREFIX;

export type PreviewServerStatus = "starting" | "running" | "exited";

export interface PreviewServerSummary {
  serverId: string;
  name: string;
  cwd: string;
  port: number;
  url: string;
  status: PreviewServerStatus;
  pid: number | null;
  exitCode: number | null;
  /** The Otto browser tab designated as this server's preview surface. */
  boundBrowserId: string | null;
}

export interface PreviewLogsQuery {
  lines?: number;
  level?: "all" | "error";
  search?: string;
}

export interface StartPreviewServerResult {
  server: PreviewServerSummary;
  reused: boolean;
  logTail: string[];
}

interface PreviewServerRecord {
  id: string;
  name: string;
  cwd: string;
  port: number;
  proc: ChildProcess;
  status: PreviewServerStatus;
  exitCode: number | null;
  log: string[];
  boundBrowserId: string | null;
}

export interface DevServerManagerOptions {
  logger: Logger;
  maxLogLines?: number;
  readinessTimeoutMs?: number;
  pollIntervalMs?: number;
  stopTimeoutMs?: number;
}

export class DevServerManager {
  private readonly logger: Logger;
  private readonly maxLogLines: number;
  private readonly readinessTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly stopTimeoutMs: number;
  private readonly servers = new Map<string, PreviewServerRecord>();
  private getProtectedPorts: () => number[] = () => [];
  /**
   * Ports reconcileRunning has reported as externally-running configured
   * servers, keyed to the workspace whose launch.json listed them. External
   * (`ext:<port>`) stops tree-kill whatever listens on the port, so only these
   * observed ports are stoppable — never an arbitrary number an agent passes
   * to preview_stop.
   */
  private readonly externalPortCwds = new Map<number, string>();

  constructor(options: DevServerManagerOptions) {
    this.logger = options.logger;
    this.maxLogLines = options.maxLogLines ?? DEFAULT_MAX_LOG_LINES;
    this.readinessTimeoutMs = options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  }

  /**
   * Ports the daemon must never tree-kill via an external (`ext:<port>`) stop:
   * its own listen port and the loopback origins of currently connected
   * clients (e.g. the Metro dev server serving the Otto app itself — killing
   * it takes down the app issuing the request). Wired lazily from bootstrap
   * because the websocket server is constructed after this manager.
   */
  setProtectedPortsProvider(provider: () => number[]): void {
    this.getProtectedPorts = provider;
  }

  async start(input: { cwd: string; name: string }): Promise<StartPreviewServerResult> {
    const running = this.findRunning(input.cwd, input.name);
    if (running) {
      return { server: summarize(running), reused: true, logTail: tail(running.log, 20) };
    }

    const entry = await this.resolveConfiguration(input.cwd, input.name);
    if (await isPortOpen(entry.port)) {
      throw new Error(
        `Port ${entry.port} is already in use by a process Otto did not start. ` +
          `Stop that process or change the port in ${LAUNCH_CONFIG_RELATIVE_PATH}.`,
      );
    }

    const record = this.spawnServer(input.cwd, entry);
    this.servers.set(record.id, record);
    try {
      await this.waitForReady(record);
    } catch (error) {
      this.servers.delete(record.id);
      await this.killTree(record).catch(() => {});
      throw error;
    }
    record.status = "running";
    this.logger.info(
      { serverId: record.id, name: record.name, port: record.port, pid: record.proc.pid },
      "Preview dev server ready",
    );
    return { server: summarize(record), reused: false, logTail: tail(record.log, 20) };
  }

  /**
   * `requireCwd` scopes the stop to one workspace: agent-facing tools pass
   * their caller's cwd so an agent can only stop servers of its own workspace,
   * while user-initiated UI stops omit it.
   */
  async stop(serverId: string, options?: { requireCwd?: string }): Promise<PreviewServerSummary> {
    // Externally-observed servers (see reconcileRunning) carry no in-memory
    // record — the daemon that spawned them is gone. Address them by port:
    // find whatever is listening and tree-kill it.
    if (serverId.startsWith(EXTERNAL_SERVER_ID_PREFIX)) {
      return this.stopExternal(serverId, options?.requireCwd);
    }
    const record = this.requireServer(serverId);
    if (options?.requireCwd !== undefined && record.cwd !== options.requireCwd) {
      throw new Error(`Server "${serverId}" belongs to a different workspace.`);
    }
    if (record.status !== "exited") {
      await this.killTree(record);
      await this.waitForExit(record);
    }
    this.servers.delete(serverId);
    return summarize(record);
  }

  list(cwd?: string): PreviewServerSummary[] {
    return [...this.servers.values()]
      .filter((record) => cwd === undefined || record.cwd === cwd)
      .map(summarize);
  }

  /**
   * Running servers for a cwd, reconciled against reality rather than trusting
   * the in-memory map alone. The map is authoritative for servers this daemon
   * instance spawned (it carries pid/logs/bound tab), but the map is wiped on
   * every daemon restart while the dev server child — spawned detached / as its
   * own process tree — keeps serving its port. In dev the daemon restarts
   * constantly (tsx watch), so without reconciliation a running preview silently
   * reverts to "not started" on the next save. We therefore also port-probe each
   * configured server we don't already track and report open ones as
   * externally-running, addressable for stop via an `ext:<port>` id. This also
   * surfaces dev servers the user started by hand.
   */
  async reconcileRunning(input: {
    cwd: string;
    configured: Array<{ name: string; port: number }>;
  }): Promise<PreviewServerSummary[]> {
    const managed = this.list(input.cwd).filter((record) => record.status !== "exited");
    const ownedPorts = new Set(managed.map((record) => record.port));
    const ownedNames = new Set(managed.map((record) => record.name));

    const external: PreviewServerSummary[] = [];
    for (const entry of input.configured) {
      if (ownedNames.has(entry.name) || ownedPorts.has(entry.port)) {
        continue;
      }
      if (await isPortOpen(entry.port)) {
        this.externalPortCwds.set(entry.port, input.cwd);
        external.push({
          serverId: `${EXTERNAL_SERVER_ID_PREFIX}${entry.port}`,
          name: entry.name,
          cwd: input.cwd,
          port: entry.port,
          url: `http://127.0.0.1:${entry.port}/`,
          status: "running",
          pid: null,
          exitCode: null,
          boundBrowserId: null,
        });
      }
    }
    return [...managed, ...external];
  }

  private async stopExternal(serverId: string, requireCwd?: string): Promise<PreviewServerSummary> {
    const port = Number.parseInt(serverId.slice(EXTERNAL_SERVER_ID_PREFIX.length), 10);
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error(`Invalid external preview server id "${serverId}".`);
    }
    if (this.getProtectedPorts().includes(port)) {
      throw new Error(
        `Refusing to stop "${serverId}": port ${port} belongs to Otto's own runtime ` +
          `(the daemon or a dev server hosting a connected Otto client).`,
      );
    }
    // Only ports we ourselves observed as configured preview servers are
    // stoppable, and the launch config must still list the port at stop time —
    // otherwise this would be a primitive for killing arbitrary local services.
    const cwd = this.externalPortCwds.get(port);
    if (!cwd) {
      throw new Error(
        `Refusing to stop "${serverId}": port ${port} is not a preview server this daemon ` +
          `has observed. Only servers reported by ${LAUNCH_CONFIG_RELATIVE_PATH} can be stopped.`,
      );
    }
    if (requireCwd !== undefined && cwd !== requireCwd) {
      throw new Error(`Server "${serverId}" belongs to a different workspace.`);
    }
    const config = await readLaunchConfig(cwd).catch(() => null);
    if (!config?.configurations.some((entry) => entry.port === port)) {
      throw new Error(
        `Refusing to stop "${serverId}": port ${port} is no longer configured in ` +
          `${LAUNCH_CONFIG_RELATIVE_PATH} for ${cwd}.`,
      );
    }
    const pids = await listListeningPids(port);
    // Never kill our own process tree even if the port lookup resolves to us
    // (stale pid reuse, misconfigured launch.json port, etc.).
    const selfPids = new Set([process.pid, process.ppid]);
    for (const pid of pids) {
      if (selfPids.has(pid)) {
        this.logger.warn(
          { serverId, port, pid },
          "Skipping external preview stop for the daemon's own process",
        );
        continue;
      }
      await killPidTree(pid).catch(() => {});
    }
    return {
      serverId,
      name: serverId,
      cwd: "",
      port,
      url: `http://127.0.0.1:${port}/`,
      status: "exited",
      pid: null,
      exitCode: null,
      boundBrowserId: null,
    };
  }

  logs(serverId: string, query?: PreviewLogsQuery): string[] {
    const record = this.requireServer(serverId);
    let lines = record.log;
    if (query?.level === "error") {
      lines = lines.filter((line) => ERROR_LINE_PATTERN.test(line));
    }
    if (query?.search) {
      const needle = query.search;
      lines = lines.filter((line) => line.includes(needle));
    }
    return tail(lines, query?.lines ?? 50);
  }

  getServer(serverId: string): PreviewServerSummary | null {
    const record = this.servers.get(serverId);
    return record ? summarize(record) : null;
  }

  /**
   * Designate an Otto browser tab as this server's preview surface. One tab
   * per server ("it") — rebinding replaces the previous designation.
   */
  bindTab(serverId: string, browserId: string): void {
    this.requireServer(serverId).boundBrowserId = browserId;
  }

  boundTab(serverId: string): string | null {
    return this.requireServer(serverId).boundBrowserId;
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled([...this.servers.keys()].map((serverId) => this.stop(serverId)));
  }

  private findRunning(cwd: string, name: string): PreviewServerRecord | null {
    for (const record of this.servers.values()) {
      if (record.cwd === cwd && record.name === name && record.status !== "exited") {
        return record;
      }
    }
    return null;
  }

  private async resolveConfiguration(cwd: string, name: string): Promise<LaunchConfiguration> {
    const config = await readLaunchConfig(cwd);
    if (!config) {
      throw new Error(
        `No ${LAUNCH_CONFIG_RELATIVE_PATH} found in ${cwd}. ` +
          `Create ${resolveLaunchConfigPath(cwd)} with the dev server configurations first.`,
      );
    }
    const entry = findLaunchConfiguration(config, name);
    if (!entry) {
      const available = config.configurations.map((candidate) => candidate.name).join(", ");
      throw new Error(
        `No configuration named "${name}" in ${LAUNCH_CONFIG_RELATIVE_PATH}. ` +
          (available ? `Available: ${available}.` : "The file has no configurations."),
      );
    }
    return entry;
  }

  private spawnServer(cwd: string, entry: LaunchConfiguration): PreviewServerRecord {
    // shell:true so "npm"/"yarn" resolve on Windows; POSIX gets detached:true
    // so the whole process group can be killed as a tree on stop.
    const proc = spawn(entry.runtimeExecutable, entry.runtimeArgs, {
      cwd,
      shell: true,
      windowsHide: true,
      detached: process.platform !== "win32",
      env: { ...process.env, ...entry.env },
    });
    const record: PreviewServerRecord = {
      id: `srv_${randomUUID().slice(0, 8)}`,
      name: entry.name,
      cwd,
      port: entry.port,
      proc,
      status: "starting",
      exitCode: null,
      log: [],
      boundBrowserId: null,
    };
    const capture = (chunk: Buffer) => {
      this.appendLog(record, chunk.toString("utf8"));
    };
    proc.stdout?.on("data", capture);
    proc.stderr?.on("data", capture);
    proc.on("error", (error) => {
      this.appendLog(record, `[spawn error] ${error.message}\n`);
    });
    proc.on("exit", (code) => {
      record.status = "exited";
      record.exitCode = code;
    });
    return record;
  }

  private appendLog(record: PreviewServerRecord, text: string): void {
    const lines = text.split(/\r?\n/u).filter((line) => line.length > 0);
    record.log.push(...lines);
    if (record.log.length > this.maxLogLines) {
      record.log.splice(0, record.log.length - this.maxLogLines);
    }
  }

  private async waitForReady(record: PreviewServerRecord): Promise<void> {
    const deadline = Date.now() + this.readinessTimeoutMs;
    while (Date.now() < deadline) {
      if (record.status === "exited") {
        throw new Error(
          `Dev server "${record.name}" exited with code ${record.exitCode} before becoming ready.\n` +
            `Last output:\n${tail(record.log, 20).join("\n")}`,
        );
      }
      if (await isPortOpen(record.port)) {
        return;
      }
      await sleep(this.pollIntervalMs);
    }
    throw new Error(
      `Dev server "${record.name}" did not open port ${record.port} within ` +
        `${Math.round(this.readinessTimeoutMs / 1000)}s.\n` +
        `Last output:\n${tail(record.log, 20).join("\n")}`,
    );
  }

  private async waitForExit(record: PreviewServerRecord): Promise<void> {
    const deadline = Date.now() + this.stopTimeoutMs;
    while (record.status !== "exited" && Date.now() < deadline) {
      await sleep(50);
    }
  }

  private requireServer(serverId: string): PreviewServerRecord {
    const record = this.servers.get(serverId);
    if (!record) {
      const known = [...this.servers.values()].map((entry) => entry.id).join(", ");
      throw new Error(
        `Unknown serverId "${serverId}". ${known ? `Running servers: ${known}.` : "No servers are running."}`,
      );
    }
    return record;
  }

  private async killTree(record: PreviewServerRecord): Promise<void> {
    const pid = record.proc.pid;
    if (!pid || record.status === "exited") {
      return;
    }
    await killPidTree(pid);
  }
}

/**
 * Tree-kill a process by pid. Dev servers fork children (a shell wrapper on
 * Windows, worker processes everywhere), so a plain kill orphans them and leaves
 * the port held.
 */
async function killPidTree(pid: number): Promise<void> {
  if (process.platform === "win32") {
    // shell:true wraps the server in cmd.exe; /T takes the whole tree down.
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/T", "/F", "/PID", String(pid)], { windowsHide: true });
      killer.on("exit", () => resolve());
      killer.on("error", () => resolve());
    });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

/** pids listening on a TCP port, used to stop servers this daemon didn't spawn. */
function listListeningPids(port: number): Promise<number[]> {
  return new Promise((resolve) => {
    let output = "";
    const child =
      process.platform === "win32"
        ? spawn("netstat", ["-ano", "-p", "tcp"], { windowsHide: true })
        : spawn("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"]);
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("error", () => resolve([]));
    child.on("close", () => {
      const pids = new Set<number>();
      if (process.platform === "win32") {
        for (const line of output.split(/\r?\n/u)) {
          // Proto  Local Address  Foreign Address  State  PID
          const cols = line.trim().split(/\s+/u);
          if (cols.length < 5 || cols[3] !== "LISTENING") {
            continue;
          }
          const local = cols[1] ?? "";
          const colon = local.lastIndexOf(":");
          if (colon !== -1 && local.slice(colon + 1) === String(port)) {
            const pid = Number.parseInt(cols[4] ?? "", 10);
            if (Number.isInteger(pid) && pid > 0) {
              pids.add(pid);
            }
          }
        }
      } else {
        for (const line of output.split(/\r?\n/u)) {
          const pid = Number.parseInt(line.trim(), 10);
          if (Number.isInteger(pid) && pid > 0) {
            pids.add(pid);
          }
        }
      }
      resolve([...pids]);
    });
  });
}

function summarize(record: PreviewServerRecord): PreviewServerSummary {
  return {
    serverId: record.id,
    name: record.name,
    cwd: record.cwd,
    port: record.port,
    url: `http://127.0.0.1:${record.port}/`,
    status: record.status,
    pid: record.proc.pid ?? null,
    exitCode: record.exitCode,
    boundBrowserId: record.boundBrowserId,
  };
}

function tail(lines: string[], count: number): string[] {
  return lines.slice(-Math.max(count, 0));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port, timeout: PORT_PROBE_TIMEOUT_MS });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });
}
