/**
 * Locates the llama-server binary shipped inside LM Studio.
 *
 * Important gotcha: that executable is a ~20KB stub. Launching it without the
 * matching `backends/vendor/...` directory on PATH fails with
 * STATUS_DLL_NOT_FOUND (0xC0000135) and prints absolutely nothing, so we always
 * pair a runtime with its vendor directory. This is one of two runtime sources
 * (the other being the self-contained `managed` runtime); it stays as a
 * zero-download fast path when LM Studio is already installed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Runtime } from "../types.js";

export const LMSTUDIO_ROOT = path.join(os.homedir(), ".lmstudio");
export const BACKENDS_DIR = path.join(LMSTUDIO_ROOT, "extensions", "backends");

interface RuntimePreference {
  prefix: string;
  vendor: string | null;
  label: string;
}

// Most preferred first. Each entry maps a runtime prefix to its vendor dir.
const RUNTIME_PREFERENCE: RuntimePreference[] = [
  {
    prefix: "llama.cpp-win-x86_64-nvidia-cuda12-",
    vendor: "win-llama-cuda12-vendor-v2",
    label: "CUDA 12",
  },
  {
    prefix: "llama.cpp-win-x86_64-nvidia-cuda-",
    vendor: "win-llama-cuda-vendor-v2",
    label: "CUDA 11",
  },
  { prefix: "llama.cpp-win-x86_64-vulkan-", vendor: "win-llama-vulkan-vendor-v2", label: "Vulkan" },
  { prefix: "llama.cpp-win-x86_64-avx2-", vendor: null, label: "CPU (AVX2)" },
];

// Directory names carry an instruction-set segment before the version
// (…-cuda12-avx2-2.24.0), so take the trailing dotted number, not the remainder.
const VERSION_SUFFIX = /(\d+(?:\.\d+)+)$/;

export function extractVersion(dirName: string): string {
  const match = dirName.match(VERSION_SUFFIX);
  return match ? match[1] : "0";
}

/** Compare dotted version strings numerically, descending. */
export function compareVersionsDesc(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pb[i] || 0) - (pa[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function listRuntimes(backendsDir: string = BACKENDS_DIR): Runtime[] {
  if (!fs.existsSync(backendsDir)) return [];

  const entries = fs
    .readdirSync(backendsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const found: Runtime[] = [];
  for (const pref of RUNTIME_PREFERENCE) {
    const matches = entries
      .filter((name) => name.startsWith(pref.prefix))
      .map((name) => ({ name, version: extractVersion(name) }))
      .filter(({ name }) => fs.existsSync(path.join(backendsDir, name, "llama-server.exe")))
      .sort((a, b) => compareVersionsDesc(a.version, b.version));

    for (const match of matches) {
      const vendorDir = pref.vendor ? path.join(backendsDir, "vendor", pref.vendor) : null;
      // A runtime whose vendor DLLs are missing cannot launch; skip it.
      if (vendorDir && !fs.existsSync(vendorDir)) continue;
      found.push({
        label: pref.label,
        version: match.version,
        dir: path.join(backendsDir, match.name),
        exe: path.join(backendsDir, match.name, "llama-server.exe"),
        vendorDir,
        source: "lmstudio",
      });
    }
  }
  return found;
}

/** Resolve an explicit runtime directory or exe override into a Runtime. */
export function resolveOverride(override: string): Runtime {
  const exe = override.endsWith(".exe") ? override : path.join(override, "llama-server.exe");
  if (!fs.existsSync(exe)) throw new Error(`llama-server not found at ${exe}`);
  const dir = path.dirname(exe);
  return { label: "override", version: "unknown", dir, exe, vendorDir: null, source: "lmstudio" };
}
