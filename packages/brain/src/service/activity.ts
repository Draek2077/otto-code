/**
 * What long-running work currently owns the brain, and which stage each live
 * inference request has reached.
 *
 * Two trackers with deliberately different lifetimes:
 *
 * - **Ops** (`calibrate`, `sweep`, `benchmark`, `pull`, `scan`) run in their own
 *   CLI process. The service answering `/__host/status` is a different process
 *   and cannot see them, so the op announces itself through a small file under
 *   `$OTTO_HOME/otto-brain/`, the same way `pid-lock.ts` publishes the service
 *   itself. Staleness is decided by probing the recorded pid: a `calibrate` that
 *   was killed with Ctrl-C never gets to clean up after itself, and a status
 *   that stays stuck on "calibrating" forever is worse than no status at all.
 *
 * - **Inference** is per-request and lives only as long as the stream does, so
 *   it is plain in-process state on the router. It never touches disk.
 *
 * Both ride on host status: ops under `activity`, inference under `inference`.
 * The client uses those independent signals to drive the Overview and rail.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";

import { resolveBrainPaths } from "../config/paths.js";
import { writePrivateFileAtomicSync } from "../config/private-files.js";
import { isProcessAlive } from "./pid-lock.js";

/** The long-running ops worth reporting. Anything else is not worth a state. */
export type BrainActivityKind = "calibrate" | "sweep" | "benchmark" | "download" | "scan";

const ACTIVITY_KINDS = new Set<string>(["calibrate", "sweep", "benchmark", "download", "scan"]);

export interface BrainActivityRecord {
  kind: BrainActivityKind;
  /** The process running the op, so a crashed op does not pin the status. */
  pid: number;
  /** What it is working on - a model id, usually. Shown in the tooltip. */
  target: string | null;
  /** Completion in [0,1], for ops that can measure it. Null when they cannot. */
  progress: number | null;
  startedAt: string;
}

export interface BrainActivityHandle {
  /** Publish progress. Throttled: this is a disk write on a hot loop otherwise. */
  update(progress: number | null): void;
  /** Clear the record. Safe to call more than once. */
  end(): void;
}

/** How often progress may reach the disk. */
const PROGRESS_WRITE_INTERVAL_MS = 1000;

/**
 * Announce that this process has started a long-running op.
 *
 * Deliberately last-writer-wins rather than refusing when a record already
 * exists: two ops at once is a real (if unwise) thing to do, the newer one is
 * the more interesting answer, and a failed announce must never be a reason for
 * the op itself to fail.
 */
export function beginActivity(
  kind: BrainActivityKind,
  options: { target?: string | null; env?: NodeJS.ProcessEnv } = {},
): BrainActivityHandle {
  const env = options.env ?? process.env;
  const record: BrainActivityRecord = {
    kind,
    pid: process.pid,
    target: options.target ?? null,
    progress: null,
    startedAt: new Date().toISOString(),
  };
  writeActivity(record, env);

  let lastWriteMs = Date.now();
  let ended = false;

  return {
    update(progress: number | null) {
      if (ended) return;
      const now = Date.now();
      if (now - lastWriteMs < PROGRESS_WRITE_INTERVAL_MS) return;
      lastWriteMs = now;
      record.progress = clampProgress(progress);
      writeActivity(record, env);
    },
    end() {
      if (ended) return;
      ended = true;
      // Only clear a record this process owns. An op that outlived us - or a
      // newer one that overwrote ours - must keep reporting.
      const current = readActivityFile(env);
      if (current && current.pid !== process.pid) return;
      clearActivity(env);
    },
  };
}

/**
 * The op currently owning the host, or null.
 *
 * Clears the record as a side effect when the process behind it is gone, so a
 * killed op self-heals on the next status poll rather than needing a restart.
 */
export function readActivity(env: NodeJS.ProcessEnv = process.env): BrainActivityRecord | null {
  const record = readActivityFile(env);
  if (!record) return null;
  if (!isProcessAlive(record.pid)) {
    clearActivity(env);
    return null;
  }
  return record;
}

export function clearActivity(env: NodeJS.ProcessEnv = process.env): void {
  const { activityFile } = resolveBrainPaths(env);
  rmSync(activityFile, { force: true });
}

/**
 * Run `fn` with the op announced, clearing the record however it finishes.
 *
 * The announce is never allowed to break the op: this is status reporting, and
 * a read-only home directory is not a reason for a benchmark to fail.
 */
export async function withActivity<T>(
  kind: BrainActivityKind,
  options: { target?: string | null; env?: NodeJS.ProcessEnv },
  fn: (handle: BrainActivityHandle) => Promise<T>,
): Promise<T> {
  let handle: BrainActivityHandle;
  try {
    handle = beginActivity(kind, options);
  } catch {
    handle = { update() {}, end() {} };
  }
  try {
    return await fn(handle);
  } finally {
    try {
      handle.end();
    } catch {
      // Ignore: see above.
    }
  }
}

function writeActivity(record: BrainActivityRecord, env: NodeJS.ProcessEnv): void {
  const { activityFile } = resolveBrainPaths(env);
  writePrivateFileAtomicSync(activityFile, `${JSON.stringify(record, null, 2)}\n`);
}

function readActivityFile(env: NodeJS.ProcessEnv): BrainActivityRecord | null {
  const { activityFile } = resolveBrainPaths(env);
  if (!existsSync(activityFile)) return null;
  try {
    const parsed = JSON.parse(readFileSync(activityFile, "utf8")) as Partial<BrainActivityRecord>;
    if (!isActivityKind(parsed.kind) || typeof parsed.pid !== "number") return null;
    return {
      kind: parsed.kind,
      pid: parsed.pid,
      target: typeof parsed.target === "string" ? parsed.target : null,
      progress: clampProgress(parsed.progress ?? null),
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function isActivityKind(value: unknown): value is BrainActivityKind {
  return typeof value === "string" && ACTIVITY_KINDS.has(value);
}

function clampProgress(progress: number | null | undefined): number | null {
  if (typeof progress !== "number" || !Number.isFinite(progress)) return null;
  return Math.min(1, Math.max(0, progress));
}

/**
 * Whether a streamed chunk carries reasoning, and whether it carries content.
 *
 * These are the router's own predicates, lifted out so the live flag and the
 * end-of-stream `reasoning-only` verdict cannot drift apart. They are
 * deliberately crude substring tests over the raw SSE bytes: the brain proxies
 * both the Anthropic and the OpenAI shapes, chunk boundaries fall wherever the
 * network puts them, and parsing partial JSON per chunk on the hot proxy path
 * would cost more than the signal is worth.
 */
export function chunkHasReasoning(text: string): boolean {
  return (
    /"type"\s*:\s*"(?:thinking|reasoning)_delta"/u.test(text) ||
    /"(?:thinking|reasoning_content)"\s*:\s*"[^"]/u.test(text)
  );
}

export function chunkHasContent(text: string): boolean {
  return (
    /"type"\s*:\s*"text_delta"/u.test(text) ||
    /"content"\s*:\s*"[^"]/u.test(text) ||
    /"tool_calls"\s*:\s*\[\s*\{/u.test(text) ||
    /"type"\s*:\s*"(?:tool_use|input_json_delta)"/u.test(text)
  );
}

export type InferenceStage = "processing" | "thinking" | "generating";

export interface InferenceActivitySnapshot {
  activeRequests: number;
  processing: number;
  thinking: number;
  generating: number;
}

/**
 * Which in-flight completions are currently mid-thought.
 *
 * A request counts as thinking once reasoning has gone past and before any
 * content has: that is the window where the model is working and the user has
 * nothing to read yet, which is exactly what the rail's "thinking" state is
 * claiming. The moment content starts the request is generating instead, even
 * if more reasoning follows - a stream that is producing readable output should
 * not report as though it were still silent.
 *
 * A map rather than one global phase because llama-server runs several slots at
 * once. One request can be processing a prompt while another thinks and a third
 * generates content; the aggregate counts must preserve all three.
 */
export class ReasoningTracker {
  #requests = new Map<string, InferenceStage>();
  /** Tail of the last transport chunk, so a field name split by TCP is still detected. */
  #tails = new Map<string, string>();
  /** Models/runtimes that leave reasoning inline as `<think>…</think>`. */
  #inlineReasoning = new Set<string>();
  #listeners = new Set<() => void>();
  #lastSnapshot = "0:0:0:0";

  /**
   * Watch stage counts, not the per-chunk traffic behind them.
   *
   * The status event stream needs to publish request start, the moment a model
   * goes silent to think and the moment it starts answering. Repeated chunks in
   * one stage do not notify; slot sampling owns bounded token-rate updates.
   */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #announce(): void {
    const snapshot = this.snapshot;
    const key = `${snapshot.activeRequests}:${snapshot.processing}:${snapshot.thinking}:${snapshot.generating}`;
    if (key === this.#lastSnapshot) return;
    this.#lastSnapshot = key;
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch {
        // Status reporting must never break a proxied completion.
      }
    }
  }

  /** A completion was dispatched to llama-server and awaits its first output delta. */
  begin(requestId: string): void {
    if (this.#requests.has(requestId)) return;
    this.#requests.set(requestId, "processing");
    this.#announce();
  }

  /** Note a chunk of `requestId`'s stream. Cheap enough to call per chunk. */
  observe(requestId: string, text: string): void {
    const current = this.#requests.get(requestId);
    if (current === "generating") return;
    if (!current) this.#requests.set(requestId, "processing");

    // Node can split an SSE JSON field name at any byte. Keeping a small tail
    // makes stage recognition independent of transport chunk boundaries without
    // parsing or retaining the generated content itself.
    const combined = `${this.#tails.get(requestId) ?? ""}${text}`;
    this.#tails.set(requestId, combined.slice(-128));
    if (this.#inlineReasoning.has(requestId)) {
      if (combined.includes("</think>")) {
        this.#inlineReasoning.delete(requestId);
        this.#requests.set(requestId, "generating");
        this.#announce();
      }
      return;
    }
    if (combined.includes("<think>")) {
      this.#inlineReasoning.add(requestId);
      this.#requests.set(requestId, "thinking");
      this.#announce();
      return;
    }
    if (chunkHasContent(combined)) {
      this.#requests.set(requestId, "generating");
      this.#announce();
      return;
    }
    if (chunkHasReasoning(combined) && current !== "thinking") {
      this.#requests.set(requestId, "thinking");
      this.#announce();
    }
  }

  /** Forget the request. Must be called on end *and* on error, or the flag sticks. */
  end(requestId: string): void {
    this.#requests.delete(requestId);
    this.#tails.delete(requestId);
    this.#inlineReasoning.delete(requestId);
    this.#announce();
  }

  get active(): boolean {
    return this.snapshot.thinking > 0;
  }

  get count(): number {
    return this.snapshot.thinking;
  }

  /** Aggregate request stages. Counts stay exact even with several parallel slots. */
  get snapshot(): InferenceActivitySnapshot {
    const result: InferenceActivitySnapshot = {
      activeRequests: this.#requests.size,
      processing: 0,
      thinking: 0,
      generating: 0,
    };
    for (const stage of this.#requests.values()) result[stage] += 1;
    return result;
  }
}
