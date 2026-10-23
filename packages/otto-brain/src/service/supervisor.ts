/** Owns one private llama.cpp process. Residency and scheduling layer above this. */
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import type { BrainPaths } from "../config/paths.js";
import type { Profile, ProfilesStore } from "../config/schema.js";
import { getCalibrationForBudget } from "../config/profiles.js";
import { resolveHostingProfileForLaunch } from "../config/hosting-profiles.js";
import type { Model, Runtime } from "../types.js";
import {
  llamaCppRuntimeDriver,
  type ModelServerLaunch,
  type ModelServerRuntimeDriver,
} from "../runtime/model-server-driver.js";

export const DEFAULT_INTERNAL_PORT = 20800;
export type SupervisorState = "stopped" | "starting" | "ready" | "failed" | "stopping";
export interface SupervisorOptions {
  runtime: Runtime;
  paths: BrainPaths;
  getProfilesStore(): ProfilesStore;
  driver?: ModelServerRuntimeDriver;
  internalPort?: number;
  readyTimeoutMs?: number;
  logVerbosity?: number;
}

interface OwnedChild {
  process: ChildProcess;
  closed: Promise<void>;
  controller: AbortController;
  failure: Error | null;
}

export class Supervisor extends EventEmitter {
  state: SupervisorState = "stopped";
  model: Model | null = null;
  profile: Profile | null = null;
  lastError: string | null = null;
  launch: ModelServerLaunch | null = null;
  logLines: string[] = [];
  private owned: OwnedChild | null = null;
  private stopping: Promise<void> | null = null;
  private loading: AbortController | null = null;
  readonly driver: ModelServerRuntimeDriver;
  readonly internalPort: number;

  constructor(private readonly options: SupervisorOptions) {
    super();
    this.driver = options.driver ?? llamaCppRuntimeDriver;
    this.internalPort = options.internalPort ?? DEFAULT_INTERNAL_PORT;
    if (!Number.isInteger(this.internalPort) || this.internalPort < 1 || this.internalPort > 65535)
      throw new Error("Brain internal port must be between 1 and 65535");
  }

  get upstream(): string {
    return `http://127.0.0.1:${this.internalPort}`;
  }

  status() {
    return {
      state: this.state,
      model: this.model?.displayName ?? null,
      modelId: this.model?.id ?? null,
      pid: this.owned?.process.pid ?? null,
      lastError: this.lastError,
      upstream: this.upstream,
      runtime: this.options.runtime.label,
    };
  }

  /** Explicit only: construction/imports never scan, install or load a model. */
  async start(model: Model, profile: Profile, signal?: AbortSignal): Promise<void> {
    if (this.owned || this.stopping || this.loading)
      throw new Error("Brain model process is already owned");
    signal?.throwIfAborted();
    const loading = new AbortController();
    this.loading = loading;
    const cancellation = signal ? AbortSignal.any([loading.signal, signal]) : loading.signal;
    this.state = "starting";
    try {
      // A healthy process already on this port must never satisfy this child's readiness.
      await assertPortAvailable(this.internalPort);
      cancellation.throwIfAborted();
      await this.launchModel(model, profile, cancellation);
    } catch (error) {
      if (!this.owned && this.state === "starting") {
        this.state = cancellation.aborted ? "stopped" : "failed";
        this.lastError = cancellation.aborted ? null : String(error);
      }
      throw error;
    } finally {
      if (this.loading === loading) this.loading = null;
    }
  }

  private async launchModel(model: Model, profile: Profile, signal: AbortSignal): Promise<void> {
    const store = this.options.getProfilesStore();
    const resolved = resolveHostingProfileForLaunch(
      this.options.paths,
      store,
      profile,
      model.family,
    );
    const launch = this.driver.createLaunch({
      runtime: this.options.runtime,
      model,
      profile: resolved,
      calibration: getCalibrationForBudget(store, model, resolved),
      paths: this.options.paths,
      host: "127.0.0.1",
      port: this.internalPort,
      logVerbosity: this.options.logVerbosity ?? 3,
    });
    this.model = model;
    this.profile = resolved;
    this.launch = launch;
    this.lastError = null;
    this.logLines = [];
    this.state = "starting";
    const child = spawn(launch.executable, launch.args, {
      cwd: launch.cwd,
      env: launch.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const owned = this.observe(child, launch);
    this.owned = owned;
    const abort = () => owned.controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    try {
      await this.waitReady(owned, launch.readinessPath);
      this.state = "ready";
      this.emit("ready", this.status());
    } catch (error) {
      const cancelled = (owned.controller.signal.aborted && !owned.failure) || signal?.aborted;
      await this.stop();
      if (!cancelled) {
        this.state = "failed";
        this.lastError = error instanceof Error ? error.message : String(error);
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  private observe(child: ChildProcess, launch: ModelServerLaunch): OwnedChild {
    const owned: OwnedChild = {
      process: child,
      controller: new AbortController(),
      failure: null,
      closed: Promise.resolve(),
    };
    owned.closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
    child.once("error", (error) => {
      owned.failure = new Error(this.driver.describeLaunchError(error));
      owned.controller.abort(owned.failure);
    });
    child.once("exit", (code, signal) => {
      if (this.owned !== owned || this.state === "stopping") return;
      owned.failure = new Error(this.driver.describeProcessExit({ code, signal }));
      this.lastError = owned.failure.message;
      const wasReady = this.state === "ready";
      this.state = "failed";
      owned.controller.abort(owned.failure);
      if (wasReady) this.emit("crashed", this.status());
    });
    for (const stream of [child.stdout, child.stderr]) {
      let pending = "";
      stream?.on("data", (chunk: Buffer) => {
        // Native logs are untrusted output; bound both incomplete lines and history.
        pending = (pending + chunk.toString()).slice(-65536);
        const lines = pending.split(/\r?\n/u);
        pending = lines.pop() ?? "";
        for (const line of lines) this.logLines.push(launch.formatLogLine(line));
        if (this.logLines.length > 10000) this.logLines.splice(0, this.logLines.length - 10000);
      });
    }
    return owned;
  }

  private async waitReady(owned: OwnedChild, route: string): Promise<void> {
    const deadline = AbortSignal.timeout(this.options.readyTimeoutMs ?? 300000);
    const signal = AbortSignal.any([owned.controller.signal, deadline]);
    while (!signal.aborted) {
      try {
        const response = await fetch(this.upstream + route, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]),
          redirect: "error",
        });
        await response.body?.cancel();
        if (response.ok) {
          signal.throwIfAborted();
          return;
        }
      } catch {
        if (signal.aborted) break;
      }
      try {
        await delay(50, undefined, { signal });
      } catch {
        break;
      }
    }
    throw owned.failure ?? signal.reason;
  }

  async properties(): Promise<unknown> {
    if (this.state !== "ready" || !this.launch?.propertiesPath)
      throw new Error("Brain model is not ready");
    const response = await fetch(this.upstream + this.launch.propertiesPath, {
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    if (!response.ok) throw new Error(`Brain model properties failed (${response.status})`);
    return response.json();
  }

  /** Host attachment exposes the resident identity; inference admission is B04. */
  handleRequest(request: IncomingMessage, response: ServerResponse): boolean {
    if (request.method !== "GET" || !["/v1/models", "/api/v0/models"].includes(request.url ?? ""))
      return false;
    const data =
      this.state === "ready" && this.model
        ? [{ id: this.model.id, object: "model", owned_by: "otto-brain" }]
        : [];
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ object: "list", data }));
    return true;
  }

  stop(signal?: AbortSignal): Promise<void> {
    this.loading?.abort(new Error("Brain model stopped"));
    if (this.stopping) return this.stopping;
    const owned = this.owned;
    if (!owned) {
      this.state = "stopped";
      return Promise.resolve();
    }
    this.state = "stopping";
    owned.controller.abort(new Error("Brain model stopped"));
    const kill = () => {
      owned.process.kill("SIGKILL");
    };
    const timer = setTimeout(kill, 2000);
    signal?.addEventListener("abort", kill, { once: true });
    if (signal?.aborted) kill();
    else owned.process.kill("SIGTERM");
    this.stopping = owned.closed.finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", kill);
      if (this.owned === owned) this.owned = null;
      this.state = "stopped";
      this.stopping = null;
    });
    return this.stopping;
  }
}

async function assertPortAvailable(port: number): Promise<void> {
  const probe = net.createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve()));
  });
}
