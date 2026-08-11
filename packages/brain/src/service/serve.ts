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
  getCalibration,
  forModel,
  loadPersistedConfig,
  loadProfilesStore,
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
import { createCpuSampler, sample as sampleSystem } from "../sysmon.js";
import { createHostApi, type HostJob, type HostJobRunner } from "./host-api.js";
import { errorMessage } from "./http-util.js";
import { createRouter, Telemetry } from "./router.js";
import { BrainStatusPublisher } from "./status-events.js";
import { Supervisor } from "./supervisor.js";
import * as tailscale from "./tailscale.js";
import { CertManager, resolveTlsOptions, type SecurePair } from "./tls.js";
import { removePidFile, writePidFile } from "./pid-lock.js";
import { createBrainRunLog } from "./run-log.js";

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
class ServiceJobRunner implements HostJobRunner {
  private readonly jobs = new Map<string, HostJob & { child: ChildProcess | null }>();

  constructor(private readonly onPullCompleted: () => void) {}

  start(kind: HostJob["kind"], target: string | null, args: string[]): HostJob {
    const running = [...this.jobs.values()].find((job) => job.status === "running");
    if (running) throw new Error(`Another operation is already running (${running.label}).`);
    const job: HostJob & { child: ChildProcess | null } = {
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
    };
    // The service is launched by the same CLI entry point as `otto-brain bench`.
    // Reusing that entry point keeps its config/path resolution on this host.
    const entry = process.argv[1];
    if (!entry) throw new Error("The brain service has no CLI entry point.");
    const child = spawn(process.execPath, [entry, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    job.child = child;
    this.jobs.set(job.id, job);
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => this.ingestOutput(job, chunk));
    child.once("error", (error) => this.finish(job, "failed", error.message));
    child.once("close", (code) => {
      if (job.status !== "running") return;
      if (code === 0 && kind === "pull") {
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
    return this.publicJob(job);
  }

  async query(args: string[]): Promise<unknown> {
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
      child.stdout?.on("data", (chunk: string) => (out += chunk));
      child.stderr?.on("data", (chunk: string) => (err += chunk));
      child.once("error", reject);
      child.once("close", (code) => {
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
    if (!job || job.status !== "running" || !job.child) return this.list();
    const child = job.child;
    if (process.platform === "win32" && child.pid) {
      await new Promise<void>((resolve) =>
        execFile("taskkill", ["/pid", String(child.pid), "/t", "/f"], () => resolve()),
      );
    } else {
      child.kill("SIGTERM");
    }
    this.finish(job, "canceled", "Canceled.");
    return this.list();
  }

  private ingestOutput(job: HostJob & { child: ChildProcess | null }, chunk: string): void {
    for (const line of chunk
      .split(/[\r\n]+/u)
      .map((value) => value.trim())
      .filter(Boolean)) {
      const progress = /(\d{1,3})\s*%/u.exec(line);
      if (progress) job.percent = Math.max(0, Math.min(100, Number(progress[1])));
      // The final JSON result is not a useful status label. Keep progress and
      // actionable text instead, so a failed bundle pull tells the user why.
      if (line !== "[" && !/^[\]{}",]+$/u.test(line)) job.message = line.slice(-1000);
    }
  }

  private finish(
    job: HostJob & { child: ChildProcess | null },
    status: HostJob["status"],
    error: string | null,
  ): void {
    if (job.status !== "running") return;
    job.child = null;
    job.status = status;
    job.error = error;
    job.finishedAt = new Date().toISOString();
    if (status === "succeeded") job.percent = 100;
  }

  private publicJob({ child: _child, ...job }: HostJob & { child: ChildProcess | null }): HostJob {
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
  const log = (line: string): void => {
    runLog.write(line);
    onLog(line);
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
      log(`note: ${error instanceof Error ? error.message : "configured model is unavailable"}`);
    }
  }
  let profile = model ? forModel(store, model, config.defaults) : null;

  const gpu = await queryGpu();
  if (gpu && model && profile) {
    const fit = vram.fitToBudget({
      model,
      profile,
      calibration: getCalibration(store, model, profile),
      totalVramBytes: gpu.totalBytes,
    });
    if (!fit.adjusted && !fit.budget.fits) {
      // Starting the host is what exposes the Library and model profile UI.
      // An automatic startup candidate that cannot load must therefore leave
      // the host alive and unloaded, not make the only recovery surface vanish.
      log(
        `note: not loading ${model.displayName}: ${fit.reason ?? "does not fit in available VRAM"}`,
      );
      model = null;
      profile = null;
    } else {
      if (fit.adjusted && fit.reason) log(`note: ${fit.reason}`);
      profile = fit.profile;
    }
  }

  const telemetry = new Telemetry();
  const supervisor = new Supervisor({ runtime });
  supervisor.on("log", (line: string) => {
    runLog.write(line);
    if (/error|failed|warn/i.test(line)) onLog(line);
  });
  supervisor.on("crashed", (error: string) => runLog.write(`FATAL ${error}`));

  // Serialize model switches: the router queues request-driven switches, but the
  // config path (POST /__host/config) calls loadModel directly. Chaining here
  // guarantees two switches (e.g. a config write racing a request-driven switch)
  // can never overlap two supervisor.start() calls, whichever caller triggers them.
  let modelSwitchChain: Promise<void> = Promise.resolve();
  const loadModelUnsafe = async (target: Model): Promise<void> => {
    // A runtime can be installed from the Library tab after this service starts.
    // Resolve it at load time so the user does not have to restart the brain.
    supervisor.runtime = resolveRuntime(config, env);
    if (!supervisor.runtime) {
      throw new Error("no llama.cpp runtime available; install one from the Library tab");
    }
    const gpuInfo = await queryGpu();
    let fitProfile = forModel(store, target, config.defaults);
    if (gpuInfo) {
      const fit = vram.fitToBudget({
        model: target,
        profile: fitProfile,
        calibration: getCalibration(store, target, fitProfile),
        totalVramBytes: gpuInfo.totalBytes,
      });
      if (!fit.adjusted && !fit.budget.fits) throw new Error(fit.reason ?? "does not fit");
      fitProfile = fit.profile;
    }
    await supervisor.start(target, fitProfile);
    store.lastModelId = target.id;
    saveProfilesStore(store, paths);
  };
  const loadModel = (target: Model): Promise<void> => {
    const run = modelSwitchChain.then(() => loadModelUnsafe(target));
    // Keep the chain alive even if this switch fails, so a later switch still runs.
    modelSwitchChain = run.catch(() => undefined);
    return run;
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
    const persisted = loadPersistedConfig(paths);
    persisted.defaultModel = config.defaultModel;
    persisted.lockModel = config.lockModel;
    saveBrainConfig(persisted, paths);
    if (switchTo) {
      const target = catalog.find((m) => m.displayName === switchTo || m.id === switchTo);
      if (target) await loadModel(target);
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
  const jobs = new ServiceJobRunner(rescanCatalog);
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
    // The same gate as POST /__host/config. Deleting someone's model files over
    // the network is strictly more dangerous than changing their default model,
    // so it does not get a weaker one.
    getAllowWrite: allowWrite,
    getModelsDir: () => managedModelsDir(config, env),
    sampleResources: () =>
      sampleSystem(cpuSampler, { host: supervisor.host, port: supervisor.internalPort }),
    statusEvents,
    jobs,
    restart: () => requestRestart(),
  });

  const handler = withAuth(
    createRouter({
      supervisor,
      telemetry,
      logger: { warn: (m: string) => log(`WARN ${m}`) },
      getCatalog: () => catalog,
      loadModel,
      version: resolveVersion(),
      getConfig: () => redactConfig(config),
      getEvals: collectEvals,
      getLockModel: () => config.lockModel,
      getDefaultModel: () => config.defaultModel,
      applyConfigPatch,
      getAllowConfigWrite: allowWrite,
      hostApi,
      // `buildCheapStatus` already samples `/slots`. Do not hit it a second
      // time in parallel: the shared rate tracker needs one ordered timeline.
      getResources: () => sampleSystem(cpuSampler),
      statusEvents,
    }),
    authToken,
  );

  // TLS terminates in-process when configured; otherwise plain HTTP. The cert
  // manager issues/generates the first keypair before we listen, and hot-swaps
  // the secure context on renewal without dropping connections.
  let certManager: CertManager | null = null;
  let server: http.Server;
  if (tlsOptions) {
    certManager = new CertManager({ ...tlsOptions, logger: { info: onLog, warn: onLog } });
    const secure = await certManager.load();
    const httpsServer = https.createServer({ key: secure.key, cert: secure.cert }, handler);
    certManager.on("renewed", (pair: SecurePair) => {
      httpsServer.setSecureContext({ key: pair.key, cert: pair.cert });
      onLog("note: TLS certificate hot-swapped");
    });
    server = httpsServer;
  } else {
    server = http.createServer(handler);
  }
  server.keepAliveTimeout = 75_000;
  server.requestTimeout = 0;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, bindHost, resolve);
  });
  certManager?.start();

  if (model && profile && runtime) {
    await supervisor.start(model, profile);
    store.lastModelId = model.id;
    saveProfilesStore(store, paths);
  } else if (!runtime) {
    log("ready: no llama.cpp runtime installed; use the Library tab to download one");
  } else {
    log("ready: no model installed; use the Library tab to download one");
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
    `ready: ${supervisor.model?.displayName ?? "no model loaded"} on ${bindHost}:${port}; run log ${runLog.path}`,
  );

  const stop = async (): Promise<void> => {
    certManager?.stop();
    log("Brain service stopping");
    // Before server.close(), which waits on open connections: a subscribed
    // daemon holds an SSE response open indefinitely by design.
    statusEvents.close();
    await supervisor.stop();
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
