/**
 * The headless brain service: the router + supervisor bound to a port, with the
 * VRAM fit, on-demand model switching, remote auth, and pid-file lifecycle. Used
 * both by `otto brain serve` (foreground) and by a detached `otto brain start`.
 * It stays provider-neutral about the runtime source — it takes whatever
 * resolveRuntime picks (managed or LM Studio).
 */
import http from "node:http";

import { getCalibration, forModel, loadProfilesStore, saveProfilesStore } from "../config/index.js";
import type { BrainConfig } from "../config/schema.js";
import { query as queryGpu } from "../gpu.js";
import { pickModel, scanModels } from "../models/index.js";
import { CommandError } from "../output/types.js";
import { resolveRuntime } from "../runtime/index.js";
import type { Model } from "../types.js";
import * as vram from "../vram.js";
import { createRouter, Telemetry } from "./router.js";
import { Supervisor } from "./supervisor.js";
import { removePidFile, writePidFile } from "./pid-lock.js";

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function extractToken(req: http.IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) return auth.slice(7).trim();
  const header = req.headers["x-otto-brain-token"];
  return typeof header === "string" ? header : null;
}

/** Gate the router with a bearer token when configured; /health stays open. */
function withAuth(inner: http.RequestListener, config: BrainConfig): http.RequestListener {
  const token = config.auth.mode === "token" ? config.auth.token : null;
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
  stop: () => Promise<void>;
}

export async function startService({
  config,
  modelNeedle,
  env = process.env,
  onLog = () => {},
}: StartServiceOptions): Promise<ServiceHandle> {
  const runtime = resolveRuntime(config, env);
  if (!runtime) {
    throw new CommandError({
      code: "NO_RUNTIME",
      message: "no llama.cpp runtime available",
      details: "run `otto brain runtime install` to download one, or install LM Studio",
    });
  }

  const host = config.listen.host;
  const port = config.listen.port;
  if (!isLoopback(host) && config.auth.mode !== "token" && env.OTTO_BRAIN_ALLOW_INSECURE !== "1") {
    throw new CommandError({
      code: "INSECURE_BIND",
      message: `refusing to bind ${host} without auth`,
      details: "set auth.mode=token (or OTTO_BRAIN_ALLOW_INSECURE=1 to override)",
    });
  }

  const store = loadProfilesStore();
  const catalog = scanModels(config, env);
  const needle = modelNeedle ?? config.defaultModel ?? store.lastModelId ?? undefined;
  const model = pickModel(catalog, needle);
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
    if (fit.adjusted && fit.reason) onLog(`note: ${fit.reason}`);
    profile = fit.profile;
  }

  const telemetry = new Telemetry();
  const supervisor = new Supervisor({ runtime });
  supervisor.on("log", (line: string) => {
    if (/error|failed|warn/i.test(line)) onLog(line);
  });

  const loadModel = async (target: Model): Promise<void> => {
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
    saveProfilesStore(store);
  };

  const server = http.createServer(
    withAuth(
      createRouter({
        supervisor,
        telemetry,
        logger: { warn: (m: string) => onLog(`WARN ${m}`) },
        getCatalog: () => catalog,
        loadModel,
      }),
      config,
    ),
  );
  server.keepAliveTimeout = 75_000;
  server.requestTimeout = 0;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  await supervisor.start(model, profile);
  store.lastModelId = model.id;
  saveProfilesStore(store);
  writePidFile({ pid: process.pid, host, port, startedAt: new Date().toISOString() }, env);

  const stop = async (): Promise<void> => {
    await supervisor.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    removePidFile(env);
  };

  return { server, supervisor, host, port, model, stop };
}
