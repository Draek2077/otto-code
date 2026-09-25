import { execFile } from "node:child_process";

import type { GpuInfo, Runtime } from "./types.js";

/** GpuInfo plus live sampling fields when the backend exposes them. */
export interface GpuQuery extends GpuInfo {
  utilization: number | null;
  temperature: number | null;
}

function run(args: string[], timeout = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("nvidia-smi", args, { timeout, windowsHide: true }, (error, stdout) => {
      if (error) reject(error);
      else resolve(String(stdout));
    });
  });
}

const MIB = 1024 * 1024;

async function queryNvidia(): Promise<GpuQuery | null> {
  try {
    const out = await run([
      "--query-gpu=name,memory.total,memory.used,utilization.gpu,temperature.gpu,driver_version,compute_cap",
      "--format=csv,noheader,nounits",
    ]);
    const line = out.trim().split(/\r?\n/)[0];
    if (!line) return null;
    const [name, total, used, util, temp, driver, cap] = line.split(",").map((s) => s.trim());
    return {
      name,
      totalBytes: Number(total) * MIB,
      usedBytes: Number(used) * MIB,
      freeBytes: (Number(total) - Number(used)) * MIB,
      utilization: Number(util),
      temperature: Number(temp),
      driver,
      computeCapability: cap,
    };
  } catch {
    return null;
  }
}

const metalProbes = new Map<string, Promise<GpuQuery | null>>();

/** llama.cpp reports Metal's recommended working set, not the Mac's total RAM. */
export function parseMetalDevice(lines: string[]): GpuQuery | null {
  for (const line of lines) {
    const match = /^\s*(?:Metal|MTL\d*):\s*(.+?)\s*\((\d+) MiB,\s*\d+ MiB free\)/iu.exec(line);
    if (!match) continue;
    const totalBytes = Number(match[2]) * MIB;
    if (!(totalBytes > 0)) continue;
    return {
      name: match[1],
      totalBytes,
      // --list-devices runs in a separate process. Its "free" value cannot
      // describe allocations held by the serving process or other apps.
      usedBytes: null,
      freeBytes: null,
      utilization: null,
      temperature: null,
      driver: "Metal",
      computeCapability: "",
    };
  }
  return null;
}

/** Sum the allocations that llama.cpp reports for its own Metal buffers. */
export function metalAllocatedBytes(logLines: string[]): number | null {
  let total = 0;
  let found = false;
  for (const line of logLines) {
    const match =
      /\bMetal(?:_Mapped)?\s+(?:model|KV|compute|output)\s+buffer size\s*=\s*([\d.]+)\s*(KiB|MiB|GiB)\b/iu.exec(
        line,
      );
    if (!match) continue;
    const scale =
      match[2].toLowerCase() === "gib"
        ? 1024 ** 3
        : match[2].toLowerCase() === "mib"
          ? 1024 ** 2
          : 1024;
    total += Number(match[1]) * scale;
    found = true;
  }
  return found ? total : null;
}

async function queryMetal(runtime?: Runtime | null): Promise<GpuQuery | null> {
  if (process.platform !== "darwin" || process.arch !== "arm64") return null;
  // Resolve the selected runtime lazily: runtime/index uses the NVIDIA probe
  // during installation, and importing it at module initialization would cycle.
  let selected = runtime;
  if (!selected) {
    const [{ loadBrainConfig }, { resolveRuntime }] = await Promise.all([
      import("./config/store.js"),
      import("./runtime/index.js"),
    ]);
    selected = resolveRuntime(loadBrainConfig());
  }
  if (!selected) return null;
  let probe = metalProbes.get(selected.exe);
  if (!probe) {
    probe = (async () => {
      const { listRuntimeDevices } = await import("./runtime/managed.js");
      return parseMetalDevice(await listRuntimeDevices(selected));
    })();
    metalProbes.set(selected.exe, probe);
  }
  const result = await probe;
  if (!result) metalProbes.delete(selected.exe);
  return result;
}

async function query(runtime?: Runtime | null): Promise<GpuQuery | null> {
  if (process.platform === "darwin" && process.arch === "arm64") return queryMetal(runtime);
  return queryNvidia();
}

/** Just the used-VRAM figure, for sampling during a load. */
async function usedBytes(): Promise<number | null> {
  if (process.platform === "darwin") return null;
  try {
    const out = await run(["--query-gpu=memory.used", "--format=csv,noheader,nounits"]);
    return Number(out.trim().split(/\r?\n/)[0]) * MIB;
  } catch {
    return null;
  }
}

export { query, queryNvidia, usedBytes };
