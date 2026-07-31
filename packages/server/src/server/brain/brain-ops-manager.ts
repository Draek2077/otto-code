import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Logger } from "pino";

import type {
  BrainCatalogModel,
  BrainInstalledModel,
  BrainJob,
  BrainJobKind,
  BrainRuntime,
} from "@otto-code/protocol/messages";
import {
  BrainCatalogModelSchema,
  BrainInstalledModelSchema,
  BrainRuntimeSchema,
} from "@otto-code/protocol/messages";

import { spawnProcess } from "../../utils/spawn.js";
import { terminateWithTreeKill } from "../../utils/tree-kill.js";
import { resolveBrainBinPath } from "./brain-manager.js";

/**
 * Daemon-side driver for @otto-code/brain's model-management verbs. Like
 * BrainManager, it never imports the brain's runtime modules in-process: it
 * shells out to `bin/otto-brain <verb> --json` and parses the result.
 *
 * Two shapes of work:
 *  - Reads (scan / catalog / runtime list) are quick request/response calls that
 *    parse the CLI's `--json` stdout.
 *  - Long operations (pull, runtime install, calibrate, sweep, bench) run as
 *    tracked JOBS. The child's stderr carries progress (`<pct>%`, phase lines);
 *    the client polls jobs() and renders it. Only one job runs at a time — the
 *    ops load models and hold the GPU, and serializing downloads too keeps the
 *    surface simple and predictable.
 *
 * The brain writes its own config/models under $OTTO_HOME/otto-brain, so every
 * child inherits OTTO_HOME (and ELECTRON_RUN_AS_NODE so the daemon's Electron
 * runtime behaves as plain Node).
 */

const READ_TIMEOUT_MS = 60_000;
const STOP_GRACEFUL_TIMEOUT_MS = 5_000;
const MAX_JOB_LOG_CHARS = 4_000;
/** Keep finished jobs around this long so the UI can show the outcome. */
const TERMINAL_JOB_RETAIN_MS = 3 * 60_000;
const MAX_MESSAGE_CHARS = 200;

export interface BrainOpsManagerOptions {
  logger: Logger;
  ottoHome: string;
}

interface JobState {
  id: string;
  kind: BrainJobKind;
  label: string;
  target: string | null;
  status: BrainJob["status"];
  percent: number | null;
  message: string | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  child: ChildProcess | null;
  /** Tail of stderr, kept so a failure can report why. */
  errBuffer: string;
}

export class BrainOpsManager {
  private readonly logger: Logger;
  private readonly ottoHome: string;
  private readonly jobsById = new Map<string, JobState>();

  constructor(options: BrainOpsManagerOptions) {
    this.logger = options.logger.child({ module: "brain-ops-manager" });
    this.ottoHome = options.ottoHome;
  }

  // --- Reads ---------------------------------------------------------------

  /** Installed local models — `otto-brain scan --json`. */
  async scanModels(): Promise<BrainInstalledModel[]> {
    const rows = await this.runJson(["scan", "--json"]);
    return this.parseRows(rows, BrainInstalledModelSchema);
  }

  /** Downloadable catalog with installed flags — `otto-brain catalog --json`. */
  async listCatalog(): Promise<BrainCatalogModel[]> {
    const rows = await this.runJson(["catalog", "--json"]);
    return this.parseRows(rows, BrainCatalogModelSchema);
  }

  /** Installed llama.cpp runtimes — `otto-brain runtime list --json`. */
  async listRuntimes(): Promise<BrainRuntime[]> {
    const rows = await this.runJson(["runtime", "list", "--json"]);
    return this.parseRows(rows, BrainRuntimeSchema);
  }

  // --- Jobs ----------------------------------------------------------------

  /** Download a catalog model. */
  pullModel(model: string): BrainJob {
    return this.startJob({
      kind: "pull",
      target: model,
      label: `Download ${model}`,
      args: ["pull", model, "--json"],
    });
  }

  /** Install a llama.cpp runtime. */
  installRuntime(build: string | null): BrainJob {
    return this.startJob({
      kind: "runtime-install",
      target: build,
      label: build ? `Install runtime (${build})` : "Install llama.cpp runtime",
      args: ["runtime", "install", "--json", ...(build ? ["--build", build] : [])],
    });
  }

  /** Measure real KV bytes/token for a model (needs a runtime + GPU). */
  calibrate(model: string): BrainJob {
    return this.startJob({
      kind: "calibrate",
      target: model,
      label: `Calibrate ${model}`,
      args: ["calibrate", "--model", model, "--json"],
    });
  }

  /** Find the best reasoning budget for a model (needs a runtime + GPU). */
  sweep(model: string): BrainJob {
    return this.startJob({
      kind: "sweep",
      target: model,
      label: `Sweep ${model}`,
      args: ["sweep", "--model", model, "--json"],
    });
  }

  /** Run the agentic-coding benchmark (needs a runtime + GPU). */
  bench(model: string | null): BrainJob {
    return this.startJob({
      kind: "bench",
      target: model,
      label: model ? `Benchmark ${model}` : "Benchmark models",
      // bench is a plain streaming action (no --json); its output is captured
      // as the job's progress message. Results land in the evals dashboard.
      args: ["bench", ...(model ? ["--model", model] : [])],
    });
  }

  /** Active + recently-finished jobs, newest first. Prunes stale terminals. */
  jobs(): BrainJob[] {
    this.pruneTerminalJobs();
    return [...this.jobsById.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((job) => toWire(job));
  }

  /** Cancel a running job (tree-kill its child). Returns the refreshed list. */
  async cancel(jobId: string): Promise<BrainJob[]> {
    const job = this.jobsById.get(jobId);
    if (job && job.status === "running") {
      const child = job.child;
      job.child = null;
      if (child) {
        await terminateWithTreeKill(child, {
          gracefulTimeoutMs: STOP_GRACEFUL_TIMEOUT_MS,
        }).catch(() => undefined);
      }
      // handleExit may already have settled it; only mark canceled if not.
      if (job.status === "running") {
        this.settle(job, "canceled", "Canceled.");
      }
    }
    return this.jobs();
  }

  /** For daemon teardown: kill any in-flight job child. */
  async shutdown(): Promise<void> {
    const running = [...this.jobsById.values()].filter((job) => job.child);
    await Promise.all(
      running.map(async (job) => {
        const child = job.child;
        job.child = null;
        if (child) {
          await terminateWithTreeKill(child, {
            gracefulTimeoutMs: STOP_GRACEFUL_TIMEOUT_MS,
          }).catch(() => undefined);
        }
      }),
    );
  }

  // --- Internals -----------------------------------------------------------

  private startJob(spec: {
    kind: BrainJobKind;
    target: string | null;
    label: string;
    args: string[];
  }): BrainJob {
    const active = [...this.jobsById.values()].find((job) => job.status === "running");
    if (active) {
      throw new Error(
        `Another operation is already running (${active.label}). Wait for it to finish or cancel it first.`,
      );
    }

    const job: JobState = {
      id: `brainjob_${randomUUID()}`,
      kind: spec.kind,
      label: spec.label,
      target: spec.target,
      status: "running",
      percent: null,
      message: null,
      error: null,
      startedAt: Date.now(),
      finishedAt: null,
      child: null,
      errBuffer: "",
    };
    this.jobsById.set(job.id, job);

    let child: ChildProcess;
    try {
      child = this.spawnBrain(spec.args);
    } catch (error) {
      this.settle(job, "failed", null, getMessage(error));
      return toWire(job);
    }
    job.child = child;

    const onProgress = (chunk: Buffer) => this.ingestProgress(job, chunk.toString("utf8"));
    child.stdout?.on("data", onProgress);
    child.stderr?.on("data", onProgress);
    child.on("error", (error) => {
      job.errBuffer = appendTail(job.errBuffer, `[spawn error] ${error.message}\n`);
    });
    child.on("exit", (code, signal) => this.handleExit(job, child, code, signal));

    this.logger.info({ jobId: job.id, kind: job.kind }, "started brain op");
    return toWire(job);
  }

  private handleExit(
    job: JobState,
    child: ChildProcess,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (job.child !== child) {
      return; // Already canceled/replaced.
    }
    job.child = null;
    if (job.status !== "running") {
      return;
    }
    if (code === 0) {
      this.settle(job, "succeeded", job.message ?? "Done.", null, 100);
    } else {
      const detail = extractErrorDetail(job.errBuffer);
      this.settle(
        job,
        "failed",
        null,
        detail ?? `Exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.`,
      );
    }
  }

  private settle(
    job: JobState,
    status: BrainJob["status"],
    message: string | null,
    error: string | null = null,
    percent?: number,
  ): void {
    job.status = status;
    job.finishedAt = Date.now();
    if (message !== null) job.message = truncateMessage(message);
    if (error !== null) job.error = truncateMessage(error);
    if (typeof percent === "number") job.percent = percent;
  }

  // Progress lines arrive on stderr (and, for bench, stdout). We keep the last
  // meaningful line as the message and lift any `<pct>%` into percent.
  private ingestProgress(job: JobState, text: string): void {
    job.errBuffer = appendTail(job.errBuffer, text);
    const lines = text
      .split(/[\r\n]+/u)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      const pctMatch = /(\d{1,3})\s*%/u.exec(line);
      if (pctMatch) {
        const pct = Number.parseInt(pctMatch[1], 10);
        if (Number.isFinite(pct)) {
          job.percent = Math.max(0, Math.min(100, pct));
        }
      }
      job.message = truncateMessage(line);
    }
  }

  private pruneTerminalJobs(): void {
    const now = Date.now();
    for (const [id, job] of this.jobsById) {
      if (
        job.status !== "running" &&
        job.finishedAt !== null &&
        now - job.finishedAt > TERMINAL_JOB_RETAIN_MS
      ) {
        this.jobsById.delete(id);
      }
    }
  }

  private async runJson(args: string[]): Promise<unknown> {
    const { stdout } = await this.runToCompletion(args, READ_TIMEOUT_MS);
    const trimmed = stdout.trim();
    if (!trimmed) {
      return [];
    }
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      throw new Error("The brain CLI returned an unparseable response.");
    }
  }

  private runToCompletion(
    args: string[],
    timeoutMs: number,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = this.spawnBrain(args);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          void terminateWithTreeKill(child, { gracefulTimeoutMs: 1_000 }).catch(() => undefined);
          reject(new Error(`The brain CLI timed out after ${Math.round(timeoutMs / 1000)}s.`));
        }
      }, timeoutMs);
      timer.unref?.();
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr = appendTail(stderr, chunk.toString("utf8"));
      });
      child.on("error", (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      });
      child.on("exit", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          const detail = extractErrorDetail(stderr);
          reject(new Error(detail ?? `The brain CLI exited with code ${code ?? "unknown"}.`));
        }
      });
    });
  }

  private spawnBrain(args: string[]): ChildProcess {
    const binPath = resolveBrainBinPath();
    return spawnProcess(process.execPath, [binPath, ...args], {
      envMode: "internal",
      envOverlay: { OTTO_HOME: this.ottoHome, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  private parseRows<T>(
    rows: unknown,
    schema: { safeParse(v: unknown): { success: boolean; data?: T } },
  ): T[] {
    if (!Array.isArray(rows)) {
      return [];
    }
    const out: T[] = [];
    for (const row of rows) {
      const parsed = schema.safeParse(row);
      if (parsed.success && parsed.data !== undefined) {
        out.push(parsed.data);
      }
    }
    return out;
  }
}

function toWire(job: JobState): BrainJob {
  return {
    id: job.id,
    kind: job.kind,
    label: job.label,
    target: job.target,
    status: job.status,
    percent: job.percent,
    message: job.message,
    error: job.error,
    startedAt: new Date(job.startedAt).toISOString(),
    finishedAt: job.finishedAt !== null ? new Date(job.finishedAt).toISOString() : null,
  };
}

function appendTail(buffer: string, text: string): string {
  const next = buffer + text;
  return next.length > MAX_JOB_LOG_CHARS ? next.slice(next.length - MAX_JOB_LOG_CHARS) : next;
}

function lastMeaningfulLine(text: string): string | null {
  const lines = text
    .split(/[\r\n]+/u)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 ? truncateMessage(lines[lines.length - 1]) : null;
}

// The brain CLI renders errors as JSON (`{ "error": { "message": ... } }`) on
// stderr when called with --json. Pull the message out of that rather than
// reporting the closing brace; fall back to the last plain line otherwise.
function extractErrorDetail(buffer: string): string | null {
  const matches = [...buffer.matchAll(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/gu)];
  const last = matches[matches.length - 1];
  if (last) {
    try {
      return truncateMessage(JSON.parse(`"${last[1]}"`) as string);
    } catch {
      return truncateMessage(last[1]);
    }
  }
  return lastMeaningfulLine(buffer);
}

function truncateMessage(text: string): string {
  return text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}…` : text;
}

function getMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
