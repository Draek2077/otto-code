import { execFile } from "node:child_process";

import type { GpuInfo } from "./types.js";

/** Thin wrapper over nvidia-smi. Returns null when there is no NVIDIA GPU. */

/** GpuInfo plus the live sampling fields nvidia-smi also reports. */
export interface GpuQuery extends GpuInfo {
  utilization: number;
  temperature: number;
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

async function query(): Promise<GpuQuery | null> {
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

/** Just the used-VRAM figure, for sampling during a load. */
async function usedBytes(): Promise<number | null> {
  try {
    const out = await run(["--query-gpu=memory.used", "--format=csv,noheader,nounits"]);
    return Number(out.trim().split(/\r?\n/)[0]) * MIB;
  } catch {
    return null;
  }
}

export { query, usedBytes };
