/**
 * What long-running work currently owns the brain, and whether the loaded model
 * is mid-reasoning.
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
 * - **Reasoning** is per-request and lives only as long as the stream does, so
 *   it is plain in-process state on the router. It never touches disk.
 *
 * Both feed the one `activity` field on the host status, which the client turns
 * into the Brain rail's icon.
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
  return text.includes("thinking") || text.includes("reasoning");
}

export function chunkHasContent(text: string): boolean {
  return text.includes('"text_delta"') || /"content"\s*:\s*"[^"]/.test(text);
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
 * A set rather than a boolean because llama-server runs several slots at once,
 * and one request finishing its thought must not clear the flag for another.
 */
export class ReasoningTracker {
  #reasoning = new Set<string>();
  #content = new Set<string>();
  #listeners = new Set<() => void>();
  #wasActive = false;

  /**
   * Watch the thinking flag itself, not the per-chunk traffic behind it.
   *
   * The status event stream needs to publish the moment a model goes silent to
   * think and the moment it starts answering - and nothing in between, or a
   * generating model would emit a snapshot per chunk.
   */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #announce(): void {
    const active = this.active;
    if (active === this.#wasActive) return;
    this.#wasActive = active;
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch {
        // Status reporting must never break a proxied completion.
      }
    }
  }

  /** Note a chunk of `requestId`'s stream. Cheap enough to call per chunk. */
  observe(requestId: string, text: string): void {
    if (this.#content.has(requestId)) return;
    if (chunkHasContent(text)) {
      this.#content.add(requestId);
      this.#reasoning.delete(requestId);
      this.#announce();
      return;
    }
    if (chunkHasReasoning(text)) {
      this.#reasoning.add(requestId);
      this.#announce();
    }
  }

  /** Forget the request. Must be called on end *and* on error, or the flag sticks. */
  end(requestId: string): void {
    this.#reasoning.delete(requestId);
    this.#content.delete(requestId);
    this.#announce();
  }

  get active(): boolean {
    return this.#reasoning.size > 0;
  }

  get count(): number {
    return this.#reasoning.size;
  }
}
