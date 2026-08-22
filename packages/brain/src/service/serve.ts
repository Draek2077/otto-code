/**
 * The headless brain service: the router + supervisor bound to a port, with the
 * VRAM fit, on-demand model switching, remote auth, built-in TLS, and pid-file
 * lifecycle. Used both by `otto brain serve` (foreground) and by a detached
 * `otto brain start`. It stays provider-neutral about the runtime source - it
 * takes whatever resolveRuntime picks (managed or LM Studio).
 *
 * TLS is served in-process (config.tls): HTTPS with a files / self-signed /
 * tailscale certificate, hot-swapped on renewal. This is what lets the brain be
 * exposed securely over a network with no relay in front of it.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";

import {
  getCalibrationForBudget,
  forModel,
  loadPersistedConfig,
  loadProfilesStore,
  put,
  putCalibration,
  saveBrainConfig,
  saveProfilesStore,
} from "../config/index.js";
import { resolveBrainPaths } from "../config/paths.js";
import type { BrainConfig } from "../config/schema.js";
import { query as queryGpu } from "../gpu.js";
import { managedModelsDir, pickAutoModel, pickModel, scanModels } from "../models/index.js";
import { CommandError } from "../output/types.js";
import { resolveRuntime } from "../runtime/index.js";
import type { Model } from "../types.js";
import * as vram from "../vram.js";
import { resolveVersion } from "../version.js";
import * as results from "../ops/results.js";
import * as archive from "../ops/archive.js";
import { calibrate } from "../ops/calibrate.js";
import { sweep } from "../ops/sweep.js";
import * as bench from "../bench/index.js";
import { createCpuSampler, sample as sampleSystem, slots as sampleSlots } from "../sysmon.js";
import { createHostApi, type HostJob, type HostJobRunner } from "./host-api.js";
import { errorMessage } from "./http-util.js";
import { createRouter, createSlotEraser, Telemetry } from "./router.js";
import { Scheduler, type ModelScheduler } from "./scheduler.js";
import { ModelProcessPool } from "./process-pool.js";
import { BrainLogPublisher, BrainStatusPublisher } from "./status-events.js";
import { Supervisor } from "./supervisor.js";
import * as tailscale from "./tailscale.js";
import { CertManager, resolveTlsOptions, type SecurePair } from "./tls.js";
import { removePidFile, writePidFile } from "./pid-lock.js";
import { createBrainRunLog } from "./run-log.js";
import { formatBrainLog, type BrainLogArea } from "./log-format.js";

/** The effective config with secrets masked, for the `/__host/config` read. */
function redactConfig(config: BrainConfig): BrainConfig {
  return {
    ...config,
    auth: { ...config.auth, token: config.auth.token ? "********" : null },
    // The Hugging Face token is the owner's account credential - never echo it to
    // a caller of /__host/config (read is allowed by default on a shared brain).
    ...(config.hfToken ? { hfToken: "********" } : {}),
  };
}

/** Benchmark rankings + per-config variance + best-per-config, for `/__host/evals`. */
function collectEvals(): unknown {
  try {
    const all = results.loadAll();
    return {
      rankings: results.rankModels(all),
      latest: results.latestPerConfig(all),
      variance: results.variance(all),
      runCount: all.length,
    };
  } catch {
    return { rankings: [], latest: [], variance: [], runCount: 0 };
  }
}

const REMOTE_JOB_RETENTION_MS = 5 * 60_000;

/**
 * Runs a benchmark as a child of the brain service. This is intentionally here
 * rather than in the connecting daemon: its process, model store, results
 * directory and GPU all belong to the host that is being benchmarked.
 */
interface ResidentJobUpdate {
  message: (value: string) => void;
  percent: (value: number | null) => void;
}

type ResidentJobRunner = (
  supervisor: Supervisor,
  kind: "calibrate" | "sweep" | "bench",
  target: string | null,
  update: ResidentJobUpdate,
  signal: AbortSignal,
) => Promise<void>;

type ServiceJob = HostJob & {
  child: ChildProcess | null;
  controller: AbortController | null;
  pull?: {
    entryKey: string;
    components: Set<string>;
    queue: { args: string[]; components: string[] }[];
  };
};

/** Model pulls only write the model store, so independent entries can transfer together. */
export function canRunAlongsideModelPull(kind: HostJob["kind"]): boolean {
  return kind === "pull" || kind === "runtime-remove";
}

export function componentOnlyArgs(args: string[], components: string[]): string[] {
  const separator = args.lastIndexOf("--");
  const beforeTarget = separator === -1 ? args : args.slice(0, separator);
  const target = separator === -1 ? [] : args.slice(separator);
  const base: string[] = [];
  for (let index = 0; index < beforeTarget.length; index += 1) {
    const arg = beforeTarget[index];
    if (arg === "--primary-only") continue;
    if (arg === "--component") {
      index += 1;
      continue;
    }
    base.push(arg);
  }
  return [
    ...base,
    "--components-only",
    ...components.flatMap((component) => ["--component", component]),
    ...target,
  ];
}

class ServiceJobRunner implements HostJobRunner {
  private readonly jobs = new Map<string, ServiceJob>();

  constructor(
    private readonly onPullCompleted: () => void,
    private readonly runResidentJob: ResidentJobRunner,
    private readonly scheduler: ModelScheduler<Supervisor>,
    private readonly resolveTarget: (target: string | null) => Model | null,
    private readonly log: (area: BrainLogArea, line: string) => void,
  ) {}

  private area(kind: HostJob["kind"]): BrainLogArea {
    return kind === "pull" || kind === "runtime-install" || kind === "runtime-remove"
      ? "library"
      : "model";
  }

  start(
    kind: HostJob["kind"],
    target: string | null,
    args: string[],
    pull?: { entryKey: string; components: string[] },
  ): HostJob {
    if (kind === "pull" && pull) {
      const existing = [...this.jobs.values()].find(
        (job) =>
          job.kind === "pull" && job.status === "running" && job.pull?.entryKey === pull.entryKey,
      );
      if (existing?.pull) {
        const components = pull.components.filter(
          (component) => !existing.pull!.components.has(component),
        );
        if (components.length > 0) {
          for (const component of components) existing.pull.components.add(component);
          existing.pull.queue.push({ args: componentOnlyArgs(args, components), components });
          existing.message = `Queued ${components.join(", ")}…`;
          this.log(
            "library",
            `job ${existing.id} queued bundle components: ${components.join(", ")}`,
          );
        }
        return this.publicJob(existing);
      }
    }

    const isResidentOperation = kind === "calibrate" || kind === "sweep" || kind === "bench";
    const running = [...this.jobs.values()].find((job) => job.status === "running");
    const activeNonDownload = [...this.jobs.values()].find(
      (job) => job.status === "running" && job.kind !== "pull",
    );
    // Resident operations join Scheduler instead of rejecting one another. It
    // owns their turn order with API requests and performs every model swap.
    const conflict = isResidentOperation
      ? undefined
      : canRunAlongsideModelPull(kind)
        ? activeNonDownload
        : running;
    if (conflict) throw new Error(`Another operation is already running (${conflict.label}).`);
    const residentTarget = isResidentOperation ? this.resolveTarget(target) : null;
    if (isResidentOperation && !residentTarget) {
      throw new Error("No installed model is available for this operation.");
    }
    const job: ServiceJob = {
      id: `brainjob_${randomUUID()}`,
      kind,
      label:
        kind === "bench"
          ? target
            ? `Benchmark ${target}`
            : "Benchmark models"
          : `${kind} ${target ?? ""}`.trim(),
      target,
      status: "running",
      percent: null,
      message: null,
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      child: null,
      controller: null,
      ...(kind === "pull" && pull
        ? {
            pull: {
              entryKey: pull.entryKey,
              components: new Set(pull.components),
              queue: [],
            },
          }
        : {}),
    };
    this.jobs.set(job.id, job);
    this.log(this.area(job.kind), `job ${job.id} started: ${job.label}`);

    if (kind === "calibrate" || kind === "sweep" || kind === "bench") {
      const model = residentTarget!;
      const controller = new AbortController();
      job.controller = controller;
      job.queuePosition = this.scheduler.stats().queued + 1;
      job.message = `Queued for ${model.displayName}`;
      void this.scheduler
        .submit(
          model,
          (supervisor) =>
            controller.signal.aborted
              ? Promise.reject(new Error("Operation canceled."))
              : this.runResidentJob(
                  supervisor,
                  kind,
                  model.id,
                  {
                    message: (value) => {
                      if (job.status === "running") job.message = value.slice(-1000);
                    },
                    percent: (value) => {
                      if (job.status === "running") job.percent = value;
                    },
                  },
                  controller.signal,
                ),
          {
            kind: kind === "bench" ? "benchmark" : kind,
            onStart: () => {
              job.queuePosition = null;
              job.message = `${job.label} started`;
            },
          },
        )
        .then(() => this.finish(job, "succeeded", null))
        .catch((error: unknown) =>
          this.finish(job, controller.signal.aborted ? "canceled" : "failed", errorMessage(error)),
        );
      return this.publicJob(job);
    }

    // The service is launched by the same CLI entry point as `otto-brain bench`.
    // Reusing that entry point keeps its config/path resolution on this host.
    const entry = process.argv[1];
    if (!entry) throw new Error("The brain service has no CLI entry point.");
    this.startChild(job, args, entry);
    return this.publicJob(job);
  }

  private startChild(job: ServiceJob, args: string[], entry: string): void {
    const child = spawn(process.execPath, [entry, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    job.child = child;
    this.log(
      this.area(job.kind),
      `job ${job.id} spawned pid ${child.pid ?? "unknown"}: ${args.join(" ")}`,
    );
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.ingestOutput(job, "stdout", chunk));
    child.stderr?.on("data", (chunk: string) => this.ingestOutput(job, "stderr", chunk));
    child.once("error", (error) => this.finish(job, "failed", error.message));
    child.once("close", (code) => {
      if (job.status !== "running") return;
      job.child = null;
      if (code === 0 && job.kind === "pull" && job.pull) {
        const next = job.pull.queue.shift();
        if (next) {
          job.message = `Queued ${next.components.join(", ")}…`;
          this.startChild(job, next.args, entry);
          return;
        }
      }
      if (code === 0 && job.kind === "pull") {
        try {
          // Downloads happen in a child process, but inventory is served from
          // this process's in-memory scan. Reconcile before reporting success
          // so a newly downloaded bundle component is immediately available.
          this.onPullCompleted();
        } catch (error) {
          this.finish(
            job,
            "failed",
            `Downloaded files, but could not refresh inventory: ${errorMessage(error)}`,
          );
          return;
        }
      }
      this.finish(
        job,
        code === 0 ? "succeeded" : "failed",
        code === 0 ? null : (job.message ?? `Exited with code ${code}.`),
      );
    });
  }

  async query(args: string[], area: BrainLogArea = "library"): Promise<unknown> {
    const entry = process.argv[1];
    if (!entry) throw new Error("The brain service has no CLI entry point.");
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [entry, ...args], {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let out = "";
      let err = "";
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      this.log(area, `query started: ${args.join(" ")}`);
      child.stdout?.on("data", (chunk: string) => {
        out += chunk;
        this.logOutput(area, "query stdout", chunk);
      });
      child.stderr?.on("data", (chunk: string) => {
        err += chunk;
        this.logOutput(area, "query stderr", chunk);
      });
      child.once("error", (error) => {
        this.log(area, `query failed to start: ${error.message}`);
        reject(error);
      });
      child.once("close", (code) => {
        this.log(area, `query exited with code ${code}`);
        if (code !== 0) return reject(new Error(err.trim() || `Exited with code ${code}.`));
        try {
          resolve(JSON.parse(out));
        } catch {
          reject(new Error("The brain command returned invalid JSON."));
        }
      });
    });
  }

  list(): HostJob[] {
    const cutoff = Date.now() - REMOTE_JOB_RETENTION_MS;
    for (const [id, job] of this.jobs) {
      if (job.finishedAt && Date.parse(job.finishedAt) < cutoff) this.jobs.delete(id);
    }
    return [...this.jobs.values()]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map((job) => this.publicJob(job));
  }

  async cancel(jobId: string): Promise<HostJob[]> {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "running") return this.list();
    if (!job.child) {
      job.controller?.abort();
      this.finish(job, "canceled", "Canceled.");
      return this.list();
    }
    const child = job.child;
    if (process.platform === "win32" && child.pid) {
      await new Promise<void>((resolve) =>
        execFile("taskkill", ["/pid", String(child.pid), "/t", "/f"], () => resolve()),
      );
    } else {
      child.kill("SIGTERM");
    }
    this.log(this.area(job.kind), `canceling job ${job.id}`);
    this.finish(job, "canceled", "Canceled.");
    return this.list();
  }

  private ingestOutput(job: ServiceJob, source: "stdout" | "stderr", chunk: string): void {
    for (const line of chunk
      .split(/[\r\n]+/u)
      .map((value) => value.trim())
      .filter(Boolean)) {
      const progress = /(\d{1,3})\s*%/u.exec(line);
      if (progress) job.percent = Math.max(0, Math.min(100, Number(progress[1])));
      this.log(this.area(job.kind), `job ${job.id} ${source}: ${line}`);
      // The final JSON result is not a useful status label. Keep progress and
      // actionable text instead, so a failed bundle pull tells the user why.
      if (line !== "[" && !/^[\]{}",]+$/u.test(line)) job.message = line.slice(-1000);
    }
  }

  private finish(job: ServiceJob, status: HostJob["status"], error: string | null): void {
    if (job.status !== "running") return;
    job.child = null;
    job.controller = null;
    job.status = status;
    job.error = error;
    job.finishedAt = new Date().toISOString();
    if (status === "succeeded") job.percent = 100;
    this.log(this.area(job.kind), `job ${job.id} ${status}${error ? `: ${error}` : ""}`);
  }

  private logOutput(area: BrainLogArea, source: string, chunk: string): void {
    for (const line of chunk
      .split(/[\r\n]+/u)
      .map((entry) => entry.trim())
      .filter(Boolean)) {
      this.log(area, `${source}: ${line}`);
    }
  }

  private publicJob({
    child: _child,
    controller: _controller,
    pull: _pull,
    ...job
  }: ServiceJob): HostJob {
    return job;
  }
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

/**
 * Pull the client's presented key from the request. Accepts, in order, an
 * `Authorization: Bearer …`, an `x-api-key` (OpenAI/Anthropic convention, and
 * what the relay accepted), or the brain's own `x-otto-brain-token`.
 */
export function extractToken(req: http.IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) return auth.slice(7).trim();
  const apiKey = req.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey) return apiKey;
  const header = req.headers["x-otto-brain-token"];
  return typeof header === "string" ? header : null;
}

/**
 * The one derivation of the effective auth token. `mode: "token"` with a null or
 * empty token is NO auth - the bind guard and withAuth both read this, so they
 * cannot disagree (a mode-only guard once let mode=token + token=null bind
 * non-loopback and then serve every route ungated).
 */
export function effectiveAuthToken(config: BrainConfig): string | null {
  return config.auth.mode === "token" && config.auth.token ? config.auth.token : null;
}

/** Gate the router with a bearer token when configured; /health stays open. */
function withAuth(inner: http.RequestListener, token: string | null): http.RequestListener {
  if (!token) return inner;
  return (req, res) => {
    if (req.url !== "/health" && extractToken(req) !== token) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    inner(req, res);
  };
}

export interface StartServiceOptions {
  config: BrainConfig;
  modelNeedle?: string;
  env?: NodeJS.ProcessEnv;
  onLog?: (line: string) => void;
}

export interface ServiceHandle {
  server: http.Server;
  supervisor: Supervisor;
  host: string;
  port: number;
  /** The model loaded during startup, if one was available. */
  model: Model | null;
  /** Whether the listener terminates TLS (config.tls.mode !== "off"). */
  secure: boolean;
  /** The address to show a user: the MagicDNS/cert hostname when TLS is on, else the bind host. */
  displayHost: string;
  stop: () => Promise<void>;
}

export async function startService({
  config,
  modelNeedle,
  env = process.env,
  onLog = () => {},
}: StartServiceOptions): Promise<ServiceHandle> {
  const runLog = createBrainRunLog(env);
  const logEvents = new BrainLogPublisher();
  const log = (area: BrainLogArea, message: string): void => {
    const line = formatBrainLog(area, message);
    for (const entry of runLog.write(line)) {
      logEvents.publish(entry);
      // The daemon also captures this foreground child's stderr before the
      // management listener exists. Give it the exact durable entry, rather
      // than a second un-timestamped rendering of the same event.
      onLog(entry);
    }
  };
  // The management API must be useful before any setup exists: the Brain page
  // is where the owner downloads both a runtime and their first model. Keep the
  // listener up without either; loadModel reports the missing prerequisite.
  const runtime = resolveRuntime(config, env);

  const paths = resolveBrainPaths(env);
  const tlsOptions = await resolveTlsOptions(config, paths);

  // `listen.host: "tailscale"` binds the tailnet interface only (invisible to the
  // LAN and the internet), mirroring the relay's default. Any other value binds
  // verbatim. The cert hostname is what a client actually connects to.
  const port = config.listen.port;
  const bindHost =
    config.listen.host === "tailscale"
      ? await tailscale.ipv4(config.tls.tailscaleExe ?? undefined)
      : config.listen.host;
  const displayHost = tlsOptions?.hostname ?? bindHost;

  // Auth is orthogonal to transport: TLS encrypts the pipe, a token authorizes the
  // caller. A non-loopback bind still needs an actual token even over HTTPS -
  // gate on the token itself, not auth.mode, or mode=token with no token binds open.
  const authToken = effectiveAuthToken(config);
  if (
    !isLoopback(bindHost) &&
    !authToken &&
    !config.allowInsecureBind &&
    env.OTTO_BRAIN_ALLOW_INSECURE !== "1"
  ) {
    throw new CommandError({
      code: "INSECURE_BIND",
      message: `refusing to bind ${bindHost} without auth`,
      details:
        "set auth.mode=token with a non-empty auth.token, or allowInsecureBind=true for an " +
        "open trusted-network share (or OTTO_BRAIN_ALLOW_INSECURE=1 to override)",
    });
  }

  // `allowRemoteConfig` exists to gate NETWORK control (see its schema comment:
  // "a brain is not remotely controllable until its owner opts in") - it is not
  // meant to lock out the only caller that can ever reach a loopback-bound
  // brain, which is the local daemon that spawned it. When nothing off-machine
  // could possibly be a caller, config writes are always allowed; the flag only
  // starts to matter once the bind is actually reachable from elsewhere.
  const allowWrite = () => isLoopback(bindHost) || config.allowRemoteConfig;

  const store = loadProfilesStore(paths);
  // Not const: deleting a model through the management API re-scans and replaces
  // this, and every reader goes through a getter so nobody holds a stale array.
  let catalog = scanModels(config, env);
  const rescanCatalog = (): Model[] => {
    catalog = scanModels(config, env);
    return catalog;
  };
  const needle = modelNeedle ?? config.defaultModel ?? store.lastModelId ?? undefined;
  let model: Model | null = null;
  if (catalog.length > 0) {
    try {
      model = needle ? pickModel(catalog, needle) : pickAutoModel(catalog);
    } catch (error) {
      // A removed default or last-used model must not take the management
      // service down. An explicit CLI selection remains an actionable error.
      if (modelNeedle) throw error;
      log(
        "server",
        `note: ${error instanceof Error ? error.message : "configured model is unavailable"}`,
      );
    }
  }
  let profile = model ? forModel(store, model, config.defaults) : null;

  const gpu = await queryGpu();
  if (gpu && model && profile) {
    const fit = vram.fitToBudget({
      model,
      profile,
      calibration: getCalibrationForBudget(store, model, profile),
      totalVramBytes: gpu.totalBytes,
    });
    if (!fit.adjusted && !fit.budget.fits) {
      // Starting the host is what exposes the Library and model profile UI.
      // An automatic startup candidate that cannot load must therefore leave
      // the host alive and unloaded, not make the only recovery surface vanish.
      log(
        "model",
        `note: not loading ${model.displayName}: ${fit.reason ?? "does not fit in available VRAM"}`,
      );
      model = null;
      profile = null;
    } else {
      if (fit.adjusted && fit.reason) log("model", `note: ${fit.reason}`);
      profile = fit.profile;
    }
  }

  const telemetry = new Telemetry();
  const supervisor = new Supervisor({
    runtime,
    paths,
    getProfilesStore: () => store,
    logVerbosity: config.runtime.logVerbosity,
  });
  supervisor.on("log", (line: string) => log("server", line));
  supervisor.on("crashed", (error: string) => log("model", `FATAL ${error}`));

  const loadModelInto = async (
    resident: Supervisor,
    target: Model,
    reservedElsewhereBytes: number,
  ): Promise<number> => {
    // A runtime can be installed from the Library tab after this service starts.
    // Resolve it at load time so the user does not have to restart the brain.
    resident.runtime = resolveRuntime(config, env);
    if (!resident.runtime) {
      throw new Error("no llama.cpp runtime available; install one from the Library tab");
    }
    const gpuInfo = await queryGpu();
    let fitProfile = forModel(store, target, config.defaults);
    let reservationBytes = 0;
    if (gpuInfo) {
      const fit = vram.fitToBudget({
        model: target,
        profile: fitProfile,
        calibration: getCalibrationForBudget(store, target, fitProfile),
        // Every resident process keeps its complete budget reserved. Fit this
        // process against the capacity left after those independent allocations.
        totalVramBytes: Math.max(0, gpuInfo.totalBytes - reservedElsewhereBytes),
      });
      if (!fit.adjusted && !fit.budget.fits) throw new Error(fit.reason ?? "does not fit");
      fitProfile = fit.profile;
      reservationBytes = fit.budget.totalBytes;
    }
    await resident.start(target, fitProfile);
    delete store.pendingReloadModelIds[target.id];
    store.lastModelId = target.id;
    saveProfilesStore(store, paths);
    return reservationBytes;
  };
  let processPool: ModelProcessPool | null = null;
  const loadModel = async (target: Model): Promise<void> => {
    if (processPool) {
      await processPool.preload(target);
      return;
    }
    await loadModelInto(supervisor, target, 0);
  };

  // Apply an editable config patch from POST /__host/config: mutate the live
  // config (so the lock/default getters and future starts see it), persist it to
  // config.json without baking in env overrides, and hot-switch the model when a
  // new default is named. Network/TLS/auth are host-owned and not accepted here.
  const applyConfigPatch = async (patch: unknown): Promise<BrainConfig> => {
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
      throw new Error("config patch must be an object");
    }
    const p = patch as Record<string, unknown>;
    let switchTo: string | null = null;
    if ("defaultModel" in p) {
      const next = p.defaultModel;
      if (next !== null && typeof next !== "string") {
        throw new Error("defaultModel must be a string or null");
      }
      if ((next ?? null) !== config.defaultModel) switchTo = next ?? null;
      config.defaultModel = next ?? null;
    }
    if ("lockModel" in p) {
      if (typeof p.lockModel !== "boolean") throw new Error("lockModel must be a boolean");
      config.lockModel = p.lockModel;
    }
    if ("maxLoadedModels" in p) {
      const next = p.maxLoadedModels;
      if (!Number.isInteger(next) || (next as number) < 1 || (next as number) > 16) {
        throw new Error("maxLoadedModels must be an integer from 1 to 16");
      }
      config.maxLoadedModels = next as number;
    }
    if ("lockedModels" in p) {
      const next = p.lockedModels;
      if (!Array.isArray(next) || !next.every((value) => typeof value === "string")) {
        throw new Error("lockedModels must be an array of model ids");
      }
      config.lockedModels = [...new Set(next)].slice(0, config.maxLoadedModels);
    }
    if (config.lockedModels.length > config.maxLoadedModels) {
      config.lockedModels = config.lockedModels.slice(0, config.maxLoadedModels);
    }
    const persisted = loadPersistedConfig(paths);
    persisted.defaultModel = config.defaultModel;
    persisted.lockModel = config.lockModel;
    persisted.maxLoadedModels = config.maxLoadedModels;
    persisted.lockedModels = config.lockedModels;
    saveBrainConfig(persisted, paths);
    await processPool?.configure(config.maxLoadedModels);
    if (switchTo) {
      const target = catalog.find((m) => m.displayName === switchTo || m.id === switchTo);
      if (target) await loadModel(target);
    }
    if (config.lockModel) {
      for (const id of config.lockedModels) {
        const target = catalog.find(
          (candidate) => candidate.id === id || candidate.displayName === id,
        );
        if (target) await loadModel(target);
      }
    }
    return redactConfig(config);
  };

  // One CPU sampler for the lifetime of the service: it reports a busy fraction
  // between successive calls, so a fresh one per request would always return null.
  const cpuSampler = createCpuSampler();

  // Constructed here, ahead of both consumers, because the router installs the
  // snapshot builder into it and the management API serves it at
  // /__host/events. One instance, so `capabilities.events` and the stream can
  // never disagree about whether this brain publishes.
  const statusEvents = new BrainStatusPublisher();
  const runResidentJob: ResidentJobRunner = async (supervisor, kind, target, update, signal) => {
    const ensureActive = (): void => {
      if (signal.aborted) throw new Error("Operation canceled.");
    };
    const modelId = target ?? supervisor.model?.id ?? store.lastModelId ?? null;
    const targetModel = modelId
      ? catalog.find((candidate) => candidate.id === modelId || candidate.displayName === modelId)
      : null;
    if (!targetModel) throw new Error("No installed model is available for this operation.");

    if (kind === "calibrate") {
      const runtime = supervisor.runtime ?? resolveRuntime(config, env);
      if (!runtime)
        throw new Error("no llama.cpp runtime available; install one from the Library tab");
      const profile = forModel(store, targetModel, config.defaults);
      update.message(`Calibrating ${targetModel.displayName}`);
      supervisor.recordLog(`operation calibrate: ${targetModel.displayName}`);
      const measurement = await calibrate({
        runtime,
        model: targetModel,
        profile,
        supervisor,
        onProgress: (event) => {
          ensureActive();
          const message =
            event.phase === "loading"
              ? `Calibrating ${event.contextSize.toLocaleString()} context`
              : event.phase === "measured"
                ? `Measured ${event.contextSize.toLocaleString()} context`
                : (event.reason ??
                  event.error ??
                  `Skipped ${event.contextSize.toLocaleString()} context`);
          update.message(message);
          supervisor.recordLog(`operation calibrate: ${message}`);
        },
      });
      ensureActive();
      putCalibration(store, targetModel, profile, measurement);
      saveProfilesStore(store, paths);
      update.percent(100);
      supervisor.recordLog(`operation calibrate: saved measurement for ${targetModel.displayName}`);
      return;
    }

    if (kind === "sweep") {
      const runtime = supervisor.runtime ?? resolveRuntime(config, env);
      if (!runtime)
        throw new Error("no llama.cpp runtime available; install one from the Library tab");
      const profile = forModel(store, targetModel, config.defaults);
      update.message(`Sweeping ${targetModel.displayName}`);
      supervisor.recordLog(`operation sweep: ${targetModel.displayName}`);
      const report = await sweep({
        runtime,
        model: targetModel,
        profile,
        supervisor,
        onProgress: (event) => {
          ensureActive();
          const message =
            event.phase === "loading"
              ? `Budget ${event.budget}: loading`
              : event.phase === "generating"
                ? `Budget ${event.budget}: generating`
                : event.phase === "done"
                  ? `Budget ${event.budget}: complete`
                  : `Budget ${event.budget}: ${event.error ?? "failed"}`;
          update.message(message);
          supervisor.recordLog(`operation sweep: ${message}`);
        },
      });
      ensureActive();
      if (report.recommended !== null) {
        profile.reasoningBudget = report.recommended;
        put(store, targetModel, profile);
        saveProfilesStore(store, paths);
        supervisor.recordLog(`operation sweep: saved budget ${report.recommended}`);
      }
      update.percent(100);
      return;
    }

    update.message(`Benchmarking ${targetModel.displayName}`);
    supervisor.recordLog(`operation benchmark: ${targetModel.displayName}`);
    // Scheduler loaded this exact model before admitting the exclusive turn.
    ensureActive();
    supervisor.recordLog(`operation benchmark: resident model ready`);
    const profile = supervisor.profile ?? forModel(store, targetModel, config.defaults);
    const gpuInfo = await queryGpu();
    const calibration = getCalibrationForBudget(store, targetModel, profile);
    const fit = gpuInfo
      ? vram.fitToBudget({
          model: targetModel,
          profile,
          calibration,
          totalVramBytes: gpuInfo.totalBytes,
        })
      : null;
    const archiveId = archive.runId(targetModel);
    const report = await bench.runSuite({
      host: supervisor.host,
      port: supervisor.internalPort,
      concurrency: 3,
      reasoningBudget: profile.reasoningBudget ?? null,
      contextWindow: profile.contextSize ?? null,
      archiveId,
      onProgress: (event) => {
        ensureActive();
        const message = event.title
          ? `${event.title}: ${event.phase}`
          : (event.summary ?? event.phase);
        update.message(message);
        supervisor.recordLog(`operation benchmark: ${message}`);
      },
    });
    ensureActive();
    results.save({
      model: targetModel,
      profile,
      report,
      gpu: gpuInfo,
      runtime: supervisor.runtime
        ? `${supervisor.runtime.label} v${supervisor.runtime.version}`
        : "unknown runtime",
      archiveId,
      args: supervisor.args,
      fit,
      calibration,
      suite: { execute: true, concurrency: 3, depths: null, only: null, mined: false },
    });
    update.percent(100);
    supervisor.recordLog(`operation benchmark: saved result for ${targetModel.displayName}`);
  };
  const attachSupervisorLogs = (resident: Supervisor): void => {
    if (resident === supervisor) return;
    resident.on("log", (line: string) => log("server", line));
    resident.on("crashed", (error: string) => log("model", `FATAL ${error}`));
    resident.on("state", () => statusEvents.notify());
  };
  const createPooledSupervisor = (index: number): Supervisor => {
    const resident = new Supervisor({
      runtime: resolveRuntime(config, env),
      internalPort: supervisor.internalPort + index,
      paths,
      getProfilesStore: () => store,
      logVerbosity: config.runtime.logVerbosity,
    });
    attachSupervisorLogs(resident);
    return resident;
  };
  const createResidentScheduler = (
    resident: Supervisor,
    loadResidentModel: (model: Model) => Promise<void>,
    onChange: () => void,
  ): Scheduler<Supervisor> =>
    new Scheduler<Supervisor>({
      supervisor: resident,
      loadModel: loadResidentModel,
      logger: (message) => log("api", `WARN ${message}`),
      onChange,
      freeSlots: async () => {
        if (resident.state !== "ready") return null;
        try {
          const slots = await sampleSlots({ host: resident.host, port: resident.internalPort });
          return slots ? { idle: slots.idle, ids: slots.idleSlots } : null;
        } catch {
          return null;
        }
      },
      eraseSlot: createSlotEraser(resident.host, resident.internalPort),
    });
  const scheduler = new ModelProcessPool({
    initialSupervisor: supervisor,
    maxModels: config.maxLoadedModels,
    createSupervisor: createPooledSupervisor,
    createScheduler: createResidentScheduler,
    loadModel: loadModelInto,
    logger: (message) => log("model", message),
    onChange: () => statusEvents.notify(),
  });
  processPool = scheduler;
  const jobs = new ServiceJobRunner(
    rescanCatalog,
    runResidentJob,
    scheduler,
    (target) => {
      const modelId =
        target ?? scheduler.residentSupervisors()[0]?.model?.id ?? store.lastModelId ?? null;
      return modelId
        ? (catalog.find(
            (candidate) => candidate.id === modelId || candidate.displayName === modelId,
          ) ?? null)
        : null;
    },
    log,
  );
  // Assigned once `stop` exists below. This indirection lets the management API
  // answer a remote restart request before closing its own socket.
  let requestRestart = (): void => {};

  const hostApi = createHostApi({
    supervisor,
    getCatalog: () => catalog,
    rescan: rescanCatalog,
    getProfilesStore: () => store,
    saveProfiles: (next) => saveProfilesStore(next, paths),
    getProfileDefaults: () => config.defaults,
    queryGpuInfo: queryGpu,
    getRanking: () => {
      try {
        return results.rankModels(results.loadAll());
      } catch {
        return [];
      }
    },
    loadModel,
    unloadModels: () => scheduler.unload(),
    scheduler,
    // The same gate as POST /__host/config. Deleting someone's model files over
    // the network is strictly more dangerous than changing their default model,
    // so it does not get a weaker one.
    getAllowWrite: allowWrite,
    getModelsDir: () => managedModelsDir(config, env),
    sampleResources: () =>
      sampleSystem(cpuSampler, { host: supervisor.host, port: supervisor.internalPort }),
    statusEvents,
    logEvents,
    jobs,
    runLog,
    restart: () => requestRestart(),
    log,
  });

  const handler = withAuth(
    createRouter({
      supervisor,
      telemetry,
      logger: {
        info: (m: string) => log("api", m),
        warn: (m: string) => log("api", `WARN ${m}`),
      },
      getCatalog: () => catalog,
      loadModel,
      version: resolveVersion(),
      getConfig: () => redactConfig(config),
      getEvals: collectEvals,
      getLockModel: () => config.lockModel,
      getDefaultModel: () => config.defaultModel,
      getLockedModels: () => config.lockedModels,
      applyConfigPatch,
      getAllowConfigWrite: allowWrite,
      hostApi,
      // `buildCheapStatus` already samples `/slots`. Do not hit it a second
      // time in parallel: the shared rate tracker needs one ordered timeline.
      getResources: () => sampleSystem(cpuSampler),
      statusEvents,
      scheduler,
    }),
    authToken,
  );

  // TLS terminates in-process when configured; otherwise plain HTTP. The cert
  // manager issues/generates the first keypair before we listen, and hot-swaps
  // the secure context on renewal without dropping connections.
  let certManager: CertManager | null = null;
  let server: http.Server;
  if (tlsOptions) {
    certManager = new CertManager({
      ...tlsOptions,
      logger: {
        info: (message) => log("server", message),
        warn: (message) => log("server", message),
      },
    });
    const secure = await certManager.load();
    const httpsServer = https.createServer({ key: secure.key, cert: secure.cert }, handler);
    certManager.on("renewed", (pair: SecurePair) => {
      httpsServer.setSecureContext({ key: pair.key, cert: pair.cert });
      log("server", "note: TLS certificate hot-swapped");
    });
    server = httpsServer;
  } else {
    server = http.createServer(handler);
  }
  server.keepAliveTimeout = 75_000;
  server.requestTimeout = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, bindHost, resolve);
    });
  } catch (error) {
    // A listener can fail before the host API exists, so this cannot travel
    // through the host's own SSE endpoint. It still belongs to this service
    // session: the foreground daemon child relays this timestamped entry until
    // that endpoint becomes available.
    log("server", `FATAL Brain service startup failed: ${errorMessage(error)}`);
    throw error;
  }
  certManager?.start();

  if (runtime && config.lockModel && config.lockedModels.length > 0) {
    for (const lockedId of config.lockedModels.slice(0, config.maxLoadedModels)) {
      const locked = catalog.find(
        (candidate) => candidate.id === lockedId || candidate.displayName === lockedId,
      );
      if (locked) await scheduler.preload(locked);
    }
  } else if (model && profile && runtime) {
    // Default model remains one auto-load. Additional process slots stay empty
    // until a request names another model.
    await scheduler.preload(model);
  } else if (!runtime) {
    log("server", "ready: no llama.cpp runtime installed; use the Library tab to download one");
  } else {
    log("server", "ready: no model installed; use the Library tab to download one");
  }
  writePidFile(
    {
      pid: process.pid,
      host: bindHost,
      port,
      startedAt: new Date().toISOString(),
      secure: Boolean(tlsOptions),
      displayHost,
    },
    env,
  );
  log(
    "server",
    `ready: ${
      scheduler
        .residentSupervisors()
        .map((resident) => resident.model?.displayName)
        .filter(Boolean)
        .join(", ") || "no model loaded"
    } on ${bindHost}:${port}; run log ${runLog.path}`,
  );

  const stop = async (): Promise<void> => {
    certManager?.stop();
    log("server", "Brain service stopping");
    await scheduler.stop();
    // Publish the terminal outcome before closing the SSE responses below.
    // Once the listener is closed, the daemon can still report the child exit,
    // but it cannot receive this service-owned, durable session-log entry.
    log("server", "Brain service stopped");
    // Before server.close(), which waits on open connections: a subscribed
    // daemon holds an SSE response open indefinitely by design.
    statusEvents.close();
    server.closeIdleConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    removePidFile(env);
  };

  requestRestart = () => {
    void stop().finally(() => process.exit(75));
  };

  return {
    server,
    supervisor,
    host: bindHost,
    port,
    model: supervisor.model,
    secure: Boolean(tlsOptions),
    displayHost,
    stop,
  };
}
