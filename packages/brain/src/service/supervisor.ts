import http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

import { buildArgs, buildEnv, formatCommand } from "../runtime/index.js";
import { usedBytes } from "../gpu.js";
import type { Model, Runtime } from "../types.js";
import type { Profile } from "../config/schema.js";

const LOG_LINES_KEPT = 300;

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
  runtime: Runtime;
  internalPort?: number;
  host?: string;
  readyTimeoutMs?: number;
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
  runtime: Runtime;
  internalPort: number;
  host: string;
  readyTimeoutMs: number;

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

  constructor({
    runtime,
    internalPort = DEFAULT_INTERNAL_PORT,
    host = "127.0.0.1",
    readyTimeoutMs = 300_000,
  }: SupervisorOptions) {
    super();
    this.runtime = runtime;
    this.internalPort = internalPort;
    this.host = host;
    this.readyTimeoutMs = readyTimeoutMs;

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

  /** Start (or restart) the server for a model + profile. */
  async start(model: Model, profile: Profile): Promise<this> {
    await this.stop();

    this.model = model;
    this.profile = profile;
    this.lastError = null;
    this.logLines = [];
    this.vramBaselineBytes = await usedBytes();
    this.#setState("starting");

    const args = buildArgs(
      { ...profile, modelPath: model.modelPath, mmprojPath: model.mmprojPath },
      { port: this.internalPort, host: this.host },
    );
    this.command = formatCommand(this.runtime, args);
    this.#log(`launching: ${this.command}`);

    const started = Date.now();
    this.child = spawn(this.runtime.exe, args, {
      cwd: this.runtime.dir,
      env: buildEnv(this.runtime),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const onChunk = (chunk: Buffer): void => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.trim()) this.#log(line.trim());
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
      runtime: `${this.runtime.label} v${this.runtime.version}`,
    };
  }
}
