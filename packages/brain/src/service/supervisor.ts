import http from "node:http";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

import { buildArgs, buildEnv, formatCommand } from "../runtime/index.js";
import { resolveHostingProfileForLaunch } from "../config/hosting-profiles.js";
import { getCalibrationForBudget } from "../config/profiles.js";
import { resolveBrainPaths, type BrainPaths } from "../config/paths.js";
import { loadProfilesStore } from "../config/store.js";
import { usedBytes } from "../gpu.js";
import type { Model, Runtime } from "../types.js";
import type { Profile, ProfilesStore } from "../config/schema.js";
import { formatBrainLog, formatLlamaServerLog, type BrainLogArea } from "./log-format.js";

const LOG_LINES_KEPT = 10_000;

/**
 * Default loopback port for the private llama-server child. Deliberately clear
 * of Otto's space: 8081 (the old default) is the Expo/Metro dev port, so a brain
 * started from the dev checkout collided with the running app - the server bound
 * a port the app also wanted, and benchmark requests hit Metro (or a dead
 * socket) instead of the model. This range sits above Otto's daemon ports
 * (6788/6868) and app port (8081/19000) and below the Windows ephemeral range.
 * Calibrate and sweep run their own supervisors at +1/+2 so they never collide
 * with a main service already holding the base port.
 */
export const DEFAULT_INTERNAL_PORT = 20800;

export type SupervisorState = "stopped" | "starting" | "ready" | "failed" | "stopping";

export interface SupervisorOptions {
  runtime: Runtime | null;
  internalPort?: number;
  host?: string;
  logVerbosity?: number;
  readyTimeoutMs?: number;
  /**
   * Long-lived hosts provide their live store so profile edits applied just
   * before a model switch are visible without a second disk read. Standalone
   * operations use the current persisted store, which still preserves the
   * launch-resolution invariant.
   */
  paths?: BrainPaths;
  getProfilesStore?: () => ProfilesStore;
}

export interface SupervisorStatus {
  state: SupervisorState;
  model: string | null;
  modelId: string | null;
  pid: number | null;
  loadSeconds: number | null;
  vramBytes: number | null;
  startedAt: string | null;
  lastError: string | null;
  upstream: string;
  runtime: string;
}

/**
 * Owns the llama-server child process.
 *
 * The server always listens on a private port; `router.js` fronts it on a
 * stable one so switching models never asks a client to reconnect elsewhere.
 */
export class Supervisor extends EventEmitter {
  runtime: Runtime | null;
  internalPort: number;
  host: string;
  logVerbosity: number;
  readyTimeoutMs: number;
  paths: BrainPaths;
  getProfilesStore: () => ProfilesStore;

  state: SupervisorState;
  child: ChildProcess | null;
  model: Model | null;
  profile: Profile | null;
  logLines: string[];
  lastError: string | null;
  startedAt: Date | null;
  loadSeconds: number | null;
  vramAtReadyBytes: number | null;
  vramBaselineBytes: number | null;
  command: string | null;
  /**
   * The argv of the running child, beside the formatted `command`. Kept as the
   * array as well because a benchmark stores it (`ops/results.ts`) and a quoted
   * shell line is for reading, not for re-parsing.
   */
  args: string[] | null;

  constructor({
    runtime,
    internalPort = DEFAULT_INTERNAL_PORT,
    host = "127.0.0.1",
    logVerbosity = 3,
    readyTimeoutMs = 300_000,
    paths = resolveBrainPaths(),
    getProfilesStore = loadProfilesStore,
  }: SupervisorOptions) {
    super();
    this.runtime = runtime;
    this.internalPort = internalPort;
    this.host = host;
    this.logVerbosity = logVerbosity;
    this.readyTimeoutMs = readyTimeoutMs;
    this.paths = paths;
    this.getProfilesStore = getProfilesStore;

    this.state = "stopped"; // stopped | starting | ready | failed
    this.child = null;
    this.model = null;
    this.profile = null;
    this.logLines = [];
    this.lastError = null;
    this.startedAt = null;
    this.loadSeconds = null;
    this.vramAtReadyBytes = null;
    this.vramBaselineBytes = null;
    this.command = null;
    this.args = null;
  }

  get upstreamBase(): string {
    return `http://${this.host}:${this.internalPort}`;
  }

  #setState(state: SupervisorState, detail?: string): void {
    this.state = state;
    this.emit("state", { state, detail });
  }

  #log(line: string): void {
    if (!line) return;
    this.logLines.push(line);
    if (this.logLines.length > LOG_LINES_KEPT) this.logLines.shift();
    this.emit("log", line);
  }

  /**
   * Add a host-operation event to the same in-process tail as llama-server output.
   *
   * Calibrate, sweep, and benchmark deliberately reuse this supervisor rather
   * than creating invisible sidecar servers. Their lifecycle markers belong in
   * the same event stream as the child they exercise. The serving process
   * copies that stream into its durable full Brain-session log.
   */
  recordLog(line: string, area: BrainLogArea = "model"): void {
    this.#log(formatBrainLog(area, line));
  }

  /**
   * Start (or restart) the server for a model + profile.
   *
   * This is the sole llama-server launch boundary, so it materializes the
   * selected hosting profile here. Keeping it beside `buildArgs()` makes the
   * Jinja template and router-visible system addendum mandatory for every
   * caller, including future maintenance operations that start a sidecar.
   */
  async start(model: Model, profile: Profile): Promise<this> {
    await this.stop();

    if (!this.runtime) {
      this.lastError = "no llama.cpp runtime available";
      this.#setState("failed", this.lastError);
      throw new Error(this.lastError);
    }
    const runtime = this.runtime;
    // The engine's slot save/erase directory, under the brain's home so it
    // survives across model relaunches (the dir is persistent; the engine only
    // ever uses it for the `action=erase` the scheduler issues on a handoff,
    // which never writes a file). Created before the args are built because
    // llama.cpp validates it exists at launch and throws otherwise.
    const slotSavePath = path.join(this.paths.root, "slot-saves");
    try {
      mkdirSync(slotSavePath, { recursive: true });
    } catch {
      /* the engine then starts without slot actions - the pre-fix behavior */
    }
    const launchProfile = resolveHostingProfileForLaunch(
      this.paths,
      this.getProfilesStore(),
      profile,
      model.family,
    );

    this.model = model;
    this.profile = launchProfile;
    this.lastError = null;
    this.vramBaselineBytes = await usedBytes();
    this.#setState("starting");

    const args = buildArgs(
      { ...launchProfile, modelPath: model.modelPath, mmprojPath: model.mmprojPath },
      {
        port: this.internalPort,
        host: this.host,
        logVerbosity: this.logVerbosity,
        slotSavePath,
      },
      model,
      // The prompt-cache budget is derived from measured KV bytes/token, so the
      // launch boundary is where it has to be resolved - nothing downstream of
      // here can reach the calibration store.
      getCalibrationForBudget(this.getProfilesStore(), model, launchProfile),
    );
    this.args = args;
    this.command = formatCommand(runtime, args);
    this.#log(formatBrainLog("model", `launching: ${this.command}`));

    const started = Date.now();
    this.child = spawn(runtime.exe, args, {
      cwd: runtime.dir,
      env: buildEnv(runtime),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const onChunk = (chunk: Buffer): void => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.trim()) this.#log(formatLlamaServerLog(line.trim()));
      }
    };
    this.child.stdout?.on("data", onChunk);
    this.child.stderr?.on("data", onChunk);

    let exitedEarly: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    this.child.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      const wasReady = this.state === "ready";
      this.child = null;
      if (this.state === "stopping") {
        this.#setState("stopped");
        return;
      }
      exitedEarly = { code, signal };
      // 3221225781 == 0xC0000135 STATUS_DLL_NOT_FOUND: the vendor DLL trap.
      const hint =
        code === 3221225781 ? " (missing runtime DLLs - the vendor directory was not on PATH)" : "";
      this.lastError = `llama-server exited with code ${code}${signal ? ` signal ${signal}` : ""}${hint}`;
      this.#setState("failed", this.lastError);
      if (wasReady) this.emit("crashed", this.lastError);
    });

    this.child.once("error", (error: Error) => {
      this.lastError = `could not launch llama-server: ${error.message}`;
      this.#setState("failed", this.lastError);
    });

    // Poll /health until the model finishes loading.
    const deadline = Date.now() + this.readyTimeoutMs;
    let peakVram = this.vramBaselineBytes || 0;

    while (Date.now() < deadline) {
      if (exitedEarly) throw new Error(this.lastError ?? undefined);
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const used = await usedBytes();
      if (used && used > peakVram) peakVram = used;

      const health = await this.#health();
      if (health) {
        this.loadSeconds = (Date.now() - started) / 1000;
        this.startedAt = new Date();
        this.vramAtReadyBytes = (await usedBytes()) ?? peakVram;
        this.#setState("ready");
        this.emit("ready", {
          loadSeconds: this.loadSeconds,
          vramBytes: this.vramAtReadyBytes,
          deltaBytes: this.vramAtReadyBytes - (this.vramBaselineBytes || 0),
        });
        return this;
      }
    }

    this.lastError = `model did not become ready within ${this.readyTimeoutMs / 1000}s`;
    await this.stop();
    this.#setState("failed", this.lastError);
    throw new Error(this.lastError);
  }

  #health(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(
        { host: this.host, port: this.internalPort, path: "/health", timeout: 2500 },
        (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        },
      );
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
      req.on("error", () => resolve(false));
    });
  }

  /** Fetch /props from the running server (modalities, template caps, defaults). */
  props(): Promise<unknown> {
    return new Promise((resolve) => {
      const req = http.get(
        { host: this.host, port: this.internalPort, path: "/props", timeout: 5000 },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => {
            try {
              resolve(JSON.parse(body) as unknown);
            } catch {
              resolve(null);
            }
          });
        },
      );
      req.on("timeout", () => {
        req.destroy();
        resolve(null);
      });
      req.on("error", () => resolve(null));
    });
  }

  async stop(): Promise<void> {
    if (!this.child) {
      if (this.state !== "stopped") this.#setState("stopped");
      return;
    }
    this.#setState("stopping");
    const child = this.child;
    await new Promise<void>((resolve) => {
      const done = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
        resolve();
      }, 6000);
      child.once("exit", () => {
        clearTimeout(done);
        resolve();
      });
      try {
        child.kill();
      } catch {
        clearTimeout(done);
        resolve();
      }
    });
    this.child = null;
    this.#setState("stopped");
  }

  status(): SupervisorStatus {
    return {
      state: this.state,
      model: this.model ? this.model.displayName : null,
      modelId: this.model ? this.model.id : null,
      pid: this.child ? (this.child.pid ?? null) : null,
      loadSeconds: this.loadSeconds,
      vramBytes: this.vramAtReadyBytes,
      startedAt: this.startedAt ? this.startedAt.toISOString() : null,
      lastError: this.lastError,
      upstream: this.upstreamBase,
      runtime: this.runtime ? `${this.runtime.label} v${this.runtime.version}` : "not installed",
    };
  }
}
