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
  lstatSync,
  openSync,
  closeSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
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
  return `${HF_BASE}/${repo}/resolve/main/${file.split("/").map(encodeURIComponent).join("/")}`;
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
      typeof metadata.etag !== "string" ||
      !metadata.etag ||
      metadata.etag.startsWith("W/") ||
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
  const header = response.headers.get("content-length");
  if (header === null) return null;
  const length = Number(header);
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

async function downloadResponse(
  url: string,
  tmp: string,
  token: string | null | undefined,
  signal?: AbortSignal,
) {
  let partial = resumablePartial(tmp);
  if (!partial && existsSync(tmp)) clearPartial(tmp);

  let response: Response;
  if (partial) {
    response = await fetch(url, {
      signal,
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
      // Discard the partial before failing. A persistent non-200/non-206 answer
      // to the ranged request (an expired signed CDN redirect returning 403, an
      // upstream 5xx, a proxy that strips Range) would otherwise wedge this file
      // forever: the partial stays valid, so every later attempt replays the
      // same ranged request and gets the same answer, and only a 200 ever clears
      // it. Dropping it here costs the resume but lets the next attempt restart
      // cleanly from byte zero.
      clearPartial(tmp);
      await response.body?.cancel();
      throw new Error(`download resume failed (${response.status}) for ${url}`);
    }
  } else {
    response = await fetch(url, { signal, headers: authHeaders(token) });
  }

  if ((response.status !== 200 && !(partial && response.status === 206)) || !response.body) {
    await response.body?.cancel();
    throw new Error(`download failed (${response.status}) for ${url}`);
  }
  return { response, partial };
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
  signal?: AbortSignal,
): Promise<boolean> {
  const tmp = `${destPath}.part`;
  mkdirSync(path.dirname(destPath), { recursive: true });
  if (existsSync(destPath)) {
    clearPartial(tmp);
    // A bundle plan counts every selected artifact. An artifact that is
    // already present is complete work, not zero work, otherwise the progress
    // denominator includes it while the numerator never can.
    received.bytes += statSync(destPath).size;
    onProgress?.({ file: label, receivedBytes: received.bytes });
    return false;
  }

  const { response, partial } = await downloadResponse(url, tmp, token, signal);
  const append = partial !== null;
  const resumedBytes = partial?.bytes ?? 0;
  const totalBytes = partial?.metadata.totalBytes ?? contentLength(response);
  if (!append) {
    const etag = response.headers.get("etag");
    if (etag && !etag.startsWith("W/") && totalBytes !== null && totalBytes > 0) {
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
    await pipeline(body, createWriteStream(tmp, { flags: append ? "a" : "w", mode: 0o600 }), {
      signal,
    });
    // Undici rejects the body stream on a premature close (measured: a short
    // Content-Length body, with either a destroyed socket or a clean FIN, and a
    // truncated chunked body all reject), so a cut transfer never reaches this
    // line. A short but *valid* 206 does: a server may answer an open-ended
    // `bytes=N-` with any narrower range, and isMatchingRangeResponse accepts
    // that because it requires end >= start, not end === totalBytes - 1.
    // Renaming then would publish a truncated model as a complete one. The
    // partial survives the throw below, so the next attempt resumes from the
    // bytes this one did add.
    const writtenBytes = statSync(tmp).size;
    if (totalBytes !== null && totalBytes > 0 && writtenBytes !== totalBytes) {
      throw new Error(
        `download incomplete for ${url}: wrote ${writtenBytes} of ${totalBytes} bytes`,
      );
    }
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
  signal?: AbortSignal;
}

/** Exact, manifest-driven files for a bundle selection. No quant discovery is
 * involved, so a component pull can never select an arbitrary projector. */
export function bundleDownloadPlan(
  model: CatalogModel,
  componentIds: string[] = [],
  primaryFiles?: string[],
  primaryBytes?: number,
  includeRequired = true,
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
    (component) => (includeRequired && component.required) || selected.has(component.id),
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
export async function pullModel(options: PullOptions): Promise<string> {
  const fileName = resolveFileName(options.model, options.file);
  await downloadRepoFiles({
    repo: options.model.hfRepo,
    files: [fileName],
    destRoot: options.destRoot,
    token: options.token,
    onProgress: options.onProgress,
    signal: options.signal,
  });
  return destinationFor(options.destRoot, options.model.hfRepo, fileName);
}

export interface DownloadFilesOptions {
  repo: string;
  /** Repo-relative file paths (a quant's shards, plus any projector). */
  files: string[];
  destRoot: string;
  token?: string | null;
  onProgress?: (progress: PullProgress) => void;
  signal?: AbortSignal;
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
  signal,
}: DownloadFilesOptions): Promise<string[]> {
  const destinations = files.map((file) => destinationFor(destRoot, repo, file));
  const received = { bytes: 0 };
  const written: string[] = [];
  for (const [index, file] of files.entries()) {
    signal?.throwIfAborted();
    const destination = destinations[index];
    mkdirSync(path.dirname(destination), { recursive: true });
    const lock = `${destination}.part.lock`;
    // Exclusive ownership prevents two pulls from appending to the same partial.
    const release = acquireDownloadLock(lock);
    try {
      const wrote = await streamRepoFile(
        resolveUrl(repo, file),
        destination,
        file,
        token,
        onProgress,
        received,
        signal,
      );
      if (wrote) written.push(destination);
    } finally {
      release();
    }
  }
  return written;
}

/** Like home ownership, only a proven dead owner can be recovered after interruption. */
function acquireDownloadLock(file: string): () => void {
  const contents = JSON.stringify({ pid: process.pid, instanceId: randomUUID() });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(file, "wx", 0o600);
      try {
        writeFileSync(fd, contents);
      } finally {
        closeSync(fd);
      }
      return () => {
        if (readFileSync(file, "utf8") === contents) rmSync(file);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const snapshot = readFileSync(file, "utf8");
      let prior: { pid?: unknown; instanceId?: unknown };
      try {
        prior = JSON.parse(snapshot);
      } catch {
        throw error;
      }
      if (
        typeof prior.pid !== "number" ||
        !Number.isSafeInteger(prior.pid) ||
        prior.pid <= 0 ||
        typeof prior.instanceId !== "string"
      )
        throw error;
      try {
        process.kill(prior.pid, 0);
        throw error;
      } catch (probe) {
        if ((probe as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
      if (readFileSync(file, "utf8") === snapshot) rmSync(file);
    }
  }
  throw new Error("could not claim model download");
}

/** Reject remote traversal and filesystem links before touching a partial. */
export function destinationFor(destRoot: string, repo: string, file: string): string {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo)) throw new Error("unsafe repository id");
  const segments = [...repo.split("/"), ...file.split("/")];
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        /[\\:]/u.test(segment) ||
        segment.includes("\0"),
    )
  )
    throw new Error("unsafe model file path");
  const root = path.resolve(destRoot);
  const destination = path.resolve(root, ...segments);
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    rejectLink(current);
  }
  for (const suffix of [".part", ".part.json", ".part.lock"]) rejectLink(destination + suffix);
  return destination;
}
function rejectLink(file: string): void {
  try {
    if (lstatSync(file).isSymbolicLink()) throw new Error("unsafe model path: symbolic link");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
