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
 * KV pool — so more concurrency costs context per request.
 */

/** A CPU busy-fraction sampler: returns the fraction in [0,1], or null. */
export interface CpuSampler {
  (): number | null;
}

/** Slot occupancy from the running server. */
export interface SlotInfo {
  total: number;
  busy: number;
  idle: number;
  contexts: number[];
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

/**
 * Slot occupancy from the running server.
 * @returns {{total:number, busy:number, idle:number, contexts:number[]}|null}
 */
async function slots({ host, port }: { host: string; port: number }): Promise<SlotInfo | null> {
  const data = await fetchJson({ host, port, path: "/slots" });
  if (!Array.isArray(data)) return null;

  const rows = data as unknown[];

  // Field naming has varied across llama.cpp versions; accept either.
  const busy = rows.filter((s) => {
    const rec = s as Record<string, unknown>;
    if (typeof rec.is_processing === "boolean") return rec.is_processing;
    if (typeof rec.state === "number") return rec.state !== 0;
    return false;
  }).length;

  return {
    total: rows.length,
    busy,
    idle: rows.length - busy,
    contexts: rows.map((s) => {
      const rec = s as Record<string, unknown>;
      const nCtx = typeof rec.n_ctx === "number" ? rec.n_ctx : undefined;
      const nPast = typeof rec.n_past === "number" ? rec.n_past : undefined;
      return nCtx ?? nPast ?? 0;
    }),
  };
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
