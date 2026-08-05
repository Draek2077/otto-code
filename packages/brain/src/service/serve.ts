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
import { createHostApi } from "./host-api.js";
import { createRouter, Telemetry } from "./router.js";
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
  model: Model;
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
  const runtime = resolveRuntime(config, env);
  if (!runtime) {
    throw new CommandError({
      code: "NO_RUNTIME",
      message: "no llama.cpp runtime available",
      details: "run `otto brain runtime install` to download one, or install LM Studio",
    });
  }

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
  const needle = modelNeedle ?? config.defaultModel ?? store.lastModelId ?? undefined;
  const model = needle ? pickModel(catalog, needle) : pickAutoModel(catalog);
  let profile = forModel(store, model, config.defaults);

  const gpu = await queryGpu();
  if (gpu) {
    const fit = vram.fitToBudget({
      model,
      profile,
      calibration: getCalibration(store, model, profile),
      totalVramBytes: gpu.totalBytes,
    });
    if (!fit.adjusted && !fit.budget.fits) {
      throw new CommandError({
        code: "DOES_NOT_FIT",
        message: `refusing to start: ${fit.reason}`,
        details: "use a smaller quant, or run `otto brain calibrate` for a measured budget",
      });
    }
    if (fit.adjusted && fit.reason) log(`note: ${fit.reason}`);
    profile = fit.profile;
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

  const hostApi = createHostApi({
    supervisor,
    getCatalog: () => catalog,
    rescan: () => {
      catalog = scanModels(config, env);
      return catalog;
    },
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
      getResources: () =>
        sampleSystem(cpuSampler, { host: supervisor.host, port: supervisor.internalPort }),
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

  await supervisor.start(model, profile);
  store.lastModelId = model.id;
  saveProfilesStore(store, paths);
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
  log(`ready: ${model.displayName} on ${bindHost}:${port}; run log ${runLog.path}`);

  const stop = async (): Promise<void> => {
    certManager?.stop();
    log("Brain service stopping");
    await supervisor.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    removePidFile(env);
  };

  return {
    server,
    supervisor,
    host: bindHost,
    port,
    model,
    secure: Boolean(tlsOptions),
    displayHost,
    stop,
  };
}
