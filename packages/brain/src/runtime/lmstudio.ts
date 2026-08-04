/**
 * Locates the llama-server binary shipped inside LM Studio, on all three
 * desktop platforms. LM Studio keeps its backends under `~/.lmstudio` on
 * Windows, macOS and Linux alike, so only the directory naming and the binary
 * name differ per platform.
 *
 * Important gotcha (Windows): that executable is a ~20KB stub. Launching it
 * without the matching `backends/vendor/...` directory on PATH fails with
 * STATUS_DLL_NOT_FOUND (0xC0000135) and prints absolutely nothing, so we always
 * pair a runtime with its vendor directory, and a Windows runtime whose vendor
 * dir is missing is skipped rather than offered. macOS and Linux builds are
 * self-contained and fail loudly through the dynamic loader when they are not,
 * which is why the name-shape fallback below is enabled only there.
 *
 * This is one of two runtime sources (the other being the self-contained
 * `managed` runtime); it stays as a zero-download fast path when LM Studio is
 * already installed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Runtime } from "../types.js";
import { serverExeName } from "./managed.js";

export const LMSTUDIO_ROOT = path.join(os.homedir(), ".lmstudio");
export const BACKENDS_DIR = path.join(LMSTUDIO_ROOT, "extensions", "backends");

interface RuntimePreference {
  prefix: string;
  vendor: string | null;
  label: string;
}

/**
 * Most preferred first, per platform. Each entry maps a runtime directory
 * prefix to its vendor dir.
 *
 * Prefix (not substring) matching is deliberate: a CUDA directory is named
 * `llama.cpp-win-x86_64-nvidia-cuda12-avx2-<version>`, so a substring rule for
 * the AVX2 entry would match it a second time and offer the same runtime twice
 * under the wrong label.
 *
 * The Windows rows are verified against a real install. The macOS and Linux
 * rows follow LM Studio's documented naming but have not been read off a live
 * install here - the shape fallback in `listRuntimes` is what makes discovery
 * correct on those platforms regardless.
 */
const PREFERENCES: Partial<Record<NodeJS.Platform, RuntimePreference[]>> = {
  win32: [
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
    {
      prefix: "llama.cpp-win-x86_64-vulkan-",
      vendor: "win-llama-vulkan-vendor-v2",
      label: "Vulkan",
    },
    { prefix: "llama.cpp-win-x86_64-avx2-", vendor: null, label: "CPU (AVX2)" },
  ],
  darwin: [
    { prefix: "llama.cpp-mac-arm64-apple-metal-", vendor: null, label: "Metal" },
    { prefix: "llama.cpp-mac-arm64-", vendor: null, label: "CPU (arm64)" },
    { prefix: "llama.cpp-mac-x86_64-", vendor: null, label: "CPU (x86_64)" },
  ],
  linux: [
    { prefix: "llama.cpp-linux-x86_64-nvidia-cuda12-", vendor: null, label: "CUDA 12" },
    { prefix: "llama.cpp-linux-x86_64-nvidia-cuda-", vendor: null, label: "CUDA 11" },
    { prefix: "llama.cpp-linux-x86_64-vulkan-", vendor: null, label: "Vulkan" },
    { prefix: "llama.cpp-linux-x86_64-avx2-", vendor: null, label: "CPU (AVX2)" },
    { prefix: "llama.cpp-linux-aarch64-", vendor: null, label: "CPU (aarch64)" },
  ],
};

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

/** A readable label for a directory discovered outside the preference table. */
function labelFromDirName(dirName: string): string {
  const lower = dirName.toLowerCase();
  if (lower.includes("cuda12")) return "CUDA 12";
  if (lower.includes("cuda")) return "CUDA";
  if (lower.includes("metal")) return "Metal";
  if (lower.includes("vulkan")) return "Vulkan";
  if (lower.includes("rocm") || lower.includes("hip")) return "ROCm";
  if (lower.includes("avx2")) return "CPU (AVX2)";
  return "LM Studio runtime";
}

export function listRuntimes(
  backendsDir: string = BACKENDS_DIR,
  platform: NodeJS.Platform = process.platform,
): Runtime[] {
  if (!fs.existsSync(backendsDir)) return [];

  const exeName = serverExeName(platform);
  const entries = fs
    .readdirSync(backendsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const found: Runtime[] = [];
  const claimed = new Set<string>();

  for (const pref of PREFERENCES[platform] ?? []) {
    const matches = entries
      .filter((name) => name.startsWith(pref.prefix) && !claimed.has(name))
      .map((name) => ({ name, version: extractVersion(name) }))
      .filter(({ name }) => fs.existsSync(path.join(backendsDir, name, exeName)))
      .sort((a, b) => compareVersionsDesc(a.version, b.version));

    for (const match of matches) {
      const vendorDir = pref.vendor ? path.join(backendsDir, "vendor", pref.vendor) : null;
      // A runtime whose vendor DLLs are missing cannot launch; skip it.
      if (vendorDir && !fs.existsSync(vendorDir)) continue;
      claimed.add(match.name);
      found.push({
        label: pref.label,
        version: match.version,
        dir: path.join(backendsDir, match.name),
        exe: path.join(backendsDir, match.name, exeName),
        vendorDir,
        source: "lmstudio",
      });
    }
  }

  // Shape fallback: anything that holds a llama-server binary is usable on the
  // self-contained platforms, whatever LM Studio decided to call the directory.
  // Not applied on Windows, where an unpaired stub launches and dies silently.
  if (platform !== "win32") {
    const extra = entries
      .filter((name) => !claimed.has(name) && name !== "vendor")
      .filter((name) => fs.existsSync(path.join(backendsDir, name, exeName)))
      .map((name) => ({ name, version: extractVersion(name) }))
      .sort((a, b) => compareVersionsDesc(a.version, b.version));

    for (const match of extra) {
      found.push({
        label: labelFromDirName(match.name),
        version: match.version,
        dir: path.join(backendsDir, match.name),
        exe: path.join(backendsDir, match.name, exeName),
        vendorDir: null,
        source: "lmstudio",
      });
    }
  }

  return found;
}

/** Resolve an explicit runtime directory or exe override into a Runtime. */
export function resolveOverride(
  override: string,
  platform: NodeJS.Platform = process.platform,
): Runtime {
  const exeName = serverExeName(platform);
  // An override may name the binary directly or the directory holding it. On
  // non-Windows the binary has no extension, so "is it a file?" is the only
  // reliable test - a bare `.../llama-server` path looks exactly like a dir.
  const looksLikeExe =
    path.basename(override).toLowerCase() === exeName.toLowerCase() ||
    (platform === "win32" && override.toLowerCase().endsWith(".exe")) ||
    (fs.existsSync(override) && fs.statSync(override).isFile());
  const exe = looksLikeExe ? override : path.join(override, exeName);
  if (!fs.existsSync(exe)) throw new Error(`llama-server not found at ${exe}`);
  const dir = path.dirname(exe);
  return { label: "override", version: "unknown", dir, exe, vendorDir: null, source: "lmstudio" };
}
