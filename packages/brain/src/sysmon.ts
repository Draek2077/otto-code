import os from "node:os";
import http from "node:http";

import { query } from "./gpu.js";

/**
 * Live system telemetry for the UI: CPU, system RAM, GPU, and how many
 * inference slots are actually busy.
 *
 * Slot state comes from llama-server's own `/slots` endpoint rather than being
 * inferred from request counting, so it reflects what the engine is really
 * doing. That matters for agentic use: several concurrent requests are only
 * genuinely parallel if there are free slots to take them, and slots share one
 * KV pool - so more concurrency costs context per request.
 */

/** A CPU busy-fraction sampler: returns the fraction in [0,1], or null. */
export interface CpuSampler {
  (): number | null;
}

/**
 * Slot occupancy from the running server.
 *
 * `busy` is the sum of `prefill` and `decode`. The split matters because the two
 * phases feel completely different from outside: prefill is a single batched
 * pass over the prompt that pins the GPU and returns nothing, decode is the
 * token-at-a-time stream. A UI that can only say "busy" cannot tell a long
 * prompt being ingested from a model that has started answering.
 */
export interface SlotInfo {
  total: number;
  busy: number;
  idle: number;
  /** Slots ingesting a prompt: processing, but not a single token emitted yet. */
  prefill: number;
  /** Slots emitting tokens. */
  decode: number;
  contexts: number[];
  /**
   * The engine's ids for the slots that are NOT processing, in `/slots` order.
   *
   * `idle` counts them; this names them, which is the difference between
   * knowing there is room and being able to pin a request to a specific slot
   * (`id_slot`). The scheduler hands one of these to each job it admits so the
   * proxy can attribute that request's stage to the exact slot row the Overview
   * panel shows. Empty when every slot is busy - never a guess, because a
   * guessed id would pin a request onto work that is already running.
   *
   * Deliberately the idle half, not the busy half: `threads` below lists only
   * the slots that ARE processing, so it is the wrong end to draw a free slot
   * from.
   */
  idleSlots: number[];
  threads?: Array<{
    slot: number;
    phase: "prefill" | "decode";
    promptTokens: number | null;
    generatedTokens: number;
    promptTokensPerSecond: number | null;
    tokensPerSecond: number | null;
  }>;
}

/** One combined reading for the status panel. */
export interface SystemSample {
  cpu: number | null;
  cpuCount: number;
  loadAverage: number | null;
  ramUsedBytes: number;
  ramTotalBytes: number;
  gpu: Awaited<ReturnType<typeof query>>;
  slots: SlotInfo | null;
}

interface CpuSnapshot {
  idle: number;
  total: number;
}

interface Endpoint {
  host?: string;
  port?: number;
}

interface FetchJsonOptions {
  host: string;
  port: number;
  path: string;
  timeout?: number;
}

/** CPU busy fraction, sampled between successive calls. */
export function createCpuSampler(): CpuSampler {
  let previous: CpuSnapshot | null = null;

  function snapshot(): CpuSnapshot {
    let idle = 0;
    let total = 0;
    for (const cpu of os.cpus()) {
      for (const [kind, ms] of Object.entries(cpu.times)) {
        total += ms;
        if (kind === "idle") idle += ms;
      }
    }
    return { idle, total };
  }

  return function sample(): number | null {
    const now = snapshot();
    if (!previous) {
      previous = now;
      return null; // first call establishes the baseline
    }
    const idleDelta = now.idle - previous.idle;
    const totalDelta = now.total - previous.total;
    previous = now;
    if (totalDelta <= 0) return null;
    return Math.max(0, Math.min(1, 1 - idleDelta / totalDelta));
  };
}

function fetchJson({
  host,
  port,
  path: urlPath,
  timeout = 2500,
}: FetchJsonOptions): Promise<unknown> {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: urlPath, timeout }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.on("error", () => resolve(null));
  });
}

/** Whether a slot is doing anything. Field naming has varied across versions. */
function isProcessing(rec: Record<string, unknown>): boolean {
  if (typeof rec.is_processing === "boolean") return rec.is_processing;
  if (typeof rec.state === "number") return rec.state !== 0;
  return false;
}

/**
 * The engine's id for a slot row, falling back to its position in `/slots`.
 *
 * Shared by the summary and the per-slot sampler so a slot cannot be called `2`
 * in one and `1` in the other - the ids are used to join a request to a row, and
 * a disagreement here would attribute a stage to the wrong slot.
 */
function slotIdOf(rec: Record<string, unknown>, index: number): number {
  const id = rec.id;
  return typeof id === "number" && Number.isFinite(id) ? id : index;
}

/** How many tokens this slot has emitted for the request it is on. */
function decodedTokens(rec: Record<string, unknown>): number {
  for (const key of ["n_decoded", "n_decoded_tokens", "tokens_predicted"]) {
    const value = rec[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  // Current llama.cpp nests the counter in `next_token`; some speculative
  // builds expose an array there. Older Otto builds only read the top level,
  // which made every current slot look like decode with a made-up count of 1.
  const nextToken = rec.next_token;
  const records = Array.isArray(nextToken) ? nextToken : [nextToken];
  let nested: number | null = null;
  for (const value of records) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const count = (value as Record<string, unknown>).n_decoded;
    if (typeof count === "number" && Number.isFinite(count)) {
      nested = nested === null ? count : Math.max(nested, count);
    }
  }
  if (nested !== null) return nested;
  // No counter at all: report a non-zero so the slot lands in decode rather than
  // claiming a prefill that may never have been happening.
  return 1;
}

/**
 * Reduce llama-server's `/slots` array to the occupancy the UI shows.
 *
 * Exported separately from the fetch so the phase split can be tested against
 * the field spellings real llama.cpp builds emit, without a live server.
 */
export function summariseSlots(rows: unknown[]): SlotInfo {
  const busyRows = rows.filter((s) => isProcessing(s as Record<string, unknown>));
  // A busy slot that has not yet decoded a token is still ingesting its prompt.
  // The decoded counter is the only field that separates the two phases, and it
  // has been spelled three ways across llama.cpp versions; a slot that reports
  // none of them counts as decode, because a busy slot that cannot prove it is
  // still prefilling is far more likely to be mid-answer than mid-prompt.
  const prefill = busyRows.filter((s) => decodedTokens(s as Record<string, unknown>) === 0).length;

  return {
    total: rows.length,
    busy: busyRows.length,
    idle: rows.length - busyRows.length,
    prefill,
    decode: busyRows.length - prefill,
    idleSlots: rows.flatMap((s, index) =>
      isProcessing(s as Record<string, unknown>)
        ? []
        : [slotIdOf(s as Record<string, unknown>, index)],
    ),
    contexts: rows.map((s) => {
      const rec = s as Record<string, unknown>;
      const nCtx = typeof rec.n_ctx === "number" ? rec.n_ctx : undefined;
      const nPast = typeof rec.n_past === "number" ? rec.n_past : undefined;
      return nCtx ?? nPast ?? 0;
    }),
  };
}

/**
 * Where a counter was the last time it moved. Rates are measured from here
 * rather than from the previous poll, because the counters advance in chunks
 * and the poll is faster than they move. See `advance` in `sample`.
 */
interface RateBaseline {
  at: number;
  tokens: number;
}

/** Measures throughput from successive `/slots` snapshots, without guessing. */
export class SlotActivityTracker {
  #previous = new Map<
    number,
    {
      task: string | number | null;
      promptTokens: number | null;
      generatedTokens: number;
      phase: "prefill" | "decode";
      promptBase: RateBaseline | undefined;
      decodeBase: RateBaseline | undefined;
      /**
       * The last rate actually measured for this task, carried so a window in
       * which the counter did not move reports the throughput that is still
       * running rather than blanking the field. See the note in `sample`.
       */
      promptRate: number | null;
      decodeRate: number | null;
    }
  >();

  sample(rows: unknown[], now = Date.now()): SlotInfo {
    const threads = rows.flatMap((row, index) => {
      const record = row as Record<string, unknown>;
      const slot = slotIdOf(record, index);
      if (!isProcessing(record)) {
        this.#previous.delete(slot);
        return [];
      }
      const promptTokens = optionalCounter(record, ["n_past", "n_prompt_tokens_processed"]);
      const generatedTokens = decodedTokens(record);
      const task =
        typeof record.id_task === "string" || typeof record.id_task === "number"
          ? record.id_task
          : null;
      // A reused slot starts a new measurement window. Comparing the new
      // request's counters with the old request is how negative or absurd TPS
      // flashes appeared at action boundaries.
      const candidate = this.#previous.get(slot);
      const previous = candidate?.task === task ? candidate : undefined;
      // llama-server may leave the previous request's decoded counter visible
      // during the first snapshot of a newly assigned task. The task boundary
      // is authoritative in that case; otherwise a prompt is shown as decode
      // and prompt throughput is incorrectly reported as zero.
      const phase: "prefill" | "decode" =
        candidate !== undefined && candidate.task !== task
          ? "prefill"
          : previous?.phase === "prefill" && generatedTokens <= previous.generatedTokens
            ? "prefill"
            : generatedTokens === 0
              ? "prefill"
              : "decode";
      // Rate is measured against the last window in which this counter actually
      // MOVED, not against the last poll. `/slots` is read at 4 Hz while both
      // counters advance in chunks (prefill a whole batch at a time), so a chunk
      // landing after several flat polls covers all of them: dividing it by the
      // final 250 ms window alone would report several times the real speed.
      // Holding the baseline until movement makes the number an average over the
      // interval it was actually earned. A counter that has not moved yet still
      // yields null - "no measurement", never a fabricated 0 tok/s.
      const advance = (current: number | null, base: RateBaseline | undefined) => {
        if (current === null) return { rate: null, base: undefined };
        if (!base) return { rate: null, base: { at: now, tokens: current } };
        const seconds = (now - base.at) / 1000;
        if (current <= base.tokens || seconds <= 0) return { rate: null, base };
        return { rate: (current - base.tokens) / seconds, base: { at: now, tokens: current } };
      };
      const promptStep = advance(promptTokens, previous?.promptBase);
      const decodeStep = advance(generatedTokens, previous?.decodeBase);
      // A flat window is the counter not having moved *yet*, not throughput
      // falling to nothing, so the last rate measured for THIS task carries
      // forward instead of blanking the field. At any real speed most windows
      // are flat, which is why the number used to visibly blink out and back on
      // every poll. It cannot go stale across requests: `previous` is already
      // gated on an unchanged `id_task`, and the row disappears entirely once
      // the slot stops processing.
      const promptRate = promptStep.rate ?? previous?.promptRate ?? null;
      const decodeRate = decodeStep.rate ?? previous?.decodeRate ?? null;
      this.#previous.set(slot, {
        task,
        promptTokens,
        generatedTokens,
        phase,
        promptBase: promptStep.base,
        decodeBase: decodeStep.base,
        promptRate,
        decodeRate,
      });
      return [
        {
          slot,
          phase,
          promptTokens,
          generatedTokens,
          promptTokensPerSecond: phase === "prefill" ? promptRate : null,
          tokensPerSecond: phase === "decode" ? decodeRate : null,
        },
      ];
    });
    return { ...summariseSlots(rows), threads };
  }
}

function optionalCounter(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

const slotActivityTracker = new SlotActivityTracker();
/** Slot occupancy from the running server. */
async function slots({ host, port }: { host: string; port: number }): Promise<SlotInfo | null> {
  const data = await fetchJson({ host, port, path: "/slots" });
  if (!Array.isArray(data)) return null;
  return slotActivityTracker.sample(data as unknown[]);
}

export { slots };

/** One combined reading for the status panel. */
export async function sample(
  sampler: CpuSampler,
  { host, port }: Endpoint = {},
): Promise<SystemSample> {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  const [gpuInfo, slotInfo] = await Promise.all([
    query(),
    host && port ? slots({ host, port }) : Promise.resolve(null),
  ]);

  return {
    cpu: sampler(),
    cpuCount: os.cpus().length,
    loadAverage: os.loadavg()[0] || null, // 0 on Windows; shown only when real
    ramUsedBytes: totalMem - freeMem,
    ramTotalBytes: totalMem,
    gpu: gpuInfo,
    slots: slotInfo,
  };
}
