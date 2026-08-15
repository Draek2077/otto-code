import { execFile, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { createRequire } from "node:module";
import { networkInterfaces } from "node:os";
import path from "node:path";
import type stream from "node:stream";
import tls from "node:tls";
import { Agent, type Dispatcher } from "undici";
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
const BRAIN_RUN_LOG_SUFFIX = "-brain.log";
const BRAIN_SESSION_LOG_LINE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\s/u;
/** Crash-restart policy: at most this many respawns inside the window before giving up. */
const MAX_FAST_RESTARTS = 3;
const RESTART_WINDOW_MS = 60_000;
const RESTART_DELAY_MS = 1_000;

/**
 * How long the daemon tolerates silence on the status stream before treating it
 * as dead. The brain writes a keepalive comment every 20s, so this only trips on
 * a stream that is genuinely gone in a way TCP has not noticed yet - a suspended
 * remote host, a NAT table that dropped the mapping.
 */
const EVENT_STREAM_IDLE_TIMEOUT_MS = 60_000;
/** Reconnect backoff for the status stream: first retry, then doubling to the cap. */
const EVENT_RECONNECT_MIN_MS = 1_000;
const EVENT_RECONNECT_MAX_MS = 30_000;
/** Refuse an absurd SSE frame rather than buffering it. A snapshot is a few KB. */
const MAX_EVENT_FRAME_BYTES = 4 * 1024 * 1024;

const DEFAULT_BRAIN_HOST = "127.0.0.1";
const DEFAULT_BRAIN_PORT = 1234;

export interface BrainManagerOptions {
  logger: Logger;
  managedProcesses: ManagedProcessRegistry;
  ottoHome: string;
  /**
   * Called whenever the brain's reachability may have changed (settings
   * applied, child started/stopped/crashed). The `otto-brain` provider's models
   * and status are derived from that reachability, so its snapshot entry has to
   * be re-probed rather than left showing a stale green dot.
   */
  onReachabilityChanged?: () => void;
  /**
   * Called with a complete cheap status snapshot whenever the brain's own state
   * changes. Wired late by the WebSocket server, which broadcasts it as
   * `brain_status_changed`. See subscribeStatusEvents for where the snapshots
   * come from.
   */
  onStatusChanged?: (status: BrainHostStatus) => void;
  /** Called for each completed Brain-session log line from the host SSE stream. */
  onLogLine?: (line: string) => void;
  /**
   * Called when `supportsStatusEvents()` flips, so the daemon can re-broadcast
   * `server_info`. Availability is not a fixed daemon capability: it depends on
   * the brain currently selected, which the operator can repoint at any time.
   */
  onStatusEventSupportChanged?: () => void;
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

/**
 * What the `otto-brain` agent provider needs to talk to the brain's
 * OpenAI-compatible surface, derived entirely from the brain settings. There is
 * no provider-level URL or API key: "unavailable" carries the operator-facing
 * reason (off, not started, no remote host) that the provider surfaces as its
 * error, which is what turns the Providers row red.
 */
export type BrainProviderEndpoint =
  | {
      state: "ready";
      /** Already `/v1`-suffixed, ready for the OpenAI-compatible client. */
      baseUrl: string;
      /** The brain's auth token, presented as a bearer credential. */
      apiKey: string | null;
      /**
       * undici dispatcher carrying this endpoint's TLS trust (see BrainTlsTrust),
       * or null when the platform default is correct (plain HTTP, or HTTPS with a
       * chain-of-trust certificate). Built here so the agent provider stays free
       * of TLS policy.
       */
      dispatcher: Dispatcher | null;
    }
  | { state: "unavailable"; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Options for a status read. */
export interface BrainStatusOptions {
  /**
   * Ask the brain for live CPU/RAM/GPU telemetry alongside the status. Off by
   * default and deliberately so: this costs an `nvidia-smi` spawn on the brain,
   * and the daemon's own liveness polling hits this route far more often than
   * any UI does. Only the Brain page's Overview
   * tab, which actually renders the numbers, turns it on.
   */
  resources?: boolean;
}

function statusPath(options?: BrainStatusOptions): string {
  return options?.resources ? "/__host/status?resources=1" : "/__host/status";
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
  private readonly onReachabilityChanged: (() => void) | null;
  private onStatusChanged: ((status: BrainHostStatus) => void) | null;
  private onLogLine: ((line: string) => void) | null;
  private onStatusEventSupportChanged: (() => void) | null;

  private child: ChildProcess | null = null;
  private managedProcessId: string | null = null;
  private startPromise: Promise<void> | null = null;
  /** True while the operator wants the brain running; false disables crash restarts. */
  private wantRunning = false;
  private desiredModel: string | null = null;
  /** "local": we spawn/supervise a child. "remote": we only probe another host. */
  private mode: "local" | "remote" = "local";
  /** The last-applied `brain.enabled`. False = the operator turned the host off. */
  private enabled = false;
  /** False until applySettings has run once; the brain block may not be loaded yet. */
  private settingsApplied = false;
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
  /** PID encoded in the latest local Brain service session-log filename. */
  private sessionLogPid: number | null = null;
  private restartCount = 0;
  private restartWindowStart = 0;
  /** Connection-pooling dispatcher for the otto-brain provider; see resolveProviderDispatcher. */
  private providerDispatcher: { signature: string; dispatcher: Agent } | null = null;

  // --- Status event subscription (see subscribeStatusEvents) ----------------
  /** The open SSE request, or null. Exactly one per configured brain, never per client. */
  private eventRequest: http.ClientRequest | null = null;
  /** Bumped on every reconcile so a late callback from a torn-down stream is ignored. */
  private eventGeneration = 0;
  private eventRetryTimer: NodeJS.Timeout | null = null;
  private eventRetryDelayMs = EVENT_RECONNECT_MIN_MS;
  /** Whether the currently selected brain advertises and serves the event stream. */
  private eventsSupported = false;
  private logEventsSupported = false;
  /** Serialized last published snapshot, so an identical one is not re-broadcast. */
  private lastPublishedStatus: string | null = null;
  private reconcilePending = false;
  private shuttingDown = false;

  constructor(options: BrainManagerOptions) {
    this.logger = options.logger.child({ module: "brain-manager" });
    this.managedProcesses = options.managedProcesses;
    this.ottoHome = options.ottoHome;
    this.onReachabilityChanged = options.onReachabilityChanged ?? null;
    this.onStatusChanged = options.onStatusChanged ?? null;
    this.onLogLine = options.onLogLine ?? null;
    this.onStatusEventSupportChanged = options.onStatusEventSupportChanged ?? null;
  }

  /**
   * Wire the status fan-out after construction, mirroring how the WebSocket
   * server late-wires the manager itself. Subscribing starts immediately: the
   * first reconcile establishes the stream (or discovers the brain is too old
   * for one) without waiting for a client to ask.
   */
  setStatusListeners(listeners: {
    onStatusChanged: (status: BrainHostStatus) => void;
    onLogLine?: (line: string) => void;
    onStatusEventSupportChanged: () => void;
  }): void {
    this.onStatusChanged = listeners.onStatusChanged;
    this.onLogLine = listeners.onLogLine ?? null;
    this.onStatusEventSupportChanged = listeners.onStatusEventSupportChanged;
    this.requestStatusStreamReconcile();
  }

  /**
   * Whether pushed status is actually available right now: this daemon
   * implements the adapter AND the brain it currently points at advertises
   * `capabilities.events`. This is what `server_info.features.brainStatusPush`
   * reports, and a client that reads false keeps its own status poll.
   */
  supportsStatusEvents(): boolean {
    return this.eventsSupported;
  }

  /** Whether the selected Brain can push individual log lines through its SSE stream. */
  supportsLogEvents(): boolean {
    return this.logEventsSupported;
  }

  /**
   * The `otto-brain` provider's connection, derived from the brain settings
   * alone. Synchronous by design: the provider resolves it on every request, so
   * a brain that was stopped a moment ago immediately reports unavailable
   * instead of waiting on a connection refusal.
   */
  getProviderEndpoint(): BrainProviderEndpoint {
    if (!this.settingsApplied) {
      return { state: "unavailable", reason: "Otto Brain settings have not loaded yet." };
    }
    if (this.mode === "remote") {
      if (!this.endpoint.probeHost) {
        return {
          state: "unavailable",
          reason:
            "No remote Otto Brain host is configured. Set one under Settings → Host → Otto Brain.",
        };
      }
      return this.readyEndpoint();
    }
    if (!this.enabled) {
      return {
        state: "unavailable",
        reason: "Otto Brain is turned off. Turn it on under Settings → Host → Otto Brain.",
      };
    }
    if (!this.isChildAlive()) {
      return {
        state: "unavailable",
        reason: "Otto Brain is not running. Start it under Settings → Host → Otto Brain.",
      };
    }
    return this.readyEndpoint();
  }

  private readyEndpoint(): BrainProviderEndpoint {
    const scheme = this.endpoint.secure ? "https" : "http";
    const host = this.endpoint.probeHost.includes(":")
      ? `[${this.endpoint.probeHost}]`
      : this.endpoint.probeHost;
    return {
      state: "ready",
      baseUrl: `${scheme}://${host}:${this.endpoint.port}/v1`,
      apiKey: this.endpoint.token,
      dispatcher: this.resolveProviderDispatcher(),
    };
  }

  /**
   * The undici dispatcher for the current endpoint's TLS trust, or null when
   * the default is right. Cached per endpoint signature: an Agent owns a
   * connection pool, so rebuilding one per request would leak sockets.
   */
  private resolveProviderDispatcher(): Dispatcher | null {
    if (!this.endpoint.secure) {
      return null;
    }
    const trust = this.endpoint.trust;
    if (trust.kind === "system") {
      // A chain-of-trust certificate verifies against the system store.
      return null;
    }
    const signature = `${this.endpoint.probeHost}:${this.endpoint.port}:${
      trust.kind === "pinned" ? `pinned:${trust.fingerprint}` : trust.kind
    }`;
    const cached = this.providerDispatcher;
    if (cached && cached.signature === signature) {
      return cached.dispatcher;
    }
    void cached?.dispatcher.close().catch(() => undefined);

    const host = this.endpoint.probeHost;
    const port = this.endpoint.port;
    const dispatcher =
      trust.kind === "pinned"
        ? new Agent({
            connect: (_options, callback) => {
              connectPinned(
                { host, port, fingerprint: trust.fingerprint, timeoutMs: HTTP_PROBE_TIMEOUT_MS },
                (error, socket) => {
                  if (error) {
                    callback(error, null);
                    return;
                  }
                  callback(null, socket as tls.TLSSocket);
                },
              );
            },
          })
        : // Loopback child: a certificate can never validate for 127.0.0.1 and
          // the traffic never leaves this machine.
          new Agent({ connect: { rejectUnauthorized: false } });
    this.providerDispatcher = { signature, dispatcher };
    return dispatcher;
  }

  private notifyReachabilityChanged(): void {
    try {
      this.onReachabilityChanged?.();
    } catch (error) {
      this.logger.warn({ err: error }, "Brain reachability listener failed");
    }
    // Every reachability change is also a status-subscription change: a brain
    // that just started needs a stream, one that stopped needs its stream torn
    // down and its "off" state published. One hook rather than a call at each
    // of the four lifecycle sites, so a new site cannot forget it.
    this.requestStatusStreamReconcile();
  }

  /**
   * Coalesce reconciles onto the next tick.
   *
   * One `applySettings` can raise the reachability signal more than once - it
   * stops a stale child and then applies the new endpoint - and each reconcile
   * costs a status read. Collapsing them means the settled intent is what gets
   * probed, not every intermediate step on the way to it.
   */
  private requestStatusStreamReconcile(): void {
    if (this.reconcilePending || this.shuttingDown) {
      return;
    }
    this.reconcilePending = true;
    const timer = setTimeout(() => {
      this.reconcilePending = false;
      void this.reconcileStatusStream();
    }, 0);
    timer.unref?.();
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
    try {
      await this.applySettingsInner(brain);
    } finally {
      // Every path through applySettings can change where (or whether) the
      // otto-brain provider can reach a host, including the failing ones.
      this.notifyReachabilityChanged();
    }
  }

  private async applySettingsInner(brain: MutableBrainConfig): Promise<void> {
    this.mode = brain.mode;
    this.enabled = brain.enabled;
    this.settingsApplied = true;

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
    this.notifyReachabilityChanged();
  }

  /** Stop then start again onto the given model. Keeps the running intent. */
  async restart(model?: string | null): Promise<void> {
    await this.stop();
    await this.ensureRunning(model);
  }

  /** For daemon teardown: kill the child so it never outlives the daemon. */
  async shutdown(): Promise<void> {
    await this.stop();
    // After stop(): its reachability notification would otherwise schedule a
    // retry we are about to stop honouring.
    this.shuttingDown = true;
    this.teardownEventStream();
    const dispatcher = this.providerDispatcher;
    this.providerDispatcher = null;
    await dispatcher?.dispatcher.close().catch(() => undefined);
  }

  /**
   * Live status: running requires both a live child AND a successful
   * GET /__host/status. The brain's status JSON (version/state/model/vram/
   * telemetry/scheduler/recent) is merged in; the schema is passthrough so the
   * brain can evolve those sub-objects without a protocol bump.
   */
  async status(options?: BrainStatusOptions): Promise<BrainHostStatus> {
    if (this.mode === "remote") {
      return this.remoteStatus(options);
    }
    const child = this.child;
    if (!child || !this.isChildAlive()) {
      return { running: false, reachable: false };
    }
    const pid = child.pid ?? null;
    const hostStatus = await this.fetchHostJson(statusPath(options));
    if (!hostStatus) {
      // Child is up but the host API is not answering yet (still binding or
      // loading a model). Report it as coming up rather than as running.
      return {
        running: false,
        reachable: false,
        pid,
        host: this.endpoint.probeHost,
        port: this.endpoint.port,
        secure: this.endpoint.secure,
        state: "starting",
        lastError: this.lastLogLine(),
      };
    }
    return this.mergeHostStatus(hostStatus, pid);
  }

  /**
   * Join the brain's own status body with the fields only the daemon knows.
   *
   * Shared by the polled read and the pushed snapshot so the two cannot drift:
   * a field the poll added and the push did not would be a field the UI lost
   * the moment the stream took over.
   */
  private mergeHostStatus(
    hostStatus: Record<string, unknown>,
    pid: number | null,
  ): BrainHostStatus {
    const merged: Record<string, unknown> = {
      host: this.endpoint.probeHost,
      port: this.endpoint.port,
      secure: this.endpoint.secure,
      ...hostStatus,
      running: true,
      // The brain answered, so by definition. Set after the spread: the brain
      // does not know whether the daemon can see it, only the daemon does.
      reachable: true,
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
  private async remoteStatus(options?: BrainStatusOptions): Promise<BrainHostStatus> {
    const endpointFields = {
      host: this.endpoint.probeHost,
      port: this.endpoint.port,
      secure: this.endpoint.secure,
    };
    if (!this.endpoint.probeHost) {
      return { running: false, reachable: false, ...endpointFields, state: "unconfigured" };
    }
    const hostStatus = await this.fetchHostJson(statusPath(options));
    if (!hostStatus) {
      return {
        running: false,
        // Configured and pointed somewhere, but nothing answered - which is a
        // different thing from a brain that is deliberately off, and the rail
        // shows it differently.
        reachable: false,
        ...endpointFields,
        state: "unreachable",
        lastError: "The remote brain did not answer.",
      };
    }
    return this.mergeHostStatus(hostStatus, null);
  }

  // --- Status event subscription -------------------------------------------
  /**
   * One subscription per configured brain, never one per connected client.
   *
   * The shape is deliberately: read the ordinary status once, decide from
   * `capabilities.events` whether this brain can stream, and only then open the
   * stream. That order is the compatibility contract - a brain too old to have
   * heard of events answers the first half exactly as it always did, and the
   * daemon simply never asks for the second half. Every daemon-owned lifecycle
   * transition (spawn, exit, stop, settings applied) re-enters here, so the
   * pre-connect states the brain itself cannot report are still published.
   *
   * A stream that drops is itself a reachability transition: the retry re-probes
   * and publishes whatever is actually true, which is either a brain that came
   * back or an unreachable one.
   */
  private async reconcileStatusStream(): Promise<void> {
    // No fan-out wired means nobody to publish to, and a subscription exists to
    // be fanned out. Mirrors the brain's own publisher, which samples only while
    // something is listening. `setStatusListeners` reconciles when that changes.
    if (this.shuttingDown || !this.onStatusChanged) {
      return;
    }
    const generation = ++this.eventGeneration;
    this.teardownEventStream();

    if (!this.isReachable()) {
      // Off, not configured, or no child: publish the daemon's own answer and
      // stop. A lifecycle event will bring us back, and it should get a fast
      // first attempt rather than inheriting the last outage's backoff.
      this.eventRetryDelayMs = EVENT_RECONNECT_MIN_MS;
      this.setEventsSupported(false);
      this.setLogEventsSupported(false);
      this.publishStatus(await this.statusSafely());
      return;
    }

    const status = await this.statusSafely();
    if (generation !== this.eventGeneration) {
      return;
    }
    this.publishStatus(status);

    const supported = status.reachable === true && status.capabilities?.events === true;
    this.setEventsSupported(supported);
    this.setLogEventsSupported(supported && status.capabilities?.logEvents === true);
    if (!supported) {
      // Either the brain is too old for events (nothing to retry - the client's
      // compatibility poll covers it, and a version change arrives as a restart)
      // or it did not answer at all (retry, so a brain that comes back is
      // noticed without anyone reloading anything).
      if (status.reachable !== true) {
        this.scheduleStatusStreamRetry();
      }
      return;
    }
    this.connectEventStream(generation);
  }

  /** `status()` never throws today; this keeps the reconcile loop safe if it ever does. */
  private async statusSafely(): Promise<BrainHostStatus> {
    try {
      return await this.status();
    } catch (error) {
      this.logger.warn({ err: error }, "Failed to read otto-brain status");
      return { running: false, reachable: false };
    }
  }

  /**
   * Open the SSE stream. Goes through `dispatchRequest` like every other brain
   * call, so the token, the TLS mode and the certificate pin are exactly the
   * ones the management API uses - the stream is not a second transport with
   * its own trust story.
   */
  private connectEventStream(generation: number): void {
    const request = this.dispatchRequest(
      {
        host: this.endpoint.probeHost,
        port: this.endpoint.port,
        path: "/__host/events",
        method: "GET",
        // Not a request timeout: this response never ends. It is an idle
        // timeout, and the brain's keepalive comments reset it.
        timeout: EVENT_STREAM_IDLE_TIMEOUT_MS,
        headers: {
          accept: "text/event-stream",
          ...(this.endpoint.token ? { "x-otto-brain-token": this.endpoint.token } : {}),
        },
      },
      (res) => {
        if (generation !== this.eventGeneration) {
          res.destroy();
          return;
        }
        if (res.statusCode !== 200) {
          // The brain advertised events and then refused to serve them. Treat it
          // as unsupported rather than retrying into a wall.
          res.resume();
          this.logger.warn(
            { status: res.statusCode },
            "otto-brain refused the status event stream",
          );
          this.setEventsSupported(false);
          this.setLogEventsSupported(false);
          return;
        }
        // A stream that opened is a healthy endpoint; the next drop starts its
        // backoff from the bottom rather than from wherever the last one ended.
        this.eventRetryDelayMs = EVENT_RECONNECT_MIN_MS;
        this.readEventStream(res, generation);
      },
    );
    request.on("timeout", () => request.destroy(new Error("the brain status stream went silent")));
    request.on("error", (error: Error) => {
      if (generation !== this.eventGeneration) {
        return;
      }
      this.logger.debug({ err: error }, "otto-brain status stream ended");
      this.eventRequest = null;
      this.scheduleStatusStreamRetry();
    });
    request.end();
    this.eventRequest = request;
  }

  /** Parse `event: status` frames and publish each complete snapshot. */
  private readEventStream(res: http.IncomingMessage, generation: number): void {
    let buffer = "";
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => {
      if (generation !== this.eventGeneration) {
        return;
      }
      buffer += chunk;
      if (buffer.length > MAX_EVENT_FRAME_BYTES) {
        this.logger.warn("otto-brain status stream sent an oversized frame; reconnecting");
        buffer = "";
        res.destroy();
        return;
      }
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        this.handleEventFrame(frame);
        boundary = buffer.indexOf("\n\n");
      }
    });
    const ended = () => {
      if (generation !== this.eventGeneration) {
        return;
      }
      this.eventRequest = null;
      this.scheduleStatusStreamRetry();
    };
    res.on("end", ended);
    res.on("close", ended);
    res.on("error", ended);
  }

  private handleEventFrame(frame: string): void {
    let event = "message";
    const data: string[] = [];
    for (const rawLine of frame.split("\n")) {
      const line = rawLine.replace(/\r$/u, "");
      // Comments (the keepalive) and unknown fields are ignored by contract.
      if (line.startsWith(":") || line.length === 0) {
        continue;
      }
      const separator = line.indexOf(":");
      const field = separator === -1 ? line : line.slice(0, separator);
      const value = separator === -1 ? "" : line.slice(separator + 1).replace(/^ /u, "");
      if (field === "event") {
        event = value;
      } else if (field === "data") {
        data.push(value);
      }
    }
    if (data.length === 0) {
      return;
    }
    if (event === "log") {
      try {
        const parsed = JSON.parse(data.join("\n"));
        if (isRecord(parsed) && typeof parsed.line === "string") this.onLogLine?.(parsed.line);
      } catch {
        this.logger.warn("otto-brain event stream sent an unparseable log line");
      }
      return;
    }
    if (event !== "status") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.join("\n"));
    } catch {
      this.logger.warn("otto-brain status stream sent an unparseable snapshot");
      return;
    }
    if (!isRecord(parsed)) {
      return;
    }
    const pid = this.mode === "remote" ? null : (this.child?.pid ?? null);
    this.publishStatus(this.mergeHostStatus(parsed, pid));
  }

  /**
   * Publish a snapshot to the daemon's fan-out, suppressing an identical repeat.
   *
   * The brain already coalesces its own state changes, but the daemon adds
   * fields of its own (pid, endpoint, reachability), and a reconcile that finds
   * nothing changed must not wake every connected client.
   */
  private publishStatus(status: BrainHostStatus): void {
    const serialized = JSON.stringify(status);
    if (serialized === this.lastPublishedStatus) {
      return;
    }
    this.lastPublishedStatus = serialized;
    try {
      this.onStatusChanged?.(status);
    } catch (error) {
      this.logger.warn({ err: error }, "Brain status listener failed");
    }
  }

  private setEventsSupported(supported: boolean): void {
    if (supported === this.eventsSupported) {
      return;
    }
    this.eventsSupported = supported;
    try {
      this.onStatusEventSupportChanged?.();
    } catch (error) {
      this.logger.warn({ err: error }, "Brain status-event support listener failed");
    }
  }

  private setLogEventsSupported(supported: boolean): void {
    if (supported === this.logEventsSupported) return;
    this.logEventsSupported = supported;
    try {
      this.onStatusEventSupportChanged?.();
    } catch (error) {
      this.logger.warn({ err: error }, "Brain log-event support listener failed");
    }
  }

  private scheduleStatusStreamRetry(): void {
    if (this.eventRetryTimer || this.shuttingDown) {
      return;
    }
    const delay = this.eventRetryDelayMs;
    this.eventRetryDelayMs = Math.min(delay * 2, EVENT_RECONNECT_MAX_MS);
    this.eventRetryTimer = setTimeout(() => {
      this.eventRetryTimer = null;
      void this.reconcileStatusStream();
    }, delay);
    this.eventRetryTimer.unref?.();
  }

  private teardownEventStream(): void {
    if (this.eventRetryTimer) {
      clearTimeout(this.eventRetryTimer);
      this.eventRetryTimer = null;
    }
    const request = this.eventRequest;
    this.eventRequest = null;
    request?.destroy();
  }

  /**
   * Detected model names, read from the brain's /v1/models when it is reachable
   * (local child up, or remote). Returns [] when unreachable - the client shows
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
   * when unreachable. Remote mode only - the local brain's config is the daemon's
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

  /** True only when this manager is configured to proxy another brain host. */
  isRemote(): boolean {
    return this.mode === "remote";
  }

  /** Ask a remote managed brain to exit cleanly so its owning daemon restarts it. */
  async remoteRestart(): Promise<Record<string, unknown> | null> {
    if (this.mode !== "remote") throw new Error("The brain is not configured in remote mode.");
    this.requireReachable();
    return this.requestHostJson("POST", "/__host/restart");
  }

  /**
   * Start a job owned by the selected Brain host. Unlike the legacy CLI shell-
   * out lane, this resolves through the host endpoint in both local and remote
   * modes, so the resident Supervisor owns the operation and its logs.
   */
  async hostJob(
    route: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    this.requireReachable();
    return this.requestHostJson("POST", `/__host/jobs/${route}`, body);
  }

  async hostJobs(): Promise<Record<string, unknown> | null> {
    this.requireReachable();
    return this.requestHostJson("GET", "/__host/jobs");
  }

  async cancelHostJob(jobId: string): Promise<Record<string, unknown> | null> {
    this.requireReachable();
    return this.requestHostJson("POST", "/__host/jobs/cancel", { jobId });
  }

  async remoteCatalog(): Promise<Record<string, unknown> | null> {
    if (this.mode !== "remote") throw new Error("The brain is not configured in remote mode.");
    this.requireReachable();
    return this.requestHostJson("GET", "/__host/catalog");
  }

  async remoteRead(pathname: string): Promise<Record<string, unknown> | null> {
    if (this.mode !== "remote") throw new Error("The brain is not configured in remote mode.");
    this.requireReachable();
    return this.requestHostJson("GET", pathname);
  }

  // --- Brain Console: the management API, proxied ---------------------------
  // Every method below is a straight proxy of the brain's own `/__host/*`, which
  // is the whole point: `this.endpoint` already resolves by mode, so a local
  // child and a remote host go down the same code path. Nothing here shells out
  // to the CLI, because that path cannot reach a remote brain at all.

  /** Local needs a live child; remote just needs a configured endpoint. */
  private isReachable(): boolean {
    return this.mode === "remote" ? Boolean(this.endpoint.probeHost) : this.isChildAlive();
  }

  /** Throw the one message the UI shows when the brain is not there to ask. */
  private requireReachable(): void {
    if (this.isReachable()) {
      return;
    }
    throw new Error(
      this.mode === "remote"
        ? "The remote brain is not configured or did not answer."
        : "The brain is not running on this host.",
    );
  }

  /** Build a `/__host/*` path with an encoded model id and optional extras. */
  private modelPath(route: string, modelId: string, extra?: Record<string, string>): string {
    const params = new URLSearchParams({ id: modelId, ...extra });
    return `${route}?${params.toString()}`;
  }

  /**
   * The joined model inventory (scan, metadata, profile, calibration, budget,
   * bench score) plus disk usage. One call feeds the whole Models tab.
   */
  async inventory(): Promise<Record<string, unknown> | null> {
    this.requireReachable();
    return this.requestHostJson("GET", "/__host/models");
  }

  /** Rebuild the host's in-memory inventory after a local daemon-side pull. */
  async rescanInventory(): Promise<void> {
    // Downloads are allowed before the Brain service has been started. There
    // is no in-memory catalog in that state, so the next service start scans
    // disk naturally; do not misreport a completed download as failed.
    if (!this.isReachable()) return;
    await this.requestHostJson("POST", "/__host/models/rescan");
  }

  /** One model's saved profile, its field descriptors, and its warnings. */
  async modelProfile(modelId: string): Promise<Record<string, unknown> | null> {
    this.requireReachable();
    return this.requestHostJson("GET", this.modelPath("/__host/model/profile", modelId));
  }

  /** Write the editable profile fields; returns the recomputed budget too. */
  async setModelProfile(
    modelId: string,
    patch: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    this.requireReachable();
    return this.requestHostJson("POST", this.modelPath("/__host/model/profile", modelId), patch);
  }

  /**
   * The VRAM budget for a hypothetical profile, so the UI can show it updating
   * as a field is scrubbed without persisting a value mid-drag.
   */
  async modelBudget(
    modelId: string,
    overrides?: Record<string, string>,
  ): Promise<Record<string, unknown> | null> {
    this.requireReachable();
    return this.requestHostJson("GET", this.modelPath("/__host/model/budget", modelId, overrides));
  }

  /**
   * Load a model into the running brain.
   *
   * This is not `ensureRunning`: that restarts the daemon's child process, which
   * a remote brain has no equivalent for. The brain swaps the model inside its
   * own supervisor, so the same call works against either.
   */
  async loadModel(modelId: string): Promise<Record<string, unknown> | null> {
    this.requireReachable();
    return this.requestHostJson("POST", this.modelPath("/__host/model/load", modelId));
  }

  /** Unload the resident model, leaving the brain up and serving nothing. */
  async unloadModel(): Promise<Record<string, unknown> | null> {
    this.requireReachable();
    return this.requestHostJson("POST", "/__host/model/unload");
  }

  /**
   * Rename a model's display name. The brain itself rejects a collision with
   * another model's current id/displayName.
   */
  async renameModel(modelId: string, displayName: string): Promise<Record<string, unknown> | null> {
    this.requireReachable();
    return this.requestHostJson("POST", this.modelPath("/__host/model/rename", modelId), {
      displayName,
    });
  }

  /** Reset a model's display name back to its scan-derived default. */
  async resetModelName(modelId: string): Promise<Record<string, unknown> | null> {
    this.requireReachable();
    return this.requestHostJson("POST", this.modelPath("/__host/model/rename/reset", modelId));
  }

  /** Delete a model's files. The brain refuses while that model is loaded. */
  async deleteModel(modelId: string): Promise<Record<string, unknown> | null> {
    this.requireReachable();
    return this.requestHostJson("DELETE", this.modelPath("/__host/model", modelId));
  }

  async deleteModelComponent(
    modelId: string,
    componentId: string,
  ): Promise<Record<string, unknown> | null> {
    this.requireReachable();
    return this.requestHostJson(
      "DELETE",
      `${this.modelPath("/__host/model/component", modelId)}&component=${encodeURIComponent(componentId)}`,
    );
  }

  /** Tail the current Brain service log. */
  async hostLogs(limit?: number | null): Promise<Record<string, unknown> | null> {
    // A pre-bind failure has already created and finalized its session log, but
    // no host API exists to serve it. The daemon owns that foreground child and
    // its OTTO_HOME, so it can keep the Logs surface pointed at the same file
    // rather than falling back to the old outer `otto-brain.log`.
    if (!this.isReachable()) {
      const terminalLog = this.localTerminalSessionLog(limit);
      if (terminalLog) return terminalLog;
    }
    this.requireReachable();
    const query = limit && limit > 0 ? `?limit=${Math.floor(limit)}` : "";
    return this.requestHostJson("GET", `/__host/logs${query}`);
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

    this.sessionLogPid = child.pid ?? null;
    let stdoutRemainder = "";
    let stderrRemainder = "";
    const capture = (stream: "stdout" | "stderr", chunk: Buffer) => {
      const text = chunk.toString("utf8");
      this.appendLog(text);
      const pending = stream === "stdout" ? stdoutRemainder : stderrRemainder;
      const parts = `${pending}${text}`.split(/\r?\n/u);
      const remainder = parts.pop() ?? "";
      if (stream === "stdout") stdoutRemainder = remainder;
      else stderrRemainder = remainder;
      for (const line of parts) this.forwardChildSessionLogLine(line);
    };
    const flushCapture = () => {
      this.forwardChildSessionLogLine(stdoutRemainder);
      this.forwardChildSessionLogLine(stderrRemainder);
      stdoutRemainder = "";
      stderrRemainder = "";
    };
    child.stdout?.on("data", (chunk: Buffer) => capture("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => capture("stderr", chunk));
    child.on("error", (error) => {
      this.appendLog(`[spawn error] ${error.message}\n`);
    });
    child.on("exit", (code, signal) => {
      flushCapture();
      this.handleChildExit(child, code, signal);
    });

    await this.recordManagedProcess(child, binPath, args);

    try {
      await this.waitForHealthy(child);
      this.logger.info(
        { pid: child.pid, port: this.endpoint.port, model },
        "otto-brain host is ready",
      );
      this.notifyReachabilityChanged();
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
    this.notifyReachabilityChanged();
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
    const existingRuntime = isRecord(existing.runtime) ? existing.runtime : {};

    const next: Record<string, unknown> = {
      ...existing,
      version: typeof existing.version === "number" ? existing.version : 1,
      enabled: brain.enabled,
      autoStart: brain.autoStart,
      listen: { ...existingListen, host: brain.listen.host, port: brain.listen.port },
      defaultModel: brain.defaultModel,
      runtime: { ...existingRuntime, ...(isRecord(brain.runtime) ? brain.runtime : {}) },
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
        // Node's default rejectUnauthorized: true - full chain + hostname checks.
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
    return this.requestHostJson("POST", pathname, body);
  }

  /**
   * A management-API call that reports WHY it failed.
   *
   * `fetchHostJson` deliberately swallows every failure into `null`, which is
   * right for a liveness probe and wrong for an operator action: "could not
   * delete the model" with no reason is not a usable error message. This one
   * rejects with the brain's own message, including the 403 a write gate
   * produces when remote configuration is switched off.
   */
  private requestHostJson(
    method: "GET" | "POST" | "DELETE",
    pathname: string,
    body?: unknown,
  ): Promise<Record<string, unknown> | null> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (!settled) {
          settled = true;
          fn();
        }
      };
      const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
      const options: http.RequestOptions = {
        host: this.endpoint.probeHost,
        port: this.endpoint.port,
        path: pathname,
        method,
        // A load can start a model and an inventory read walks GGUF headers, so
        // these get the write timeout rather than the 2s liveness one.
        timeout: CONFIG_WRITE_TIMEOUT_MS,
        headers: {
          ...(payload
            ? {
                "content-type": "application/json",
                "content-length": String(payload.length),
              }
            : {}),
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
      if (payload) {
        request.write(payload);
      }
      request.end();
    });
  }

  private lastLogLine(): string | null {
    return this.log.length > 0 ? this.log[this.log.length - 1] : null;
  }

  /**
   * Relay durable session entries written before `/__host/events` can exist.
   * Once the host's SSE stream is live it is the sole source, preventing every
   * normal lifecycle line from being sent twice.
   */
  private forwardChildSessionLogLine(rawLine: string): void {
    const line = rawLine.trim();
    if (!BRAIN_SESSION_LOG_LINE.test(line) || this.supportsLogEvents()) return;
    try {
      this.onLogLine?.(line);
    } catch (error) {
      this.logger.warn({ err: error }, "Brain child log listener failed");
    }
  }

  /** Read the latest local child session after a terminal startup outcome. */
  private localTerminalSessionLog(limit?: number | null): Record<string, unknown> | null {
    if (this.mode === "remote" || this.sessionLogPid === null) return null;
    const logsDir = path.join(this.ottoHome, "otto-brain", "logs");
    const suffix = `-${this.sessionLogPid}${BRAIN_RUN_LOG_SUFFIX}`;
    let file: string | null = null;
    try {
      file = readdirSync(logsDir).find((entry) => entry.endsWith(suffix)) ?? null;
    } catch {
      return null;
    }
    if (!file) return null;
    try {
      const lines = readFileSync(path.join(logsDir, file), "utf8").split(/\r?\n/u).filter(Boolean);
      const count = limit && limit > 0 ? Math.floor(limit) : lines.length;
      return {
        lines: lines.slice(-count),
        total: lines.length,
        state: this.wantRunning ? "failed" : "stopped",
        command: null,
      };
    } catch {
      return null;
    }
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
    if (isRecord(parsed)) {
      // Two shapes in the wild: the flat `{error: "..."}` the config write
      // returns, and the Anthropic-shaped `{error: {type, message}}` envelope
      // the management API uses (so clients parse one error format across both
      // the completion proxy and /__host/*). Without the nested case, a 403 from
      // a write gate reads as a bare status code and the operator never learns
      // that remote configuration is simply switched off.
      if (typeof parsed.error === "string") {
        return `the remote brain returned ${status}: ${parsed.error}`;
      }
      if (isRecord(parsed.error) && typeof parsed.error.message === "string") {
        return `the remote brain returned ${status}: ${parsed.error.message}`;
      }
    }
  } catch {
    // Not JSON; fall through to the bare status.
  }
  return `the remote brain returned ${status}`;
}

export function structuralSignature(brain: MutableBrainConfig): string {
  return JSON.stringify({
    listen: brain.listen,
    tls: brain.tls,
    authMode: brain.authMode,
    authToken: brain.authToken,
    defaultModel: brain.defaultModel,
    lockModel: brain.lockModel,
    // llama-server resolves its executable from this at launch. Leaving it out
    // lets the config point at one runtime while the still-running host locks
    // another, making a later cleanup fail on Windows.
    runtime: brain.runtime,
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
