/**
 * The self-contained runtime source: otto-brain downloads a pinned llama.cpp
 * build into `$OTTO_HOME/otto-brain/runtimes/` and runs it directly, so the tool
 * needs no other software installed. Downloaded runtimes keep their DLLs in the
 * same directory as the exe (so `vendorDir` is null — buildEnv already puts the
 * runtime dir on PATH, which is what the DLL-stub trap requires).
 *
 * Extraction uses only OS built-ins — PowerShell's Expand-Archive for .zip and
 * the bundled `tar` for tarballs — to keep the "nothing else to install" promise.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { Runtime } from "../types.js";

export interface RuntimeSpec {
  label: string;
  version: string;
  /** One or more archive URLs, extracted in order into the same target dir. */
  assets: string[];
}

export interface InstallProgress {
  phase: "downloading" | "extracting" | "done";
  asset?: string;
  receivedBytes?: number;
  totalBytes?: number;
}

/**
 * The default runtime build. The llama.cpp release tag and CUDA asset names must
 * be pinned per platform; verify the URLs against the current release before
 * shipping. Overridable via config (`runtime.path`) or an explicit spec.
 */
export const DEFAULT_LLAMA_BUILD = "b4600";
const LLAMA_RELEASE_BASE = "https://github.com/ggml-org/llama.cpp/releases/download";

/** Build the default Windows CUDA 12 spec for a given llama.cpp build tag. */
export function defaultRuntimeSpec(build: string = DEFAULT_LLAMA_BUILD): RuntimeSpec {
  return {
    label: "CUDA 12 (managed)",
    version: build,
    assets: [
      `${LLAMA_RELEASE_BASE}/${build}/llama-${build}-bin-win-cuda-12.4-x64.zip`,
      `${LLAMA_RELEASE_BASE}/${build}/cudart-llama-bin-win-cuda-12.4-x64.zip`,
    ],
  };
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

/** A managed runtime is any dir under runtimesDir that contains llama-server.exe. */
export function listManagedRuntimes(runtimesDir: string): Runtime[] {
  if (!fs.existsSync(runtimesDir)) return [];
  const found: Runtime[] = [];
  for (const entry of fs.readdirSync(runtimesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const root = path.join(runtimesDir, entry.name);
    const exe = findFile(root, "llama-server.exe");
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
  return found;
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

async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  if (/\.zip$/i.test(archivePath)) {
    // PowerShell ships with Windows; -Force overwrites an interrupted extract.
    await run("powershell", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${destDir}' -Force`,
    ]);
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
  const targetDir = path.join(runtimesDir, slug(spec));
  fs.mkdirSync(targetDir, { recursive: true });

  for (const url of spec.assets) {
    const archivePath = path.join(targetDir, path.basename(new URL(url).pathname));
    await downloadFile(url, archivePath, onProgress);
    onProgress?.({ phase: "extracting", asset: url });
    await extractArchive(archivePath, targetDir);
    fs.rmSync(archivePath, { force: true });
  }

  const exe = findFile(targetDir, "llama-server.exe");
  if (!exe) throw new Error(`installed runtime has no llama-server.exe under ${targetDir}`);
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
