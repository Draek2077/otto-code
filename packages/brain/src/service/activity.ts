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
  /**
   * Per-slot stage join, present only when at least one tracked request was
   * pinned to a llama-server slot by the router (host API v3). Keys are the
   * engine's slot ids as reported by `/slots`; values are that request's
   * proxy-side stage. Absent (not just empty) on brains that predate the join,
   * which is how an old client tells "no join data" from "no pinned requests".
   */
  slotStages?: Record<string, InferenceStage>;
}

/**
 * A caller's exclusive claim on one tracked request.
 *
 * Handed out by `ReasoningTracker.begin` and released exactly once. Releasing
 * is terminal: every method on a released lease is a no-op, so a chunk that
 * arrives after the client has gone cannot revive the request it names. That is
 * not a theoretical concern - it is the shape of the bug this type exists to
 * make impossible (see `begin`).
 */
export interface InferenceLease {
  /** This request's id, for logs and for joining to an engine slot. */
  readonly id: string;
  observe(text: string): void;
  setSlot(slotId: number): void;
  /** Idempotent, and safe to call from every branch that can end a stream. */
  end(): void;
}

/** What the engine says about itself, for `ReasoningTracker.reconcile`. */
export interface EngineSlotTruth {
  /**
   * Slot ids llama-server reports as actively processing, or null when this
   * build reports a count but no per-slot rows. Null demotes every request to
   * the conservative unpinned rule.
   */
  busySlots: ReadonlySet<number> | null;
  /** How many slots are busy, or null when the sample failed - which reaps nothing. */
  busyCount: number | null;
}

/** One request the reaper cleared, and the evidence worth logging about it. */
export interface ReapedRequest {
  id: string;
  stage: InferenceStage;
  slotId: number | null;
  ageMs: number;
}

/** Everything known about one in-flight request. */
interface RequestState {
  stage: InferenceStage;
  /** The engine slot this request was pinned to at dispatch, when it was. */
  slotId: number | null;
  /** Tail of the last transport chunk, so a field name split by TCP is still detected. */
  tail: string;
  /** This runtime leaves reasoning inline as `<think>...</think>`. */
  inlineReasoning: boolean;
  startedAt: number;
  /** The last chunk, pin, or dispatch. Recent activity is proof of life. */
  lastSignalAt: number;
  /** Consecutive samples in which the engine has contradicted this request. */
  strikes: number;
}

/**
 * How long a request may be silent before the reaper will consider it at all.
 *
 * Long enough to cover the gap between proxy dispatch and llama-server picking
 * the task up, which is the one window where a healthy request and an idle
 * engine legitimately coexist.
 */
const INFERENCE_QUIET_MS = 5_000;

/**
 * How many consecutive contradicting samples clear a request.
 *
 * More than one because a single sample can catch a real dispatch mid-flight;
 * small because the status sampler runs about once a second while anything
 * claims to be busy, so a genuine leak is gone in seconds rather than surviving
 * until someone restarts the service.
 */
const INFERENCE_STRIKES = 3;

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
  #requests = new Map<string, RequestState>();
  #listeners = new Set<() => void>();
  #lastSnapshot = "";
  #counter = 0;

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
    // The slot join rides in the key too: pinning a request to a slot is a
    // state change even when no stage count moves, and it is the field the
    // Overview rows read. The map is bounded by concurrency, so the digest is
    // cheap enough to build on every announce.
    const slotKey = snapshot.slotStages
      ? Object.entries(snapshot.slotStages)
          .map(([slot, stage]) => `${slot}:${stage}`)
          .sort()
          .join(",")
      : "";
    const key = `${snapshot.activeRequests}:${snapshot.processing}:${snapshot.thinking}:${snapshot.generating}:${slotKey}`;
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

  /**
   * Open a lease for a completion that has just been dispatched to
   * llama-server and awaits its first output delta.
   *
   * A lease rather than an id the caller carries around, because every stuck
   * "thinking" this tracker has produced was a release that did not happen on
   * some branch of the proxy's event wiring. A lease makes both halves of that
   * bug unrepresentable: nothing can advance a request without holding its
   * lease, and a released lease is inert, so a chunk that lands after the
   * release cannot resurrect the request it belongs to. (The same shape as
   * `beginActivity` above, for the same reason.)
   *
   * Ids are minted here rather than by the caller: two callers sharing one id
   * would silently share one request's state.
   */
  begin(): InferenceLease {
    this.#counter += 1;
    const id = `s${this.#counter}`;
    const now = Date.now();
    this.#requests.set(id, {
      stage: "processing",
      slotId: null,
      tail: "",
      inlineReasoning: false,
      startedAt: now,
      lastSignalAt: now,
      strikes: 0,
    });
    this.#announce();

    let open = true;
    return {
      id,
      observe: (text: string) => {
        if (!open) return;
        this.#observe(id, text);
      },
      setSlot: (slotId: number) => {
        if (!open) return;
        this.#setSlot(id, slotId);
      },
      end: () => {
        if (!open) return;
        open = false;
        this.#drop([id]);
      },
    };
  }

  /**
   * Record the engine slot this request was pinned to. Called at dispatch: the
   * pin is injected into the outbound body before the request goes out, so the
   * association exists before the first chunk and `observe` never has to learn
   * about it.
   *
   * The pin is also the reaper's best evidence. A pinned request can be checked
   * against the one engine row that would be busy if it were really running,
   * which is what lets a leak be cleared while other chats keep working.
   */
  #setSlot(id: string, slotId: number): void {
    if (!Number.isInteger(slotId) || slotId < 0) return;
    const state = this.#requests.get(id);
    if (!state || state.slotId === slotId) return;
    state.slotId = slotId;
    this.#touch(state);
    this.#announce();
  }

  /** Note a chunk of this request's stream. Cheap enough to call per chunk. */
  #observe(id: string, text: string): void {
    const state = this.#requests.get(id);
    if (!state) return;
    this.#touch(state);
    if (state.stage === "generating") return;

    // Node can split an SSE JSON field name at any byte. Keeping a small tail
    // makes stage recognition independent of transport chunk boundaries without
    // parsing or retaining the generated content itself.
    const combined = `${state.tail}${text}`;
    state.tail = combined.slice(-128);
    if (state.inlineReasoning) {
      if (combined.includes("</think>")) {
        state.inlineReasoning = false;
        state.stage = "generating";
        this.#announce();
      }
      return;
    }
    if (combined.includes("<think>")) {
      state.inlineReasoning = true;
      state.stage = "thinking";
      this.#announce();
      return;
    }
    if (chunkHasContent(combined)) {
      state.stage = "generating";
      this.#announce();
      return;
    }
    if (chunkHasReasoning(combined) && state.stage !== "thinking") {
      state.stage = "thinking";
      this.#announce();
    }
  }

  /** Any sign of life resets the reaper's case against a request. */
  #touch(state: RequestState): void {
    state.lastSignalAt = Date.now();
    state.strikes = 0;
  }

  #drop(ids: readonly string[]): void {
    let removed = false;
    for (const id of ids) removed = this.#requests.delete(id) || removed;
    if (removed) this.#announce();
  }

  /**
   * Forget every slot pin, because the engine's slots did not survive its
   * relaunch.
   *
   * The mirror of `Scheduler.forgetSlots`, and required for the same reason: a
   * pin that outlives the process it named is no longer evidence. Worse than
   * useless, in fact - a stale pin can collide with a NEW request's slot id,
   * and the reaper would read that unrelated busy row as proof the dead request
   * is still alive. Dropping the pins demotes those requests to the
   * conservative unpinned rule, which clears them once the engine is quiet.
   */
  forgetSlots(): void {
    let changed = false;
    for (const state of this.#requests.values()) {
      if (state.slotId === null) continue;
      state.slotId = null;
      changed = true;
    }
    if (changed) this.#announce();
  }

  /**
   * Drop tracked requests the engine's own account of itself contradicts.
   *
   * The safety net under the lease, and it exists because `active` outranks
   * every engine signal on the rail: one release that never happened claims
   * "thinking" until the service restarts. The ops tracker already refuses that
   * bargain by probing the recorded pid, on the principle that a status stuck
   * on "calibrating" forever is worse than no status at all. This is the
   * inference half of the same rule.
   *
   * **It must never clear valid work**, so it acts only on positive evidence,
   * and only on evidence a live request could not produce:
   *
   *  1. A request that has sent a chunk (or been pinned, or been dispatched)
   *     within `INFERENCE_QUIET_MS` is alive. A streaming request is therefore
   *     never a candidate at all, whatever the engine says this instant.
   *  2. A PINNED request is checked against its own slot. llama-server marks a
   *     slot processing for the whole task, prefill included, so a request that
   *     is genuinely running makes its row busy. That row being idle is the
   *     contradiction. This is what lets one chat's leak be cleared while
   *     another chat keeps generating.
   *  3. An UNPINNED request - or any request when the engine reports no
   *     per-slot rows - cannot be attributed to a row, so it is cleared only
   *     when the engine reports nothing running at all. Ambiguity is not
   *     evidence.
   *  4. The contradiction has to hold for `INFERENCE_STRIKES` samples in a row.
   *     A single sample can race the dispatch window, where a request has been
   *     begun and the engine has not picked it up yet; a run of them cannot.
   *
   * A failed slot sample is not evidence either, and reconciles nothing.
   *
   * Returns what it reaped, so the caller can log a leak rather than silently
   * paper over it.
   */
  reconcile(truth: EngineSlotTruth): ReapedRequest[] {
    if (truth.busyCount === null) return [];
    const now = Date.now();
    const quietBefore = now - INFERENCE_QUIET_MS;
    const reaped: ReapedRequest[] = [];
    for (const [id, state] of this.#requests) {
      if (state.lastSignalAt > quietBefore) {
        state.strikes = 0;
        continue;
      }
      const contradicted =
        state.slotId !== null && truth.busySlots
          ? !truth.busySlots.has(state.slotId)
          : truth.busyCount === 0;
      if (!contradicted) {
        state.strikes = 0;
        continue;
      }
      state.strikes += 1;
      if (state.strikes < INFERENCE_STRIKES) continue;
      reaped.push({
        id,
        stage: state.stage,
        slotId: state.slotId,
        ageMs: now - state.startedAt,
      });
    }
    this.#drop(reaped.map((entry) => entry.id));
    return reaped;
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
    let slotStages: Record<string, InferenceStage> | undefined;
    for (const state of this.#requests.values()) {
      result[state.stage] += 1;
      if (state.slotId === null) continue;
      (slotStages ??= {})[String(state.slotId)] = state.stage;
    }
    if (slotStages) result.slotStages = slotStages;
    return result;
  }
}
