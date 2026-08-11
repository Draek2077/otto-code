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
 *  - **Linux has no CUDA *release asset*, and we deliberately do not source one
 *    elsewhere.** The Linux GPU assets are Vulkan, ROCm and SYCL only, so the
 *    Linux GPU default is Vulkan - the one accelerator covering NVIDIA, AMD and
 *    Intel from a single asset. There is a real Linux CUDA build upstream, in
 *    the `ghcr.io/ggml-org/llama.cpp:server-cuda-b<n>` container images (484 of
 *    them, and 376 build numbers carry both an image and a release, so a pinned
 *    version-aligned import is genuinely possible). It was extracted, run and
 *    benchmarked on 2026-08-04 and then rejected on the numbers:
 *
 *      CUDA beats Vulkan by 1.00x-1.04x on an RTX 5090 at every prefill depth
 *      from 512 to 8192 and at token generation, inside the run-to-run error at
 *      three of five points, because NVIDIA's Vulkan driver exposes
 *      NV_coopmat2 and llama.cpp's Vulkan backend uses those tensor cores.
 *
 *    Paying for that would mean a 40x download (1.3 GB against 32 MB) and a 14x
 *    on-disk footprint, assembled from three origins, because `libggml-cuda.so`
 *    also needs `libcublas`, `libcudart` and `libnccl.so.2` - and NCCL ships in
 *    neither NVIDIA redistributable. Do not reopen this without a measurement on
 *    hardware that does *not* report NV_coopmat2, which is the one case where
 *    the gap could still be real. Full evidence:
 *    findings/linux-gpu-acceleration/2026-08-04-cuda-vs-vulkan-and-cuda-asset-origins.md
 *  - **No Linux asset ships `libgomp.so.1`**, which `llama-server` hard-links,
 *    so a host without `libgomp1` installs a runtime that then exits 127 on
 *    spawn. Windows bundles its OpenMP runtime (`libomp140.x86_64.dll`); Linux
 *    bundles nothing. `buildEnv` cannot paper over it - the library is not in
 *    the runtime dir that `LD_LIBRARY_PATH` already points at.
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
import { buildEnv } from "./args.js";

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
const LLAMA_RELEASE_API = "https://api.github.com/repos/ggml-org/llama.cpp/releases";

/**
 * How many releases to read when resolving "latest".
 *
 * Not 1: the newest release is not necessarily a numbered build (upstream also
 * publishes differently tagged and pre-release entries), and a single
 * non-matching entry would otherwise read as "llama.cpp published no release
 * builds" while the very next one qualified.
 */
const LATEST_BUILD_SCAN_PAGE = 30;

export interface RuntimeRelease {
  build: string;
  publishedAt: string | null;
}

/** Official llama.cpp builds, newest first. Only numbered build releases are actionable. */
export async function listRuntimeReleases(limit = 100): Promise<RuntimeRelease[]> {
  const response = await fetch(
    `${LLAMA_RELEASE_API}?per_page=${Math.min(Math.max(limit, 1), 100)}`,
    {
      headers: { Accept: "application/vnd.github+json" },
    },
  );
  if (!response.ok) throw new Error(`could not fetch llama.cpp releases (${response.status})`);
  const releases: unknown = await response.json();
  if (!Array.isArray(releases)) throw new Error("llama.cpp releases response was invalid");
  return releases.flatMap((release) => {
    if (!release || typeof release !== "object") return [];
    const value = release as Record<string, unknown>;
    const build = typeof value.tag_name === "string" ? value.tag_name : "";
    return /^b\d+$/.test(build)
      ? [{ build, publishedAt: typeof value.published_at === "string" ? value.published_at : null }]
      : [];
  });
}

/** Resolve the latest official build at the last responsible moment. */
export async function latestRuntimeBuild(): Promise<string> {
  const [latest] = await listRuntimeReleases(LATEST_BUILD_SCAN_PAGE);
  if (!latest) throw new Error("llama.cpp published no release builds");
  return latest.build;
}

export interface ResolvedBuild {
  build: string;
  /** A single line explaining a fallback, or null when "latest" resolved. */
  warning: string | null;
}

/**
 * The build to install for a "latest" request, with the pin as the safety net.
 *
 * Asking upstream is a best effort, never a precondition. `listRuntimeReleases`
 * hits api.github.com unauthenticated, which is rate limited to 60 requests per
 * hour per IP: behind NAT, on a corporate egress or on a CI runner that is a 403
 * on an address that has spent its budget on something else entirely. An install
 * the pinned build can serve must not fail because a version lookup did.
 *
 * The warning is deliberately one line. The daemon's BrainOpsManager keeps the
 * *last* stderr line as the job's message, so a wrapped warning would surface in
 * the GUI as a dangling fragment.
 */
export async function resolveLatestBuildOrPin(): Promise<ResolvedBuild> {
  try {
    return { build: await latestRuntimeBuild(), warning: null };
  } catch (error) {
    return {
      build: DEFAULT_LLAMA_BUILD,
      warning:
        `could not look up the latest llama.cpp build (${oneLine(error)}), so Otto installed` +
        ` the pinned build ${DEFAULT_LLAMA_BUILD} instead.`,
    };
  }
}

/** Flatten a message to one line, so a warning survives the last-line rule. */
function oneLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/gu, " ").trim();
}

/** The CUDA toolkit version whose Windows assets we pin. */
const WINDOWS_CUDA = "12.4";
const MANAGED_RUNTIME_METADATA_FILE = ".otto-runtime.json";

interface ManagedRuntimeMetadata {
  displayName: string;
}

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
    // No Linux CUDA/Metal *release* asset. A CUDA container image exists and was
    // measured at parity with Vulkan; see the header before reopening this.
    return null;
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

function displayNameForManagedRuntime(label: string, version: string): string {
  return `${label.replace(/\s*\(managed\)$/iu, "")} · ${version} (Otto managed)`;
}

function legacyManagedDisplayName(dirName: string, version: string): string {
  const cuda = /^cuda-(\d+)-(\d+)-managed(?:-|$)/iu.exec(dirName);
  if (cuda) return `CUDA ${cuda[1]}.${cuda[2]} · ${version} (Otto managed)`;
  if (/^vulkan-managed(?:-|$)/iu.test(dirName)) return `Vulkan · ${version} (Otto managed)`;
  if (/^metal-managed(?:-|$)/iu.test(dirName)) return `Metal · ${version} (Otto managed)`;
  if (/^cpu-managed(?:-|$)/iu.test(dirName)) return `CPU · ${version} (Otto managed)`;
  return `${version} (Otto managed)`;
}

function readManagedRuntimeDisplayName(root: string, dirName: string, version: string): string {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(root, MANAGED_RUNTIME_METADATA_FILE), "utf8"),
    ) as Partial<ManagedRuntimeMetadata>;
    if (typeof parsed.displayName === "string" && parsed.displayName.trim()) {
      return parsed.displayName;
    }
  } catch {
    // Existing installations predate metadata; their directory name remains a
    // backend-only migration source, never a UI presentation contract.
  }
  return legacyManagedDisplayName(dirName, version);
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
    const version = entry.name.replace(/^.*-/, "");
    found.push({
      label: entry.name,
      displayName: readManagedRuntimeDisplayName(root, entry.name, version),
      version,
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

/**
 * An asset upstream does not serve at all, which is what a renamed asset or a
 * tag without the expected build looks like from here. Distinguished from every
 * other download failure because it is the one a caller can answer by retrying
 * a build whose asset names are pinned and tested, rather than by retrying the
 * same URL later.
 */
export class MissingAssetError extends Error {
  constructor(readonly url: string) {
    super(`download failed (404) for ${url}`);
    this.name = "MissingAssetError";
  }
}

async function downloadFile(
  url: string,
  dest: string,
  onProgress?: (progress: InstallProgress) => void,
): Promise<void> {
  const response = await fetch(url);
  if (response.status === 404) throw new MissingAssetError(url);
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

/** Spawn and collect the outcome instead of throwing, so callers can classify it. */
function runCapture(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) => resolve({ code: null, stdout, stderr: `${stderr}${err}` }));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/**
 * Distro packages providing a library llama.cpp links but ships on no asset.
 * Keyed by soname because that is the string the dynamic loader prints.
 */
const SYSTEM_LIBRARY_PACKAGES: Record<string, string> = {
  "libgomp.so.1": "libgomp1 (Debian/Ubuntu), libgomp (Fedora/RHEL) or gcc-libs (Arch)",
};

/**
 * Where to fetch the one library upstream leaves unmet on Linux.
 *
 * Debian's pool rather than Ubuntu's for two measured reasons: bookworm's
 * `libgomp1` carries a `GLIBC_2.34` floor, which is *exactly* llama-server's own
 * floor, so bundling it cannot narrow the set of systems the runtime already ran
 * on; and its payload is `data.tar.xz`, which `tar` reads with the near-universal
 * `xz`, where Ubuntu 24.04+ moved to zstd, which a minimal image does not have.
 */
const LIBGOMP_PACKAGE: Record<string, string> = {
  x64: "https://deb.debian.org/debian/pool/main/g/gcc-12/libgomp1_12.2.0-14+deb12u1_amd64.deb",
  arm64: "https://deb.debian.org/debian/pool/main/g/gcc-12/libgomp1_12.2.0-14+deb12u1_arm64.deb",
};

/**
 * Read one member out of a Unix `ar` archive, which is the container format of a
 * `.deb`. Parsed here rather than shelled out to `ar`, which is binutils and not
 * present on a minimal image - the exact kind of host that needs this repair.
 *
 * Layout: an 8-byte magic, then per member a fixed 60-byte ASCII header whose
 * name is bytes 0-15 and size bytes 48-57, followed by the payload padded to an
 * even offset.
 */
function readArMember(archive: Buffer, member: string): Buffer | null {
  if (archive.subarray(0, 8).toString("ascii") !== "!<arch>\n") return null;
  let offset = 8;
  while (offset + 60 <= archive.length) {
    const header = archive.subarray(offset, offset + 60);
    const name = header.subarray(0, 16).toString("ascii").trim().replace(/\/$/, "");
    const size = Number.parseInt(header.subarray(48, 58).toString("ascii").trim(), 10);
    if (!Number.isInteger(size) || size < 0) return null;
    const start = offset + 60;
    if (name === member) return archive.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  return null;
}

/**
 * Try to satisfy a missing system library by placing it beside the binary, where
 * `buildEnv`'s loader path already looks.
 *
 * Only ever runs *after* the runtime has already failed to start, so it cannot
 * regress a host that works: a system with its own `libgomp` never reaches here.
 * Returns false on any failure, which leaves the caller reporting the actionable
 * error it would have reported anyway. Best effort, never fatal in itself.
 */
async function repairMissingLibrary(
  soname: string,
  destDir: string,
  arch: string,
): Promise<boolean> {
  if (soname !== "libgomp.so.1") return false;
  const url = LIBGOMP_PACKAGE[arch === "x64" ? "x64" : arch === "arm64" ? "arm64" : ""];
  if (!url) return false;

  const scratch = path.join(destDir, ".libgomp-repair");
  try {
    fs.mkdirSync(scratch, { recursive: true });
    const debPath = path.join(scratch, "lib.deb");
    await downloadFile(url, debPath);

    const payload = readArMember(fs.readFileSync(debPath), "data.tar.xz");
    if (!payload) return false;
    const tarPath = path.join(scratch, "data.tar.xz");
    fs.writeFileSync(tarPath, payload);
    await extractArchive(tarPath, scratch, "linux");

    // The package ships `libgomp.so.1` as a symlink to the real `libgomp.so.1.0.0`;
    // copy the target under the soname so no symlink support is needed.
    const real = findFile(scratch, "libgomp.so.1.0.0");
    if (!real) return false;
    fs.copyFileSync(real, path.join(destDir, soname));
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * The actionable message for a dynamic-loader failure, or null when the output
 * is not one. Pure, so the classification is testable without spawning.
 *
 * Returning null for an unrecognised failure is deliberate: a future llama.cpp
 * that exits non-zero from `--version` must not turn a perfectly usable install
 * into a hard failure. Only a positively identified missing library throws.
 */
export function missingLibraryFrom(stderr: string): string | null {
  const missing =
    // glibc's loader, and macOS dyld.
    /error while loading shared libraries:\s*([^\s:]+)/.exec(stderr) ??
    /Library not loaded:\s*(\S+)/.exec(stderr);
  return missing ? missing[1] : null;
}

export function describeLoaderFailure(
  stderr: string,
  runtimeDir: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const lib = missingLibraryFrom(stderr);
  if (!lib) return null;

  const hint = SYSTEM_LIBRARY_PACKAGES[lib.replace(/^.*[/\\]/, "")];
  return (
    `the runtime installed but cannot start: ${lib} is missing from this system. ` +
    `llama.cpp links it and ships it on no ${platform} asset, so it has to come from the OS` +
    (hint ? ` - install ${hint}` : "") +
    `. The runtime is at ${runtimeDir}; re-run once the library is present.`
  );
}

/**
 * Run the freshly installed binary once, so a missing *system* library surfaces
 * at install time naming the library, instead of hours later as an opaque
 * supervisor crash.
 *
 * This is not hypothetical: no upstream Linux asset ships `libgomp.so.1`, which
 * `llama-server` hard-links, so on a host without `libgomp1` the download and
 * extract both succeed and the binary then dies with exit 127. `buildEnv` cannot
 * fix that - the library is not in the runtime dir LD_LIBRARY_PATH points at.
 */
export async function verifyRuntimeExecutable(
  runtime: Runtime,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): Promise<void> {
  const env = buildEnv(runtime, process.env, platform);
  const first = await runCapture(runtime.exe, ["--version"], env);
  if (first.code === 0) return;

  const problem = describeLoaderFailure(first.stderr, runtime.dir, platform);
  if (!problem) return;

  // Repair before giving up. `libgomp.so.1` is missing from every upstream Linux
  // asset, so on a minimal image this is the *expected* first outcome, not an
  // exceptional one, and telling the user to go install a package is a worse
  // answer than placing the library where the loader already looks.
  const soname = missingLibraryFrom(first.stderr);
  if (platform === "linux" && soname && (await repairMissingLibrary(soname, runtime.dir, arch))) {
    const retry = await runCapture(runtime.exe, ["--version"], env);
    if (retry.code === 0) return;
    throw new Error(describeLoaderFailure(retry.stderr, runtime.dir, platform) ?? problem);
  }

  throw new Error(problem);
}

/**
 * Device lines out of `--list-devices` stdout, which is a header followed by one
 * indented line per device, or the literal `(none)`. Pure half of
 * `listRuntimeDevices`.
 */
export function parseDeviceList(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^available devices:/i.test(line) && line !== "(none)");
}

/**
 * Devices the runtime's backends actually found, one line each. Empty means the
 * accelerator resolved to nothing and inference would silently fall back to CPU,
 * which is a real configuration: on WSL2 there is no NVIDIA Vulkan ICD, so a
 * Vulkan runtime on an NVIDIA machine reports no device and runs ~41x slower at
 * prefill without saying so. Never throws; a probe failure reads as "unknown".
 */
export async function listRuntimeDevices(
  runtime: Runtime,
  platform: NodeJS.Platform = process.platform,
): Promise<string[]> {
  const env = buildEnv(runtime, process.env, platform);
  const { code, stdout } = await runCapture(runtime.exe, ["--list-devices"], env);
  if (code !== 0) return [];
  return parseDeviceList(stdout);
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
  // `.tar.xz` is here for the .deb payload the Linux libgomp repair unpacks; tar
  // picks the decompressor itself, so this stays within the OS built-ins rule.
  if (/\.(tar\.gz|tgz|tar\.xz|tar)$/i.test(archivePath)) {
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
  const preexisting = fs.existsSync(targetDir);
  fs.mkdirSync(targetDir, { recursive: true });

  try {
    for (const url of spec.assets) {
      const archivePath = path.join(targetDir, path.basename(new URL(url).pathname));
      await downloadFile(url, archivePath, onProgress);
      onProgress?.({ phase: "extracting", asset: url });
      await extractArchive(archivePath, targetDir, platform);
      fs.rmSync(archivePath, { force: true });
    }
  } catch (error) {
    // A half-installed directory is worse than no directory: Windows CUDA needs
    // two archives, so a 404 on the companion leaves a llama-server with no CUDA
    // runtime beside it, and `listManagedRuntimes` ranks by build number - that
    // newer, broken build would then outrank the working runtime it replaced.
    // Only a directory this call created is removed; an existing install stands.
    if (!preexisting) fs.rmSync(targetDir, { recursive: true, force: true });
    throw error;
  }

  const exeName = serverExeName(platform);
  const exe = findFile(targetDir, exeName);
  if (!exe) throw new Error(`installed runtime has no ${exeName} under ${targetDir}`);
  if (platform !== "win32") {
    // Archive mode bits survive `tar -x`, but not every extractor preserves
    // them; without +x the supervisor's spawn fails with a bare EACCES.
    fs.chmodSync(exe, 0o755);
  }

  const runtime: Runtime = {
    label: spec.label,
    displayName: displayNameForManagedRuntime(spec.label, spec.version),
    version: spec.version,
    dir: path.dirname(exe),
    exe,
    vendorDir: null,
    source: "managed",
  };

  // Before reporting success. An install that cannot exec is not an install, and
  // the loader error names the cause far better than the later spawn failure does.
  await verifyRuntimeExecutable(runtime, platform);

  fs.writeFileSync(
    path.join(targetDir, MANAGED_RUNTIME_METADATA_FILE),
    `${JSON.stringify({ displayName: runtime.displayName })}\n`,
  );

  onProgress?.({ phase: "done" });
  return runtime;
}

/** Remove one Otto-managed runtime. LM Studio files are outside this root. */
export function removeManagedRuntime(runtimesDir: string, name: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) throw new Error("invalid runtime name");
  const root = path.resolve(runtimesDir);
  const target = path.resolve(root, name);
  if (path.dirname(target) !== root || !fs.existsSync(target)) {
    throw new Error(`managed runtime not found: ${name}`);
  }
  fs.rmSync(target, { recursive: true, force: false });
}
