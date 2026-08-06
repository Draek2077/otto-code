/**
 * Downloads a catalog model from Hugging Face into the managed models directory,
 * so `otto brain pull` needs no external tooling. Files land under
 * `<managedModelsDir>/<publisher>/<repo>/<file>` to mirror the LM Studio layout
 * the scanner already understands.
 */
import { createWriteStream, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { CatalogModel } from "../config/schema.js";

const HF_BASE = "https://huggingface.co";

export interface PullProgress {
  file: string;
  receivedBytes: number;
  totalBytes?: number;
}

/** The Hugging Face resolve URL for a repo file on the main branch. */
function resolveUrl(repo: string, file: string): string {
  return `${HF_BASE}/${repo}/resolve/main/${file}`;
}

/**
 * The GGUF filename to download. Prefer an explicit override, then the catalog
 * entry's `quantFile`, then the basename of the catalog `id` - which for the
 * seeded catalog is `<hfRepo>/<file>.gguf`, so the id already names the file.
 * Only if none of those yields a `.gguf` do we give up: community repos name
 * files inconsistently, so a bare id with no gguf basename still needs --file.
 */
function resolveFileName(model: CatalogModel, override?: string): string {
  const file = override ?? model.quantFile ?? deriveFileFromId(model.id);
  if (!file) {
    throw new Error(
      `no file name for ${model.id}: add "quantFile" to the catalog entry or pass --file <name.gguf>`,
    );
  }
  return file;
}

/** The last path segment of the id, when it is a `.gguf` file name. */
function deriveFileFromId(id: string): string | undefined {
  const base = id.split("/").pop();
  return base && base.toLowerCase().endsWith(".gguf") ? base : undefined;
}

function authHeaders(token?: string | null): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {};
}

/**
 * Stream one HF file to `destPath`, reporting bytes received. Skips (returns
 * false) if the file already exists. Writes to a `.part` then renames so a
 * killed download never leaves a truncated file that looks complete.
 */
async function streamRepoFile(
  url: string,
  destPath: string,
  label: string,
  token: string | null | undefined,
  onProgress: ((p: PullProgress) => void) | undefined,
  received: { bytes: number },
): Promise<boolean> {
  const tmp = `${destPath}.part`;
  // Remove leftovers from an earlier interrupted attempt before starting a
  // fresh request, including when this request fails before opening a stream.
  rmSync(tmp, { force: true });
  mkdirSync(path.dirname(destPath), { recursive: true });
  if (existsSync(destPath)) return false;

  const response = await fetch(url, { headers: authHeaders(token) });
  if (!response.ok || !response.body) {
    throw new Error(`download failed (${response.status}) for ${url}`);
  }
  const totalBytes = Number(response.headers.get("content-length")) || undefined;
  const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  body.on("data", (chunk: Buffer) => {
    received.bytes += chunk.length;
    onProgress?.({ file: label, receivedBytes: received.bytes, totalBytes });
  });

  try {
    await pipeline(body, createWriteStream(tmp));
    const { renameSync } = await import("node:fs");
    renameSync(tmp, destPath);
  } finally {
    // Cancellation kills the CLI child while the stream is still writing. Do
    // not leave a truncated `.part` behind for the next quant attempt.
    rmSync(tmp, { force: true });
  }
  return true;
}

export interface PullOptions {
  model: CatalogModel;
  destRoot: string;
  file?: string;
  token?: string | null;
  onProgress?: (progress: PullProgress) => void;
}

/** Download the model file; returns the local path it was written to. */
export async function pullModel({
  model,
  destRoot,
  file,
  token,
  onProgress,
}: PullOptions): Promise<string> {
  const fileName = resolveFileName(model, file);
  const repoDir = path.join(destRoot, model.hfRepo.replace(/\//g, path.sep));
  const destPath = path.join(repoDir, fileName);
  await streamRepoFile(resolveUrl(model.hfRepo, fileName), destPath, fileName, token, onProgress, {
    bytes: 0,
  });
  return destPath;
}

export interface DownloadFilesOptions {
  repo: string;
  /** Repo-relative file paths (a quant's shards, plus any projector). */
  files: string[];
  destRoot: string;
  token?: string | null;
  onProgress?: (progress: PullProgress) => void;
}

/**
 * Download a set of repo-relative files (a chosen quant's shards, plus the shared
 * projector for a vision repo) under `<destRoot>/<repo>/<path>`, preserving any
 * subdirectory. Progress accumulates across all files so a multi-shard quant
 * reports one continuous byte count. Returns the paths actually written.
 */
export async function downloadRepoFiles({
  repo,
  files,
  destRoot,
  token,
  onProgress,
}: DownloadFilesOptions): Promise<string[]> {
  const rootResolved = path.resolve(destRoot);
  const repoDir = path.join(rootResolved, repo.replace(/\//g, path.sep));
  const received = { bytes: 0 };
  const written: string[] = [];
  for (const repoFile of files) {
    // `repo` and `repoFile` come from the untrusted Hugging Face API; a crafted
    // repo tree could list names with `..` or backslash segments that escape the
    // models dir. Split on BOTH separators, reject traversal segments, and verify
    // the resolved path stays under destRoot before writing.
    const segments = repoFile.split(/[/\\]/).filter(Boolean);
    if (segments.some((segment) => segment === "." || segment === "..")) {
      throw new Error(`Refusing to download file with unsafe path: ${repoFile}`);
    }
    const destPath = path.join(repoDir, ...segments);
    const resolved = path.resolve(destPath);
    if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
      throw new Error(`Refusing to write outside the models directory: ${repoFile}`);
    }
    const url = `${HF_BASE}/${repo}/resolve/main/${repoFile}`;
    const wrote = await streamRepoFile(url, resolved, repoFile, token, onProgress, received);
    if (wrote) written.push(resolved);
  }
  return written;
}
