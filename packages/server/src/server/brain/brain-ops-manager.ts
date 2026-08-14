import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Logger } from "pino";

import type {
  BrainCatalogModel,
  BrainHfSearchResult,
  BrainInstalledModel,
  BrainJob,
  BrainJobKind,
  BrainRepoQuant,
  BrainRuntime,
} from "@otto-code/protocol/messages";
import {
  BrainCatalogModelSchema,
  BrainHfSearchResultSchema,
  BrainInstalledModelSchema,
  BrainRepoQuantSchema,
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
 *    the client polls jobs() and renders it. Only one job runs at a time - the
 *    ops load models and hold the GPU, while downloads may run concurrently so
 *    users can fetch more than one quant at a time.
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

/**
 * Job output is human-readable and may be chunked arbitrarily. A progress
 * indicator must never move backwards because an incidental percentage in a
 * later status line is not a new byte measurement.
 */
export function advanceJobPercent(current: number | null, text: string): number | null {
  let next = current;
  for (const line of text.split(/[\r\n]+/u)) {
    const pctMatch = /(\d{1,3})\s*%/u.exec(line);
    if (!pctMatch) continue;
    const pct = Number.parseInt(pctMatch[1], 10);
    if (Number.isFinite(pct)) {
      next = Math.max(next ?? 0, Math.max(0, Math.min(100, pct)));
    }
  }
  return next;
}

/** Byte-weighted progress for the primary plus every queued bundle artifact. */
export function aggregatePullPercent(
  completedBytes: number,
  totalBytes: number | null,
  currentBytes: number | null,
  currentPercent: number | null,
): number | null {
  if (totalBytes === null || totalBytes <= 0) return currentPercent;
  const progressed =
    completedBytes +
    (currentPercent === null || currentBytes === null ? 0 : (currentBytes * currentPercent) / 100);
  return Math.max(0, Math.min(100, Math.floor((progressed / totalBytes) * 100)));
}

export interface BrainOpsManagerOptions {
  logger: Logger;
  ottoHome: string;
  /** Persist the runtime chosen by a successfully completed install. */
  onRuntimeInstalled?: (result: { build: string | null; runtime: BrainRuntime }) => void;
  /** Reconcile the running Brain host after this daemon writes model files. */
  onPullCompleted?: () => Promise<void>;
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
  /** The JSON result written by successful runtime installs. */
  outBuffer: string;
  /** Present only for a bundle pull that may gain queued companion files. */
  pull?: PullState;
}

interface PullTask {
  args: string[];
  components: string[];
  /** Bytes newly contributed by this task, when the UI knows the manifest size. */
  expectedBytes: number | null;
}

interface PullState {
  quant: string | null;
  components: Set<string>;
  totalBytes: number | null;
  completedBytes: number;
  current: PullTask;
  queue: PullTask[];
  currentPercent: number | null;
}

export class BrainOpsManager {
  private readonly logger: Logger;
  private readonly ottoHome: string;
  private readonly onRuntimeInstalled: BrainOpsManagerOptions["onRuntimeInstalled"];
  private readonly onPullCompleted: BrainOpsManagerOptions["onPullCompleted"];
  private readonly jobsById = new Map<string, JobState>();

  constructor(options: BrainOpsManagerOptions) {
    this.logger = options.logger.child({ module: "brain-ops-manager" });
    this.ottoHome = options.ottoHome;
    this.onRuntimeInstalled = options.onRuntimeInstalled;
    this.onPullCompleted = options.onPullCompleted;
  }

  // --- Reads ---------------------------------------------------------------

  /** Installed local models - `otto-brain scan --json`. */
  async scanModels(): Promise<BrainInstalledModel[]> {
    const rows = await this.runJson(["scan", "--json"]);
    return this.parseRows(rows, BrainInstalledModelSchema);
  }

  /** Downloadable catalog with installed flags - `otto-brain catalog --json`. */
  async listCatalog(): Promise<BrainCatalogModel[]> {
    const rows = await this.runJson(["catalog", "--json"]);
    return this.parseRows(rows, BrainCatalogModelSchema);
  }

  /** Installed llama.cpp runtimes - `otto-brain runtime list --json`. */
  async listRuntimes(): Promise<BrainRuntime[]> {
    const rows = await this.runJson(["runtime", "list", "--json"]);
    return this.parseRows(rows, BrainRuntimeSchema);
  }

  /** Search Hugging Face for GGUF models - `otto-brain search <query> --json`. */
  async searchHf(query: string, limit: number | null): Promise<BrainHfSearchResult[]> {
    if (!query.trim()) {
      return [];
    }
    // Options first, then `--` so a query starting with `-` is a positional, not
    // parsed as an (unknown) option.
    const args = ["search", "--json"];
    if (limit) {
      args.push("--limit", String(limit));
    }
    args.push("--", query);
    const rows = await this.runJson(args);
    if (!Array.isArray(rows)) {
      return [];
    }
    // The CLI renders `gated` as a string for its table; coerce to the protocol's
    // boolean here rather than leaking the display shape across the wire.
    const out: BrainHfSearchResult[] = [];
    for (const row of rows) {
      const r = row as {
        repo?: unknown;
        downloads?: unknown;
        likes?: unknown;
        gated?: unknown;
        installed?: unknown;
        summary?: unknown;
      };
      const parsed = BrainHfSearchResultSchema.safeParse({
        repo: typeof r.repo === "string" ? r.repo : "",
        downloads: typeof r.downloads === "number" ? r.downloads : 0,
        likes: typeof r.likes === "number" ? r.likes : 0,
        gated: r.gated === true || r.gated === "yes",
        installed: r.installed === true,
        summary: typeof r.summary === "string" ? r.summary : null,
      });
      if (parsed.success) {
        out.push(parsed.data);
      }
    }
    return out;
  }

  /** Quantizations a repo offers - `otto-brain add <repo> --list-quants --json`. */
  async repoQuants(repo: string): Promise<BrainRepoQuant[]> {
    if (!repo.trim()) {
      return [];
    }
    const rows = await this.runJson(["add", "--list-quants", "--json", "--", repo]);
    return this.parseRows(rows, BrainRepoQuantSchema);
  }

  // --- Jobs ----------------------------------------------------------------

  /** Download a catalog model. */
  pullModel(
    model: string,
    components: string[] = [],
    quant?: string,
    expectedBytes?: number,
  ): BrainJob {
    if (!model.trim()) {
      throw new Error("A model is required.");
    }
    const args = [
      "pull",
      ...(quant ? ["--quant", optionValue("quant", quant)] : []),
      ...components.flatMap((component) => ["--component", optionValue("component", component)]),
      "--json",
      "--",
      model,
    ];
    return this.startOrAppendPull({
      kind: "pull",
      target: model,
      label: `Download ${model}`,
      args,
      queuedArgs: (newComponents) => [
        "pull",
        ...(quant ? ["--quant", optionValue("quant", quant)] : []),
        "--components-only",
        ...newComponents.flatMap((component) => [
          "--component",
          optionValue("component", component),
        ]),
        "--json",
        "--",
        model,
      ],
      quant: quant ?? null,
      components,
      expectedBytes: expectedBytes ?? null,
    });
  }

  /** Download a chosen quant of an arbitrary HF repo (a `pull` job). */
  addModel(repo: string, quant: string, components?: string[], expectedBytes?: number): BrainJob {
    // An empty quant makes the CLI list quants instead of downloading, so the job
    // would report success while writing nothing - reject it up front.
    if (!repo.trim() || !quant.trim()) {
      throw new Error("A repo and a quant are required.");
    }
    const selectedComponents = components ?? [];
    return this.startOrAppendPull({
      kind: "pull",
      target: `${repo}#${quant}`,
      label: `Add ${repo} (${quant})`,
      args: [
        "add",
        "--quant",
        optionValue("quant", quant),
        ...(components === undefined ? [] : ["--primary-only"]),
        ...selectedComponents.flatMap((component) => [
          "--component",
          optionValue("component", component),
        ]),
        "--json",
        "--",
        repo,
      ],
      queuedArgs: (newComponents) => [
        "add",
        "--quant",
        optionValue("quant", quant),
        "--components-only",
        ...newComponents.flatMap((component) => [
          "--component",
          optionValue("component", component),
        ]),
        "--json",
        "--",
        repo,
      ],
      quant,
      components: selectedComponents,
      expectedBytes: expectedBytes ?? null,
    });
  }

  /** Install a llama.cpp runtime. */
  installRuntime(build: string | null): BrainJob {
    // A managed install from the UI is an update request, not a request to
    // reproduce the package's fallback pin. The brain CLI resolves "latest"
    // against upstream at install time - and falls back to its pinned build when
    // that lookup or that build's assets fail - while the completed job still
    // selects the runtime through the automatic policy in bootstrap.
    const requestedBuild = build ?? "latest";
    return this.startJob({
      kind: "runtime-install",
      target: requestedBuild,
      label: build ? `Install runtime (${build})` : "Install latest llama.cpp runtime",
      args: ["runtime", "install", "--json", "--build", optionValue("build", requestedBuild)],
    });
  }

  /** Remove an Otto-managed runtime through the same tracked operations lane. */
  removeRuntime(name: string): BrainJob {
    return this.startJob({
      kind: "runtime-remove",
      target: name,
      label: `Remove runtime (${name})`,
      // `--` so a name starting with `-` is the positional argument it is meant
      // to be, rather than an unknown option the CLI rejects.
      args: ["runtime", "remove", "--json", "--", name],
    });
  }

  /** Measure real KV bytes/token for a model (needs a runtime + GPU). */
  calibrate(model: string): BrainJob {
    return this.startJob({
      kind: "calibrate",
      target: model,
      label: `Calibrate ${model}`,
      args: ["calibrate", "--model", optionValue("model", model), "--json"],
    });
  }

  /** Find the best reasoning budget for a model (needs a runtime + GPU). */
  sweep(model: string): BrainJob {
    return this.startJob({
      kind: "sweep",
      target: model,
      label: `Sweep ${model}`,
      args: ["sweep", "--model", optionValue("model", model), "--json"],
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
      args: ["bench", ...(model ? ["--model", optionValue("model", model)] : [])],
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

  private startJob(
    spec: {
      kind: BrainJobKind;
      target: string | null;
      label: string;
      args: string[];
    },
    pull?: PullState,
  ): BrainJob {
    const active = [...this.jobsById.values()].find((job) => job.status === "running");
    const isDownload = spec.kind === "pull";
    const activeNonDownload = [...this.jobsById.values()].find(
      (job) => job.status === "running" && job.kind !== "pull",
    );
    const conflict = isDownload ? activeNonDownload : active;
    if (conflict) {
      throw new Error(
        `Another operation is already running (${conflict.label}). Wait for it to finish or cancel it first.`,
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
      outBuffer: "",
      ...(pull ? { pull } : {}),
    };
    this.jobsById.set(job.id, job);

    this.spawnJobChild(job, spec.args);
    return toWire(job);
  }

  /**
   * A bundle is one user-visible job. Once its primary transfer is underway,
   * later bundle choices become component-only child transfers behind it. This
   * leaves the active network stream alone and gives the ring one aggregate
   * byte budget instead of a collection of competing progress indicators.
   */
  private startOrAppendPull(spec: {
    kind: "pull";
    target: string;
    label: string;
    args: string[];
    queuedArgs: (components: string[]) => string[];
    quant: string | null;
    components: string[];
    expectedBytes: number | null;
  }): BrainJob {
    const existing = [...this.jobsById.values()].find(
      (job) =>
        job.kind === "pull" &&
        job.status === "running" &&
        job.target === spec.target &&
        job.pull?.quant === spec.quant,
    );
    if (!existing?.pull) {
      return this.startJob(spec, {
        quant: spec.quant,
        components: new Set(spec.components),
        totalBytes: spec.expectedBytes,
        completedBytes: 0,
        current: {
          args: spec.args,
          components: spec.components,
          expectedBytes: spec.expectedBytes,
        },
        queue: [],
        currentPercent: null,
      });
    }

    const newComponents = spec.components.filter(
      (component) => !existing.pull!.components.has(component),
    );
    if (newComponents.length === 0) return toWire(existing);

    for (const component of newComponents) existing.pull.components.add(component);
    const previousTotal = existing.pull.totalBytes;
    if (spec.expectedBytes !== null) {
      existing.pull.totalBytes = Math.max(previousTotal ?? 0, spec.expectedBytes);
    }
    const addedBytes =
      previousTotal !== null && existing.pull.totalBytes !== null
        ? Math.max(0, existing.pull.totalBytes - previousTotal)
        : null;
    existing.pull.queue.push({
      args: spec.queuedArgs(newComponents),
      components: newComponents,
      expectedBytes: addedBytes,
    });
    this.updatePullPercent(existing);
    this.logger.info(
      { jobId: existing.id, target: existing.target, components: newComponents },
      "queued bundle components behind active download",
    );
    return toWire(existing);
  }

  private spawnJobChild(job: JobState, args: string[]): void {
    let child: ChildProcess;
    try {
      child = this.spawnBrain(args);
    } catch (error) {
      this.settle(job, "failed", null, getMessage(error));
      return;
    }
    job.child = child;

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      job.outBuffer = appendTail(job.outBuffer, text);
      this.ingestProgress(job, text);
    });
    child.stderr?.on("data", (chunk: Buffer) => this.ingestProgress(job, chunk.toString("utf8")));
    child.on("error", (error) => {
      job.errBuffer = appendTail(job.errBuffer, `[spawn error] ${error.message}\n`);
    });
    child.on("exit", (code, signal) => {
      void this.handleExit(job, child, code, signal);
    });

    this.logger.info({ jobId: job.id, kind: job.kind }, "started brain op");
  }

  private async handleExit(
    job: JobState,
    child: ChildProcess,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): Promise<void> {
    if (job.child !== child) {
      return; // Already canceled/replaced.
    }
    job.child = null;
    if (job.status !== "running") {
      return;
    }
    if (code === 0) {
      if (job.kind === "pull" && job.pull) {
        const completed = job.pull.current;
        job.pull.completedBytes += completed.expectedBytes ?? 0;
        const next = job.pull.queue.shift();
        if (next) {
          job.pull.current = next;
          job.pull.currentPercent = null;
          job.message = `Queued ${next.components.join(", ")}…`;
          this.updatePullPercent(job);
          this.spawnJobChild(job, next.args);
          return;
        }
      }
      if (job.kind === "runtime-install") {
        const runtime = parseInstalledRuntime(job.outBuffer);
        if (runtime) {
          try {
            this.onRuntimeInstalled?.({ build: job.target, runtime });
          } catch (error) {
            this.logger.error({ err: error, jobId: job.id }, "Failed to select installed runtime");
            this.settle(job, "failed", null, "Runtime installed, but Otto could not select it.");
            return;
          }
        } else {
          this.logger.warn(
            { jobId: job.id, stdout: job.outBuffer },
            "Runtime install returned no runtime",
          );
          this.settle(job, "failed", null, "Runtime installed, but Otto could not identify it.");
          return;
        }
      }
      if (job.kind === "pull" && this.onPullCompleted) {
        try {
          await this.onPullCompleted();
        } catch (error) {
          this.logger.error(
            { err: error, jobId: job.id },
            "Failed to refresh Brain inventory after pull",
          );
          this.settle(
            job,
            "failed",
            null,
            `Download completed, but Otto could not refresh the Brain inventory: ${getMessage(error)}`,
          );
          return;
        }
      }
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
    // A canceled/failed job is terminal: buffered stdout/stderr that arrives after
    // the child was killed must not overwrite the terminal message/percent.
    if (job.status !== "running") {
      return;
    }
    job.errBuffer = appendTail(job.errBuffer, text);
    if (job.pull) {
      job.pull.currentPercent = advanceJobPercent(job.pull.currentPercent, text);
      this.updatePullPercent(job);
    } else {
      job.percent = advanceJobPercent(job.percent, text);
    }
    const lines = text
      .split(/[\r\n]+/u)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      // `bench` prints "=".repeat(74) rules around each model's section
      // header - a divider carries no information on its own, so keeping it
      // out of `message` means the surrounding line (the model name, a phase,
      // a percentage) survives as what the client actually shows.
      if (/^=+$/u.test(line)) {
        continue;
      }
      job.message = truncateMessage(line);
    }
  }

  private updatePullPercent(job: JobState): void {
    const pull = job.pull;
    if (!pull) return;
    job.percent = aggregatePullPercent(
      pull.completedBytes,
      pull.totalBytes,
      pull.current.expectedBytes,
      pull.currentPercent,
    );
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

/**
 * Reject a client value that would be read as a flag rather than as a value.
 *
 * An option value has to sit before the `--` separator by construction - the
 * separator only ends *positional* parsing - so unlike `model` and `repo` these
 * cannot be moved out of harm's way, and the argv is unambiguous only if the
 * value itself is. Commander already refuses a leading-dash value with an
 * unhelpful "argument missing"; this names the real problem instead.
 */
function optionValue(label: string, value: string): string {
  if (value.startsWith("-")) {
    throw new Error(`A ${label} must not start with "-".`);
  }
  return value;
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

function parseInstalledRuntime(stdout: string): BrainRuntime | null {
  try {
    const parsed = BrainRuntimeSchema.safeParse(JSON.parse(stdout) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function truncateMessage(text: string): string {
  return text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}…` : text;
}

function getMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
