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
    contexts: rows.map((s) => {
      const rec = s as Record<string, unknown>;
      const nCtx = typeof rec.n_ctx === "number" ? rec.n_ctx : undefined;
      const nPast = typeof rec.n_past === "number" ? rec.n_past : undefined;
      return nCtx ?? nPast ?? 0;
    }),
  };
}

/** Measures throughput from successive `/slots` snapshots, without guessing. */
export class SlotActivityTracker {
  #previous = new Map<
    number,
    {
      at: number;
      task: string | number | null;
      promptTokens: number | null;
      generatedTokens: number;
      phase: "prefill" | "decode";
    }
  >();

  sample(rows: unknown[], now = Date.now()): SlotInfo {
    const threads = rows.flatMap((row, index) => {
      const record = row as Record<string, unknown>;
      const id = record.id;
      const slot = typeof id === "number" && Number.isFinite(id) ? id : index;
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
      const elapsedSeconds = previous ? (now - previous.at) / 1000 : 0;
      // A flat counter means no tokens crossed this window - the honest answer
      // is "not measuring" (null), not 0 tok/s. Prefill in particular only
      // moves its counter in chunks, so a strict inequality keeps the rate
      // field quiet between movements instead of flashing 0 and the real value
      // on every poll.
      const rate = (current: number | null, before: number | null | undefined) =>
        current !== null && elapsedSeconds > 0 && before != null && current > before
          ? (current - before) / elapsedSeconds
          : null;
      this.#previous.set(slot, { at: now, task, promptTokens, generatedTokens, phase });
      return [
        {
          slot,
          phase,
          promptTokens,
          generatedTokens,
          promptTokensPerSecond:
            phase === "prefill" ? rate(promptTokens, previous?.promptTokens) : null,
          tokensPerSecond:
            phase === "decode" ? rate(generatedTokens, previous?.generatedTokens) : null,
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
