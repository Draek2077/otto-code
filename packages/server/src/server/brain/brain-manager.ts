import { execFile, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { createRequire } from "node:module";
import { networkInterfaces } from "node:os";
import path from "node:path";
import type stream from "node:stream";
import tls from "node:tls";
import type { Logger } from "pino";

import type {
  BrainBindAddress,
  BrainEvals,
  BrainHostStatus,
  BrainNetworkInfo,
  BrainTailscaleInfo,
  MutableBrainConfig,
} from "@otto-code/protocol/messages";
import { BrainEvalsSchema, BrainHostStatusSchema } from "@otto-code/protocol/messages";

import { ensurePrivateDirectory, writePrivateFileAtomicSync } from "../private-files.js";
import { spawnProcess } from "../../utils/spawn.js";
import { terminateWithTreeKill } from "../../utils/tree-kill.js";
import type { ManagedProcessRegistry } from "../managed-processes/managed-processes.js";

/**
 * Daemon-managed lifecycle for @otto-code/brain (the local AI host). Modeled on
 * DevServerManager (spawn + readiness poll + ring-buffer logs + tree-kill) and
 * the OpenCode server manager (managed-process ledger registration, crash
 * restart policy). See docs/providers.md / packages/brain/CLAUDE.md.
 *
 * The daemon spawns the brain's `serve` command as a FOREGROUND managed child
 * (not `start`, which self-detaches): the daemon holds the ChildProcess so the
 * brain dies with the daemon, and talks to it only over HTTP (its /__host/*
 * API + /health). The brain's own $OTTO_HOME/otto-brain/config.json stays the
 * source of truth on disk; the daemon's `brain` config block is the editable
 * projection and applySettings writes it through.
 */

const HEALTH_READINESS_TIMEOUT_MS = 60_000;
const HEALTH_POLL_INTERVAL_MS = 500;
const HTTP_PROBE_TIMEOUT_MS = 2_000;
// A remote config write can trigger a model load on the far side, which is slow.
const CONFIG_WRITE_TIMEOUT_MS = 60_000;
const STOP_GRACEFUL_TIMEOUT_MS = 5_000;
const STOP_FORCE_TIMEOUT_MS = 2_000;
const MAX_LOG_LINES = 2_000;
const MAX_LOG_LINE_CHARS = 1_000;
/** Crash-restart policy: at most this many respawns inside the window before giving up. */
const MAX_FAST_RESTARTS = 3;
const RESTART_WINDOW_MS = 60_000;
const RESTART_DELAY_MS = 1_000;

const DEFAULT_BRAIN_HOST = "127.0.0.1";
const DEFAULT_BRAIN_PORT = 1234;

export interface BrainManagerOptions {
  logger: Logger;
  managedProcesses: ManagedProcessRegistry;
  ottoHome: string;
}

/**
 * How an HTTPS brain's identity is established before anything is written to
 * the connection. The auth token rides in the request headers, so this is a
 * security boundary: a peer that is not authenticated must never see a byte.
 *
 *  - "loopback-child": the daemon-spawned child probed over 127.0.0.1. Its
 *    certificate can never validate for a loopback address (self-signed, or a
 *    tailscale cert issued for the MagicDNS name) and the traffic never leaves
 *    this machine, so certificate checks are skipped.
 *  - "system": a remote brain with a chain-of-trust certificate (tls.mode
 *    files/tailscale). Normal verification against the system trust store.
 *  - "pinned": a remote brain with a self-signed certificate. The handshake
 *    completes with chain checks off, then the peer certificate's SHA-256
 *    fingerprint is compared to the configured pin before the socket is
 *    released to the request (see connectPinned).
 */
type BrainTlsTrust =
  | { kind: "loopback-child" }
  | { kind: "system" }
  | { kind: "pinned"; fingerprint: string };

/** Where and how to reach the running brain, derived from the applied config. */
interface BrainEndpoint {
  probeHost: string;
  port: number;
  secure: boolean;
  token: string | null;
  trust: BrainTlsTrust;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The daemon and the brain share a machine, so the daemon always probes over
 * loopback even when the brain binds to a wildcard or the tailnet interface.
 */
function resolveProbeHost(host: string): string {
  if (host === "0.0.0.0" || host === "::" || host === "tailscale") {
    return DEFAULT_BRAIN_HOST;
  }
  return host || DEFAULT_BRAIN_HOST;
}

export class BrainManager {
  private readonly logger: Logger;
  private readonly managedProcesses: ManagedProcessRegistry;
  private readonly ottoHome: string;

  private child: ChildProcess | null = null;
  private managedProcessId: string | null = null;
  private startPromise: Promise<void> | null = null;
  /** True while the operator wants the brain running; false disables crash restarts. */
  private wantRunning = false;
  private desiredModel: string | null = null;
  /** "local": we spawn/supervise a child. "remote": we only probe another host. */
  private mode: "local" | "remote" = "local";
  /** Signature of the last-applied restart-requiring fields (see applySettings). */
  private lastStructuralSig: string | null = null;
  private endpoint: BrainEndpoint = {
    probeHost: DEFAULT_BRAIN_HOST,
    port: DEFAULT_BRAIN_PORT,
    secure: false,
    token: null,
    trust: { kind: "loopback-child" },
  };
  private readonly log: string[] = [];
  private restartCount = 0;
  private restartWindowStart = 0;

  constructor(options: BrainManagerOptions) {
    this.logger = options.logger.child({ module: "brain-manager" });
    this.managedProcesses = options.managedProcesses;
    this.ottoHome = options.ottoHome;
  }

  /**
   * Write the daemon's editable projection through to the brain's config.json,
   * then reconcile the running child against the new intent:
   *  - disabled            → stop.
   *  - running, model diff  → restart onto the new model.
   *  - enabled + autoStart  → ensure it is running.
   * A brain that is enabled but not autoStart is left for an explicit start RPC.
   *
   * In "remote" mode there is no child and no config write-through: we only
   * repoint the probe endpoint at the remote host and stop any local child that
   * a mode switch left behind. status()/evals() then read the remote /__host/*.
   */
  async applySettings(brain: MutableBrainConfig): Promise<void> {
    this.mode = brain.mode;

    if (brain.mode === "remote") {
      this.endpoint = {
        probeHost: brain.remote.host,
        port: brain.remote.port,
        secure: brain.remote.secure,
        token: brain.remote.authToken,
        trust: this.resolveRemoteTrust(brain.remote.certFingerprint),
      };
      // A prior local child must not outlive the switch to remote.
      await this.stop();
      return;
    }

    this.endpoint = {
      probeHost: resolveProbeHost(brain.listen.host),
      port: brain.listen.port,
      secure: brain.tls.mode !== "off",
      token: brain.authMode === "token" ? brain.authToken : null,
      trust: { kind: "loopback-child" },
    };
    this.writeThroughConfig(brain);

    if (!brain.enabled) {
      await this.stop();
      return;
    }

    const model = brain.defaultModel;
    // A running llama-server binds host/port/TLS/auth at launch and the router
    // reads defaultModel/lockModel once at startup, so structural edits only
    // take effect on a restart. Apply them for the operator by restarting the
    // running child, rather than making them restart it by hand.
    const sig = structuralSignature(brain);
    const changed = sig !== this.lastStructuralSig;
    this.lastStructuralSig = sig;
    if (this.isChildAlive() && changed) {
      await this.restart(model);
      return;
    }
    if (brain.autoStart) {
      await this.ensureRunning(model);
    }
  }

  /** Spawn the brain's `serve` child if not already running, and wait for /health. */
  async ensureRunning(model?: string | null): Promise<void> {
    if (this.mode === "remote") {
      throw new Error("This brain runs on a remote host; start it on that host.");
    }
    this.wantRunning = true;
    this.desiredModel = model ?? null;
    if (this.isChildAlive()) {
      return;
    }
    if (this.startPromise) {
      return this.startPromise;
    }
    this.startPromise = this.startChild(model ?? null).finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  /** Tree-kill the child and drop its ledger record. Disables crash restarts. */
  async stop(): Promise<void> {
    this.wantRunning = false;
    this.desiredModel = null;
    const child = this.child;
    this.child = null;
    if (child) {
      await terminateWithTreeKill(child, {
        gracefulTimeoutMs: STOP_GRACEFUL_TIMEOUT_MS,
        forceTimeoutMs: STOP_FORCE_TIMEOUT_MS,
        onForceSignal: () => {
          this.logger.warn(
            { timeoutMs: STOP_GRACEFUL_TIMEOUT_MS },
            "otto-brain did not exit after SIGTERM; sending SIGKILL",
          );
        },
      }).catch((error: unknown) => {
        this.logger.warn({ err: error }, "Failed to terminate otto-brain child");
      });
    }
    await this.removeManagedRecord();
  }

  /** Stop then start again onto the given model. Keeps the running intent. */
  async restart(model?: string | null): Promise<void> {
    await this.stop();
    await this.ensureRunning(model);
  }

  /** For daemon teardown: kill the child so it never outlives the daemon. */
  async shutdown(): Promise<void> {
    await this.stop();
  }

  /**
   * Live status: running requires both a live child AND a successful
   * GET /__host/status. The brain's status JSON (version/state/model/vram/
   * telemetry/scheduler/recent) is merged in; the schema is passthrough so the
   * brain can evolve those sub-objects without a protocol bump.
   */
  async status(): Promise<BrainHostStatus> {
    if (this.mode === "remote") {
      return this.remoteStatus();
    }
    const child = this.child;
    if (!child || !this.isChildAlive()) {
      return { running: false };
    }
    const pid = child.pid ?? null;
    const hostStatus = await this.fetchHostJson("/__host/status");
    if (!hostStatus) {
      // Child is up but the host API is not answering yet (still binding or
      // loading a model). Report it as coming up rather than as running.
      return {
        running: false,
        pid,
        host: this.endpoint.probeHost,
        port: this.endpoint.port,
        secure: this.endpoint.secure,
        state: "starting",
        lastError: this.lastLogLine(),
      };
    }
    const merged: Record<string, unknown> = {
      host: this.endpoint.probeHost,
      port: this.endpoint.port,
      secure: this.endpoint.secure,
      ...hostStatus,
      running: true,
      pid,
    };
    const parsed = BrainHostStatusSchema.safeParse(merged);
    return parsed.success ? parsed.data : { running: true, pid };
  }

  /**
   * Remote status: there is no child, so "running" tracks whether the remote
   * brain's host API answers. No pid; the host/port/secure reflect the remote
   * target so the UI shows where it is pointed even when unreachable.
   */
  private async remoteStatus(): Promise<BrainHostStatus> {
    const endpointFields = {
      host: this.endpoint.probeHost,
      port: this.endpoint.port,
      secure: this.endpoint.secure,
    };
    if (!this.endpoint.probeHost) {
      return { running: false, ...endpointFields, state: "unconfigured" };
    }
    const hostStatus = await this.fetchHostJson("/__host/status");
    if (!hostStatus) {
      return {
        running: false,
        ...endpointFields,
        state: "unreachable",
        lastError: "The remote brain did not answer.",
      };
    }
    const merged: Record<string, unknown> = {
      ...endpointFields,
      ...hostStatus,
      running: true,
      pid: null,
    };
    const parsed = BrainHostStatusSchema.safeParse(merged);
    return parsed.success ? parsed.data : { running: true };
  }

  /**
   * Detected model names, read from the brain's /v1/models when it is reachable
   * (local child up, or remote). Returns [] when unreachable — the client shows
   * a disabled picker rather than a text box. Never throws.
   */
  async listModels(): Promise<string[]> {
    const reachable =
      this.mode === "remote" ? Boolean(this.endpoint.probeHost) : this.isChildAlive();
    if (!reachable) {
      return [];
    }
    const json = await this.fetchHostJson("/v1/models");
    const data = json && Array.isArray(json.data) ? json.data : [];
    const names: string[] = [];
    for (const entry of data) {
      if (isRecord(entry) && typeof entry.id === "string" && entry.id) {
        names.push(entry.id);
      }
    }
    return names;
  }

  /**
   * The remote brain's own effective config (its GET /__host/config), or null
   * when unreachable. Remote mode only — the local brain's config is the daemon's
   * own `brain` block, not this.
   */
  async getRemoteConfig(): Promise<Record<string, unknown> | null> {
    if (this.mode !== "remote") {
      throw new Error("The brain is not configured in remote mode.");
    }
    return this.fetchHostJson("/__host/config");
  }

  /**
   * Apply an editable patch to the remote brain (its POST /__host/config) and
   * return the new effective config. Throws on a non-200 so the operator sees
   * why a change was rejected. Remote mode only.
   */
  async patchRemoteConfig(patch: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    if (this.mode !== "remote") {
      throw new Error("The brain is not configured in remote mode.");
    }
    return this.postHostJson("/__host/config", patch);
  }

  /** Benchmark rankings/variance/latest, or null when the brain is unreachable. */
  async evals(): Promise<BrainEvals | null> {
    // Local requires a live child; remote just needs the endpoint configured.
    if (this.mode === "local" ? !this.isChildAlive() : !this.endpoint.probeHost) {
      return null;
    }
    const json = await this.fetchHostJson("/__host/evals");
    if (!json) {
      return null;
    }
    const parsed = BrainEvalsSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  }

  /**
   * Enumerate this host's likely bind addresses and probe the local `tailscale`
   * CLI, so the client can offer a listen-host pick-list and auto-fill the
   * tailscale TLS mode. Never throws: an absent CLI just yields
   * `tailscale.available: false`, and the loopback/all options are always
   * present so the picker is never empty.
   */
  async discoverNetwork(): Promise<BrainNetworkInfo> {
    const tailscale = await this.discoverTailscale();
    const addresses: BrainBindAddress[] = [
      { value: DEFAULT_BRAIN_HOST, label: "Local only", kind: "loopback" },
      { value: "0.0.0.0", label: "All interfaces", kind: "all" },
      ...listLanAddresses(),
    ];
    if (tailscale.available) {
      const detail = tailscale.hostname ?? tailscale.ipv4;
      addresses.push({
        value: "tailscale",
        label: detail ? `Tailscale (${detail})` : "Tailscale",
        kind: "tailscale",
      });
    }
    return { addresses, tailscale };
  }

  /**
   * Probe the local `tailscale` CLI so the client can auto-fill the tailscale
   * TLS mode. Returns `available: false` (never throws) when the CLI is absent
   * or its daemon is down, so the UI can render a plain "not detected" state.
   * The cert directory is the brain's default sink, independent of Tailscale.
   */
  private async discoverTailscale(): Promise<BrainTailscaleInfo> {
    const exe = this.resolveTailscaleExe();
    const certDir = path.join(this.ottoHome, "otto-brain", "certs");
    if (!(await tailscaleAvailable(exe))) {
      return { available: false, hostname: null, ipv4: null, certDir };
    }
    const [hostname, ipv4] = await Promise.all([
      tailscaleDnsName(exe).catch(() => null),
      tailscaleIpv4(exe).catch(() => null),
    ]);
    return { available: true, hostname, ipv4, certDir };
  }

  /**
   * The tailscale executable to probe: the brain's own `tls.tailscaleExe`
   * override if it set one, else `tailscale` on PATH.
   */
  private resolveTailscaleExe(): string {
    const configPath = path.join(this.ottoHome, "otto-brain", "config.json");
    if (existsSync(configPath)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
        if (
          isRecord(parsed) &&
          isRecord(parsed.tls) &&
          typeof parsed.tls.tailscaleExe === "string"
        ) {
          const exe = parsed.tls.tailscaleExe.trim();
          if (exe) {
            return exe;
          }
        }
      } catch {
        // Fall through to the PATH default.
      }
    }
    return DEFAULT_TAILSCALE_EXE;
  }

  private async startChild(model: string | null): Promise<void> {
    const binPath = resolveBrainBinPath();
    const args = ["serve", ...(model ? ["--model", model] : [])];
    // process.execPath is the daemon's own runtime; ELECTRON_RUN_AS_NODE forces
    // it to behave as plain Node when the daemon itself runs under Electron.
    // envMode:"internal" preserves the full parent env (the external sanitizer
    // would strip ELECTRON_RUN_AS_NODE and break that).
    const child = spawnProcess(process.execPath, [binPath, ...args], {
      envMode: "internal",
      envOverlay: { OTTO_HOME: this.ottoHome, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    this.child = child;
    this.desiredModel = model;

    const capture = (chunk: Buffer) => this.appendLog(chunk.toString("utf8"));
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    child.on("error", (error) => {
      this.appendLog(`[spawn error] ${error.message}\n`);
    });
    child.on("exit", (code, signal) => {
      this.handleChildExit(child, code, signal);
    });

    await this.recordManagedProcess(child, binPath, args);

    try {
      await this.waitForHealthy(child);
      this.logger.info(
        { pid: child.pid, port: this.endpoint.port, model },
        "otto-brain host is ready",
      );
    } catch (error) {
      // Readiness failed: kill the half-started child so it is never left orphaned.
      this.child = null;
      await terminateWithTreeKill(child, { gracefulTimeoutMs: STOP_GRACEFUL_TIMEOUT_MS }).catch(
        () => undefined,
      );
      await this.removeManagedRecord();
      throw error;
    }
  }

  private async waitForHealthy(child: ChildProcess): Promise<void> {
    const deadline = Date.now() + HEALTH_READINESS_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `otto-brain exited with code ${child.exitCode} before becoming ready.\n` +
            `Last output:\n${this.log.slice(-20).join("\n")}`,
        );
      }
      if (await this.probeHealth()) {
        return;
      }
      await sleep(HEALTH_POLL_INTERVAL_MS);
    }
    throw new Error(
      `otto-brain did not answer /health within ${Math.round(HEALTH_READINESS_TIMEOUT_MS / 1000)}s.\n` +
        `Last output:\n${this.log.slice(-20).join("\n")}`,
    );
  }

  private handleChildExit(
    child: ChildProcess,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.child !== child) {
      // A newer generation (or an intentional stop) already replaced this child.
      return;
    }
    this.child = null;
    void this.removeManagedRecord();
    if (!this.wantRunning) {
      return;
    }
    // Unexpected exit while we still want it running: apply the fast-failure
    // restart policy so a crash loop gives up instead of spinning forever.
    const now = Date.now();
    if (now - this.restartWindowStart > RESTART_WINDOW_MS) {
      this.restartWindowStart = now;
      this.restartCount = 0;
    }
    this.restartCount += 1;
    if (this.restartCount > MAX_FAST_RESTARTS) {
      this.logger.error(
        { code, signal, restarts: this.restartCount },
        "otto-brain crashed repeatedly; giving up on automatic restart",
      );
      this.wantRunning = false;
      return;
    }
    this.logger.warn(
      { code, signal, restarts: this.restartCount },
      "otto-brain exited unexpectedly; restarting",
    );
    const model = this.desiredModel;
    setTimeout(() => {
      if (this.wantRunning && !this.isChildAlive()) {
        void this.ensureRunning(model).catch((error: unknown) => {
          this.logger.warn({ err: error }, "Failed to restart otto-brain after crash");
        });
      }
    }, RESTART_DELAY_MS).unref();
  }

  private async recordManagedProcess(
    child: ChildProcess,
    command: string,
    args: string[],
  ): Promise<void> {
    const pid = child.pid;
    if (typeof pid !== "number" || pid <= 0) {
      return;
    }
    try {
      const record = await this.managedProcesses.record({
        owner: { provider: "brain", kind: "service" },
        pid,
        command: process.execPath,
        args: [command, ...args],
        metadata: { port: this.endpoint.port },
      });
      // Only keep the id if this is still the current child (an exit/stop may
      // have raced ahead while the record was being written).
      if (this.child === child) {
        this.managedProcessId = record.id;
      } else {
        await this.managedProcesses.remove(record.id).catch(() => undefined);
      }
    } catch (error) {
      this.logger.warn({ err: error, pid }, "Failed to record otto-brain managed process");
    }
  }

  private async removeManagedRecord(): Promise<void> {
    const id = this.managedProcessId;
    this.managedProcessId = null;
    if (!id) {
      return;
    }
    await this.managedProcesses.remove(id).catch((error: unknown) => {
      this.logger.warn({ err: error, id }, "Failed to remove otto-brain managed process record");
    });
  }

  /**
   * Write the mapped fields of the daemon's editable block into the brain's
   * config.json, preserving every sibling key the brain owns (runtime, models
   * dir, measured defaults, tls.checkIntervalMs, …). The brain's config.json is
   * the on-disk source of truth; this is the write-through of the projection.
   */
  private writeThroughConfig(brain: MutableBrainConfig): void {
    const configPath = path.join(this.ottoHome, "otto-brain", "config.json");
    ensurePrivateDirectory(path.dirname(configPath));

    let existing: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
        if (isRecord(parsed)) {
          existing = parsed;
        }
      } catch (error) {
        this.logger.warn(
          { err: error, configPath },
          "Could not parse otto-brain config; rewriting",
        );
      }
    }

    const existingListen = isRecord(existing.listen) ? existing.listen : {};
    const existingAuth = isRecord(existing.auth) ? existing.auth : {};
    const existingTls = isRecord(existing.tls) ? existing.tls : {};

    const next: Record<string, unknown> = {
      ...existing,
      version: typeof existing.version === "number" ? existing.version : 1,
      enabled: brain.enabled,
      autoStart: brain.autoStart,
      listen: { ...existingListen, host: brain.listen.host, port: brain.listen.port },
      defaultModel: brain.defaultModel,
      lockModel: brain.lockModel,
      allowRemoteConfig: brain.allowRemoteConfig,
      allowInsecureBind: brain.allowInsecureBind,
      auth: { ...existingAuth, mode: brain.authMode, token: brain.authToken },
      tls: {
        ...existingTls,
        mode: brain.tls.mode,
        certFile: brain.tls.certFile,
        keyFile: brain.tls.keyFile,
        hostname: brain.tls.hostname,
        certDir: brain.tls.certDir,
        renewBeforeDays: brain.tls.renewBeforeDays,
      },
    };

    try {
      writePrivateFileAtomicSync(configPath, JSON.stringify(next, null, 2) + "\n");
    } catch (error) {
      this.logger.warn({ err: error, configPath }, "Failed to write otto-brain config");
    }
  }

  private isChildAlive(): boolean {
    return this.child !== null && this.child.exitCode === null && this.child.signalCode === null;
  }

  private probeHealth(): Promise<boolean> {
    return new Promise((resolve) => {
      // Single settle point: the response and the error handler are mutually
      // exclusive at runtime, but the once-guard keeps it that way statically too.
      let settled = false;
      const done = (value: boolean) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      const req = this.buildRequest("/health", (res) => {
        res.resume();
        done(res.statusCode === 200);
      });
      req.on("error", () => done(false));
      req.end();
    });
  }

  private fetchHostJson(pathname: string): Promise<Record<string, unknown> | null> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (value: Record<string, unknown> | null) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      const req = this.buildRequest(pathname, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          done(null);
          return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => {
          try {
            const parsed: unknown = JSON.parse(body);
            done(isRecord(parsed) ? parsed : null);
          } catch {
            done(null);
          }
        });
      });
      req.on("error", () => done(null));
      req.end();
    });
  }

  /**
   * The remote fingerprint pin, canonicalized, as an endpoint trust. An unset
   * pin means the certificate must validate against the system trust store; a
   * set-but-unparseable pin also falls back to strict validation (failing
   * closed) with a warning, never to an unauthenticated connection.
   */
  private resolveRemoteTrust(certFingerprint: string | null | undefined): BrainTlsTrust {
    const pin = normalizeFingerprint(certFingerprint);
    if (certFingerprint && !pin) {
      this.logger.warn(
        { certFingerprint },
        "brain.remote.certFingerprint is not a SHA-256 fingerprint; requiring a system-trusted certificate instead",
      );
    }
    return pin ? { kind: "pinned", fingerprint: pin } : { kind: "system" };
  }

  /**
   * Open the HTTP(S) request for the current endpoint. Every brain request
   * funnels through here so the GET and POST paths cannot drift on TLS
   * handling. See BrainTlsTrust for how each trust kind authenticates the
   * peer; the invariant is that the headers (which carry the auth token) are
   * never written to a network peer that has not been authenticated.
   */
  private dispatchRequest(
    options: http.RequestOptions,
    onResponse: (res: http.IncomingMessage) => void,
  ): http.ClientRequest {
    if (!this.endpoint.secure) {
      return http.request(options, onResponse);
    }
    const trust = this.endpoint.trust;
    switch (trust.kind) {
      case "loopback-child":
        return https.request({ ...options, rejectUnauthorized: false }, onResponse);
      case "system":
        // Node's default rejectUnauthorized: true — full chain + hostname checks.
        return https.request(options, onResponse);
      case "pinned":
        // http.request (not https): the createConnection hook hands over an
        // already-negotiated, fingerprint-verified TLS socket, so the client
        // just writes HTTP into it.
        return http.request(
          {
            ...options,
            createConnection: (_connectOptions, oncreate) =>
              connectPinned(
                {
                  host: this.endpoint.probeHost,
                  port: this.endpoint.port,
                  fingerprint: trust.fingerprint,
                  timeoutMs:
                    typeof options.timeout === "number" ? options.timeout : HTTP_PROBE_TIMEOUT_MS,
                },
                oncreate,
              ),
          },
          onResponse,
        );
    }
  }

  private buildRequest(
    pathname: string,
    onResponse: (res: http.IncomingMessage) => void,
  ): http.ClientRequest {
    const request = this.dispatchRequest(
      {
        host: this.endpoint.probeHost,
        port: this.endpoint.port,
        path: pathname,
        method: "GET",
        timeout: HTTP_PROBE_TIMEOUT_MS,
        headers: this.endpoint.token ? { "x-otto-brain-token": this.endpoint.token } : {},
      },
      onResponse,
    );
    request.on("timeout", () => request.destroy());
    return request;
  }

  /** POST a JSON body and resolve the parsed 200 response; reject on non-200. */
  private postHostJson(pathname: string, body: unknown): Promise<Record<string, unknown> | null> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (!settled) {
          settled = true;
          fn();
        }
      };
      const payload = Buffer.from(JSON.stringify(body), "utf8");
      const options: http.RequestOptions = {
        host: this.endpoint.probeHost,
        port: this.endpoint.port,
        path: pathname,
        method: "POST",
        timeout: CONFIG_WRITE_TIMEOUT_MS,
        headers: {
          "content-type": "application/json",
          "content-length": String(payload.length),
          ...(this.endpoint.token ? { "x-otto-brain-token": this.endpoint.token } : {}),
        },
      };
      const onResponse = (res: http.IncomingMessage) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode !== 200) {
            settle(() => reject(new Error(remoteErrorDetail(data, res.statusCode ?? 0))));
            return;
          }
          try {
            const parsed: unknown = JSON.parse(data);
            settle(() => resolve(isRecord(parsed) ? parsed : null));
          } catch {
            settle(() => reject(new Error("the remote brain returned an invalid response")));
          }
        });
      };
      const request = this.dispatchRequest(options, onResponse);
      request.on("timeout", () => request.destroy(new Error("the remote brain timed out")));
      request.on("error", (err: Error) => settle(() => reject(err)));
      request.write(payload);
      request.end();
    });
  }

  private lastLogLine(): string | null {
    return this.log.length > 0 ? this.log[this.log.length - 1] : null;
  }

  private appendLog(text: string): void {
    const lines = text
      .split(/\r?\n/u)
      .filter((line) => line.length > 0)
      .map((line) =>
        line.length > MAX_LOG_LINE_CHARS
          ? `${line.slice(0, MAX_LOG_LINE_CHARS)} [... ${line.length - MAX_LOG_LINE_CHARS} characters truncated ...]`
          : line,
      );
    this.log.push(...lines);
    if (this.log.length > MAX_LOG_LINES) {
      this.log.splice(0, this.log.length - MAX_LOG_LINES);
    }
  }
}

/**
 * Resolve the brain's standalone launcher (bin/otto-brain) off the installed
 * @otto-code/brain package. We depend on the package only to find this path; the
 * daemon never imports its runtime/service modules in-process.
 *
 * The package directory is located off the module search paths rather than via
 * `require.resolve("@otto-code/brain/package.json")`: the brain's `exports` map
 * does not expose `./package.json` (that resolve throws ERR_PACKAGE_PATH_NOT_
 * EXPORTED), and its `.` entry points at `dist/` which is absent in a fresh dev
 * checkout. Walking the search paths for `bin/otto-brain` is build-independent
 * and not gated by the exports map.
 */
export function resolveBrainBinPath(): string {
  const require = createRequire(import.meta.url);
  const searchPaths = require.resolve.paths("@otto-code/brain") ?? [];
  for (const base of searchPaths) {
    const candidate = path.join(base, "@otto-code", "brain", "bin", "otto-brain");
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    "Could not locate the @otto-code/brain launcher (bin/otto-brain). " +
      "Ensure @otto-code/brain is installed.",
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A stable string of the brain fields a running llama-server only picks up at
 * launch (bind, TLS, auth, default model, model lock). applySettings restarts
 * the child when this changes so edits take effect without a manual restart.
 * Deliberately excludes enabled/autoStart, which are lifecycle, not launch args.
 */
/**
 * Canonical form of a SHA-256 certificate fingerprint: uppercase hex with the
 * separators stripped. Accepts the common presentations (openssl/Node's
 * "AB:CD:..." and bare hex) and returns null for anything that is not 32 bytes
 * of hex, so a malformed pin can never accidentally match.
 */
function normalizeFingerprint(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const hex = raw.replace(/[:\s]/gu, "").toUpperCase();
  return /^[0-9A-F]{64}$/u.test(hex) ? hex : null;
}

interface PinnedConnectOptions {
  host: string;
  port: number;
  /** Expected SHA-256 fingerprint, already normalized (see normalizeFingerprint). */
  fingerprint: string;
  timeoutMs: number;
}

/**
 * Establish a TLS connection whose peer is authenticated by certificate
 * fingerprint instead of a chain of trust, for remote brains serving a
 * self-signed certificate. The socket is handed to the HTTP request via
 * `oncreate` only AFTER the handshake completed and the peer certificate's
 * SHA-256 fingerprint matched the pin, so the request cannot write anything
 * (headers, the auth token) to an unauthenticated peer. On a mismatch the
 * socket is destroyed with nothing sent beyond the TLS handshake itself.
 *
 * The pre-handoff timeout exists because the request's own `timeout` option
 * only arms once a socket is assigned; without it a black-holed handshake
 * would hang the request forever.
 */
function connectPinned(
  options: PinnedConnectOptions,
  oncreate: (err: Error | null, socket: stream.Duplex) => void,
): undefined {
  const socket = tls.connect({
    host: options.host,
    port: options.port,
    // Chain verification cannot succeed for a self-signed certificate; the
    // peer's identity is established by the fingerprint comparison below,
    // before the socket is released to the request.
    rejectUnauthorized: false,
  });
  // On failure the (destroyed) socket still rides along: Node's oncreate
  // contract always takes one and ignores it when err is set.
  let settled = false;
  const settle = (err: Error | null) => {
    if (!settled) {
      settled = true;
      oncreate(err, socket);
    }
  };
  socket.setTimeout(options.timeoutMs, () => {
    socket.destroy();
    settle(new Error("the remote brain timed out during the TLS handshake"));
  });
  socket.once("error", (err: Error) => settle(err));
  socket.once("secureConnect", () => {
    socket.setTimeout(0);
    const presented = normalizeFingerprint(socket.getPeerCertificate()?.fingerprint256);
    if (presented && presented === options.fingerprint) {
      settle(null);
      return;
    }
    socket.destroy();
    settle(
      new Error(
        "the remote brain presented a TLS certificate that does not match the pinned fingerprint",
      ),
    );
  });
  return undefined;
}

/** Pull a useful message out of a non-200 remote-brain response body. */
function remoteErrorDetail(data: string, status: number): string {
  try {
    const parsed: unknown = JSON.parse(data);
    if (isRecord(parsed) && typeof parsed.error === "string") {
      return `the remote brain returned ${status}: ${parsed.error}`;
    }
  } catch {
    // Not JSON; fall through to the bare status.
  }
  return `the remote brain returned ${status}`;
}

function structuralSignature(brain: MutableBrainConfig): string {
  return JSON.stringify({
    listen: brain.listen,
    tls: brain.tls,
    authMode: brain.authMode,
    authToken: brain.authToken,
    defaultModel: brain.defaultModel,
    lockModel: brain.lockModel,
  });
}

// ---------------------------------------------------------------------------
// Tailscale CLI probes (mirrors packages/brain/src/service/tailscale.ts). The
// daemon shells out to the CLI directly rather than importing the brain's
// service modules in-process, matching how it treats the rest of the brain.
// ---------------------------------------------------------------------------

const DEFAULT_TAILSCALE_EXE = "tailscale";

function runTailscale(exe: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(exe, args, { timeout, windowsHide: true }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(String(stdout));
    });
  });
}

/** True if the tailscale CLI is present and the daemon answers `version`. */
async function tailscaleAvailable(exe: string): Promise<boolean> {
  try {
    await runTailscale(exe, ["version"], 10_000);
    return true;
  } catch {
    return false;
  }
}

/** This machine's MagicDNS name, trailing dot stripped, or null when unknown. */
async function tailscaleDnsName(exe: string): Promise<string | null> {
  const stdout = await runTailscale(exe, ["status", "--json"], 15_000);
  const status: unknown = JSON.parse(stdout);
  const name = isRecord(status) && isRecord(status.Self) ? status.Self.DNSName : undefined;
  if (typeof name !== "string" || !name) {
    return null;
  }
  return name.replace(/\.$/u, "");
}

/** The tailnet IPv4 address of this machine, or null when unavailable. */
async function tailscaleIpv4(exe: string): Promise<string | null> {
  const stdout = await runTailscale(exe, ["ip", "-4"], 15_000);
  const address = stdout.trim().split(/\r?\n/u)[0]?.trim();
  return address ? address : null;
}

/**
 * This host's non-loopback IPv4 addresses, one entry per interface, labeled
 * with the interface name (e.g. "192.168.1.42 (en0)") so the operator can pick
 * the LAN address they mean without reading `ipconfig`/`ifconfig` by hand.
 */
function listLanAddresses(): BrainBindAddress[] {
  const out: BrainBindAddress[] = [];
  for (const [name, infos] of Object.entries(networkInterfaces())) {
    for (const info of infos ?? []) {
      // Node <18 reports family as the string "IPv4"; >=18 as the number 4.
      const isIpv4 = info.family === "IPv4" || (info.family as unknown as number) === 4;
      if (!isIpv4 || info.internal) {
        continue;
      }
      out.push({ value: info.address, label: `${info.address} (${name})`, kind: "lan" });
    }
  }
  return out;
}
