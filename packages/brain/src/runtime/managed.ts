/**
 * The self-contained runtime source: otto-brain downloads a pinned llama.cpp
 * build into `$OTTO_HOME/otto-brain/runtimes/` and runs it directly, so the tool
 * needs no other software installed. Downloaded runtimes keep their shared
 * libraries in the same directory as the binary (so `vendorDir` is null - the
 * loader path built by `args.buildEnv` already covers that directory, which is
 * what the DLL-stub trap requires).
 *
 * Extraction uses only OS built-ins - PowerShell's Expand-Archive for .zip on
 * Windows, the bundled `tar` for tarballs everywhere else - to keep the
 * "nothing else to install" promise.
 *
 * ## The upstream asset matrix (verified against release b10265)
 *
 * Every fact below was read off the release, not inferred from the naming
 * scheme, because the scheme has changed at least once: tag b4600 shipped
 * `llama-b4600-bin-win-cuda-cu12.4-x64.zip` while b10265 ships
 * `llama-b10265-bin-win-cuda-12.4-x64.zip` (no `cu`). A pin bump must re-verify
 * the names against that tag's asset list; they are not stable across tags.
 *
 *  - Windows assets are `.zip`; macOS and Linux assets are `.tar.gz`.
 *  - **Linux has no CUDA build upstream.** The Linux GPU assets are Vulkan,
 *    ROCm and SYCL only, so the Linux GPU default is Vulkan - it is the one
 *    accelerator that covers NVIDIA, AMD and Intel from a single asset. Do not
 *    "fix" this by pointing a Linux CUDA URL at the release; there isn't one.
 *  - Windows CUDA needs a *second* archive (`cudart-llama-bin-win-cuda-*.zip`)
 *    extracted over the first, and that asset's name carries no build tag.
 *  - macOS arm64 is Metal-accelerated in the stock `macos-arm64` asset; there is
 *    no separate Metal asset to select. macOS x64 is CPU-only in practice.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { Runtime } from "../types.js";

/** The accelerator a managed runtime is built against. */
export type RuntimeVariant = "cuda" | "metal" | "vulkan" | "cpu";

export interface RuntimeSpec {
  label: string;
  version: string;
  /** One or more archive URLs, extracted in order into the same target dir. */
  assets: string[];
  /** Platform the assets are built for; drives exe name and extraction. */
  platform: NodeJS.Platform;
  variant: RuntimeVariant;
}

/** What to install for. Any field left out is read from the current process. */
export interface RuntimeTarget {
  platform?: NodeJS.Platform;
  arch?: string;
  /** Explicit accelerator, or "auto" to pick from platform + GPU presence. */
  variant?: RuntimeVariant | "auto";
  /** Whether an NVIDIA GPU was detected; only consulted by "auto". */
  hasNvidiaGpu?: boolean;
}

export interface InstallProgress {
  phase: "downloading" | "extracting" | "done";
  asset?: string;
  receivedBytes?: number;
  totalBytes?: number;
}

/**
 * The default runtime build. Bumping this requires re-reading the tag's asset
 * names (see the module header) - the naming scheme is not stable across tags.
 */
export const DEFAULT_LLAMA_BUILD = "b10265";
const LLAMA_RELEASE_BASE = "https://github.com/ggml-org/llama.cpp/releases/download";

/** The CUDA toolkit version whose Windows assets we pin. */
const WINDOWS_CUDA = "12.4";

/** The binary name llama.cpp ships for a platform. */
export function serverExeName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "llama-server.exe" : "llama-server";
}

/**
 * Pick the accelerator for a target. Deliberately conservative: it never
 * chooses an accelerator whose asset does not exist for that platform/arch.
 */
export function resolveRuntimeVariant(target: RuntimeTarget = {}): RuntimeVariant {
  const platform = target.platform ?? process.platform;
  const arch = target.arch ?? process.arch;
  const requested = target.variant ?? "auto";
  if (requested !== "auto") return requested;

  if (platform === "darwin") return arch === "arm64" ? "metal" : "cpu";
  // Windows is the only platform with an upstream CUDA build. Everywhere else a
  // GPU means Vulkan.
  if (platform === "win32") {
    if (arch === "arm64") return "cpu";
    return target.hasNvidiaGpu ? "cuda" : "vulkan";
  }
  if (platform === "linux") return target.hasNvidiaGpu === false ? "cpu" : "vulkan";
  return "cpu";
}

const VARIANT_LABELS: Record<RuntimeVariant, string> = {
  cuda: `CUDA ${WINDOWS_CUDA}`,
  metal: "Metal",
  vulkan: "Vulkan",
  cpu: "CPU",
};

/**
 * The archive names for a platform/arch/variant, or null when upstream ships no
 * such asset. Returning null (rather than guessing a URL) is what keeps a bad
 * combination from failing later as an opaque 404 mid-download.
 */
function assetNames(
  build: string,
  platform: NodeJS.Platform,
  arch: string,
  variant: RuntimeVariant,
): string[] | null {
  const bin = (suffix: string, ext: string): string => `llama-${build}-bin-${suffix}.${ext}`;

  if (platform === "win32") {
    if (arch === "arm64") return variant === "cpu" ? [bin("win-cpu-arm64", "zip")] : null;
    if (arch !== "x64") return null;
    if (variant === "cuda") {
      return [
        bin(`win-cuda-${WINDOWS_CUDA}-x64`, "zip"),
        // The CUDA runtime DLLs ride in a companion archive whose name carries
        // no build tag; it is published under each release tag all the same.
        `cudart-llama-bin-win-cuda-${WINDOWS_CUDA}-x64.zip`,
      ];
    }
    if (variant === "vulkan") return [bin("win-vulkan-x64", "zip")];
    if (variant === "cpu") return [bin("win-cpu-x64", "zip")];
    return null;
  }

  if (platform === "darwin") {
    if (arch === "arm64") {
      // One asset serves both: the stock macos-arm64 build is Metal-enabled.
      return variant === "metal" || variant === "cpu" ? [bin("macos-arm64", "tar.gz")] : null;
    }
    if (arch === "x64") return variant === "cpu" ? [bin("macos-x64", "tar.gz")] : null;
    return null;
  }

  if (platform === "linux") {
    const slice = arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : null;
    if (!slice) return null;
    if (variant === "vulkan") return [bin(`ubuntu-vulkan-${slice}`, "tar.gz")];
    if (variant === "cpu") return [bin(`ubuntu-${slice}`, "tar.gz")];
    return null; // no upstream Linux CUDA/Metal asset
  }

  return null;
}

/**
 * Build the runtime spec for a target. Throws when upstream publishes nothing
 * for the combination, naming what it tried so the message is actionable.
 */
export function defaultRuntimeSpec(
  build: string | null | undefined = DEFAULT_LLAMA_BUILD,
  target: RuntimeTarget = {},
): RuntimeSpec {
  const tag = build || DEFAULT_LLAMA_BUILD;
  const platform = target.platform ?? process.platform;
  const arch = target.arch ?? process.arch;
  const variant = resolveRuntimeVariant({ ...target, platform, arch });

  const names = assetNames(tag, platform, arch, variant);
  if (!names) {
    throw new Error(
      `llama.cpp publishes no ${variant} build for ${platform}/${arch} - ` +
        `pass --variant with one of ${supportedVariants(platform, arch).join(", ") || "(none)"}, ` +
        `or point runtime.path at a runtime you built yourself`,
    );
  }

  return {
    label: `${VARIANT_LABELS[variant]} (managed)`,
    version: tag,
    assets: names.map((name) => `${LLAMA_RELEASE_BASE}/${tag}/${name}`),
    platform,
    variant,
  };
}

/** Variants with a published asset for a platform/arch, best first. */
export function supportedVariants(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): RuntimeVariant[] {
  const order: RuntimeVariant[] = ["cuda", "metal", "vulkan", "cpu"];
  return order.filter((v) => assetNames(DEFAULT_LLAMA_BUILD, platform, arch, v) !== null);
}

function slug(spec: RuntimeSpec): string {
  return `${spec.label}-${spec.version}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Recursively find the first file named `name` under `dir`. */
function findFile(dir: string, name: string): string | null {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = findFile(full, name);
      if (nested) return nested;
    } else if (entry.name.toLowerCase() === name.toLowerCase()) {
      return full;
    }
  }
  return null;
}

/**
 * Rank a managed runtime directory by the accelerator its slug encodes, best
 * first. Once more than one variant can be installed side by side, readdir
 * order is not a defensible preference: a machine that installed CPU for a
 * one-off test would otherwise have it silently outrank its CUDA runtime.
 */
function managedVariantRank(dirName: string): number {
  const order: RuntimeVariant[] = ["cuda", "metal", "vulkan", "cpu"];
  const lower = dirName.toLowerCase();
  const index = order.findIndex((variant) => lower.startsWith(`${variant}-`));
  return index === -1 ? order.length : index;
}

/** Numeric part of a `bNNNNN` llama.cpp build tag, for ordering. */
function buildNumber(version: string): number {
  const match = /(\d+)/.exec(version);
  return match ? Number(match[1]) : 0;
}

/**
 * A managed runtime is any dir under runtimesDir that contains llama-server,
 * best accelerator first and newest build first within an accelerator.
 */
export function listManagedRuntimes(
  runtimesDir: string,
  platform: NodeJS.Platform = process.platform,
): Runtime[] {
  if (!fs.existsSync(runtimesDir)) return [];
  const exeName = serverExeName(platform);
  const found: Runtime[] = [];
  for (const entry of fs.readdirSync(runtimesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const root = path.join(runtimesDir, entry.name);
    const exe = findFile(root, exeName);
    if (!exe) continue;
    found.push({
      label: entry.name,
      version: entry.name.replace(/^.*-/, ""),
      dir: path.dirname(exe),
      exe,
      vendorDir: null,
      source: "managed",
    });
  }
  return found.sort(
    (a, b) =>
      managedVariantRank(a.label) - managedVariantRank(b.label) ||
      buildNumber(b.version) - buildNumber(a.version),
  );
}

async function downloadFile(
  url: string,
  dest: string,
  onProgress?: (progress: InstallProgress) => void,
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`download failed (${response.status}) for ${url}`);
  }
  const totalBytes = Number(response.headers.get("content-length")) || undefined;
  let receivedBytes = 0;
  const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  body.on("data", (chunk: Buffer) => {
    receivedBytes += chunk.length;
    onProgress?.({ phase: "downloading", asset: url, receivedBytes, totalBytes });
  });
  await pipeline(body, createWriteStream(dest));
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${stderr.trim()}`)),
    );
  });
}

export async function extractArchive(
  archivePath: string,
  destDir: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  if (/\.zip$/i.test(archivePath)) {
    if (platform === "win32") {
      // PowerShell ships with Windows; -Force overwrites an interrupted extract.
      // Paths are rooted at $OTTO_HOME (under the user profile), so a username with
      // an apostrophe would break - or inject into - a raw single-quoted string.
      // Escape single quotes for PowerShell (a literal ' is written as '').
      const psQuote = (value: string): string => `'${value.replace(/'/g, "''")}'`;
      await run("powershell", [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath ${psQuote(archivePath)} -DestinationPath ${psQuote(destDir)} -Force`,
      ]);
      return;
    }
    // macOS and Linux both ship a tar that reads zip (bsdtar on macOS, and on
    // Linux the current assets are tarballs anyway - this branch only matters
    // for a hand-passed zip). `unzip` is not assumed: it is not installed by
    // default on every distro.
    await run("tar", ["-xf", archivePath, "-C", destDir]);
    return;
  }
  if (/\.(tar\.gz|tgz|tar)$/i.test(archivePath)) {
    await run("tar", ["-xf", archivePath, "-C", destDir]);
    return;
  }
  throw new Error(`unknown archive type: ${archivePath}`);
}

/** Download + extract a runtime spec into runtimesDir and return the Runtime. */
export async function installManagedRuntime(
  spec: RuntimeSpec,
  runtimesDir: string,
  onProgress?: (progress: InstallProgress) => void,
): Promise<Runtime> {
  const platform = spec.platform ?? process.platform;
  const targetDir = path.join(runtimesDir, slug(spec));
  fs.mkdirSync(targetDir, { recursive: true });

  for (const url of spec.assets) {
    const archivePath = path.join(targetDir, path.basename(new URL(url).pathname));
    await downloadFile(url, archivePath, onProgress);
    onProgress?.({ phase: "extracting", asset: url });
    await extractArchive(archivePath, targetDir, platform);
    fs.rmSync(archivePath, { force: true });
  }

  const exeName = serverExeName(platform);
  const exe = findFile(targetDir, exeName);
  if (!exe) throw new Error(`installed runtime has no ${exeName} under ${targetDir}`);
  if (platform !== "win32") {
    // Archive mode bits survive `tar -x`, but not every extractor preserves
    // them; without +x the supervisor's spawn fails with a bare EACCES.
    fs.chmodSync(exe, 0o755);
  }
  onProgress?.({ phase: "done" });

  return {
    label: spec.label,
    version: spec.version,
    dir: path.dirname(exe),
    exe,
    vendorDir: null,
    source: "managed",
  };
}
