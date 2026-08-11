/**
 * Downloads a catalog model from Hugging Face into the managed models directory,
 * so `otto brain pull` needs no external tooling. Files land under
 * `<managedModelsDir>/<publisher>/<repo>/<file>` to mirror the LM Studio layout
 * the scanner already understands.
 */
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
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

interface PartialDownloadMetadata {
  etag: string;
  totalBytes: number;
}

function partialMetadataPath(tmp: string): string {
  return `${tmp}.json`;
}

function clearPartial(tmp: string): void {
  rmSync(tmp, { force: true });
  rmSync(partialMetadataPath(tmp), { force: true });
}

/** Read only a partial whose source identity and total length were recorded. */
function resumablePartial(
  tmp: string,
): { bytes: number; metadata: PartialDownloadMetadata } | null {
  try {
    const bytes = statSync(tmp).size;
    const metadata = JSON.parse(
      readFileSync(partialMetadataPath(tmp), "utf8"),
    ) as PartialDownloadMetadata;
    if (
      bytes <= 0 ||
      !metadata.etag ||
      !Number.isSafeInteger(metadata.totalBytes) ||
      metadata.totalBytes <= bytes
    ) {
      return null;
    }
    return { bytes, metadata };
  } catch {
    return null;
  }
}

function contentLength(response: Response): number | null {
  const length = Number(response.headers.get("content-length"));
  return Number.isSafeInteger(length) && length >= 0 ? length : null;
}

function isMatchingRangeResponse(
  response: Response,
  partial: { bytes: number; metadata: PartialDownloadMetadata },
): boolean {
  if (response.status !== 206) return false;
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
  if (!match) return false;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const totalBytes = Number(match[3]);
  const length = contentLength(response);
  const etag = response.headers.get("etag");
  return (
    start === partial.bytes &&
    end >= start &&
    totalBytes === partial.metadata.totalBytes &&
    length === end - start + 1 &&
    (!etag || etag === partial.metadata.etag)
  );
}

function writePartialMetadata(tmp: string, metadata: PartialDownloadMetadata): void {
  writeFileSync(partialMetadataPath(tmp), JSON.stringify(metadata), {
    encoding: "utf8",
    mode: 0o600,
  });
}

/**
 * Stream one HF file to `destPath`, reporting bytes received. Skips (returns
 * false) if the file already exists. Interrupted downloads keep a `.part` only
 * when its ETag and complete length were recorded. A later attempt resumes it
 * only after Hugging Face confirms the exact byte range belongs to that same
 * representation; otherwise it restarts cleanly.
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
  mkdirSync(path.dirname(destPath), { recursive: true });
  if (existsSync(destPath)) {
    clearPartial(tmp);
    return false;
  }

  let partial = resumablePartial(tmp);
  if (!partial && existsSync(tmp)) clearPartial(tmp);

  let response: Response;
  if (partial) {
    response = await fetch(url, {
      headers: {
        ...authHeaders(token),
        range: `bytes=${partial.bytes}-`,
        "if-range": partial.metadata.etag,
      },
    });
    // A 200 is the defined If-Range response when the remote representation
    // changed (or the server cannot range). The saved bytes are no longer safe
    // to append, so start over with the complete response it supplied.
    if (response.status === 200) {
      clearPartial(tmp);
      partial = null;
    } else if (!isMatchingRangeResponse(response, partial)) {
      throw new Error(`download resume failed (${response.status}) for ${url}`);
    }
  } else {
    response = await fetch(url, { headers: authHeaders(token) });
  }

  if ((response.status !== 200 && response.status !== 206) || !response.body) {
    throw new Error(`download failed (${response.status}) for ${url}`);
  }
  const append = partial !== null;
  const resumedBytes = partial?.bytes ?? 0;
  const totalBytes = partial?.metadata.totalBytes ?? contentLength(response);
  if (!append) {
    const etag = response.headers.get("etag");
    if (etag && totalBytes !== null && totalBytes > 0) {
      writePartialMetadata(tmp, { etag, totalBytes });
    } else {
      // An unidentifiable partial can never be proved safe to resume.
      clearPartial(tmp);
    }
  }
  const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  if (append) received.bytes += resumedBytes;
  body.on("data", (chunk: Buffer) => {
    received.bytes += chunk.length;
    onProgress?.({
      file: label,
      receivedBytes: received.bytes,
      totalBytes: totalBytes ?? undefined,
    });
  });

  try {
    await pipeline(body, createWriteStream(tmp, { flags: append ? "a" : "w" }));
    renameSync(tmp, destPath);
    rmSync(partialMetadataPath(tmp), { force: true });
  } catch (error) {
    // Keep only a partial that has a recorded immutable identity and full
    // length. Everything else is deliberately discarded on the next attempt.
    if (!resumablePartial(tmp)) clearPartial(tmp);
    throw error;
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

/** Exact, manifest-driven files for a bundle selection. No quant discovery is
 * involved, so a component pull can never select an arbitrary projector. */
export function bundleDownloadPlan(
  model: CatalogModel,
  componentIds: string[] = [],
  primaryFiles?: string[],
  primaryBytes?: number,
): {
  repo: string;
  files: string[];
  totalBytes: number | null;
} {
  const selected = new Set(componentIds);
  const known = new Set((model.components ?? []).map((component) => component.id));
  const unknown = componentIds.filter((id) => !known.has(id));
  if (unknown.length) throw new Error(`unknown bundle components: ${unknown.join(", ")}`);
  const components = (model.components ?? []).filter(
    (component) => component.required || selected.has(component.id),
  );
  const foreign = components.find(
    (component) => (component.hfRepo ?? model.hfRepo) !== model.hfRepo,
  );
  if (foreign)
    throw new Error(`component ${foreign.id} uses a separate repository and needs its own plan`);
  return {
    repo: model.hfRepo,
    files: [
      ...(primaryFiles ?? [resolveFileName(model)]),
      ...components.map((component) => component.file),
    ],
    totalBytes:
      (primaryBytes ?? model.approxWeightsBytes) === undefined ||
      components.some((component) => component.bytes == null)
        ? null
        : (primaryBytes ?? model.approxWeightsBytes!) +
          components.reduce((sum, component) => sum + (component.bytes ?? 0), 0),
  };
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
