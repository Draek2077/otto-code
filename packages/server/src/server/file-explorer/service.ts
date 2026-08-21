import { constants, promises as fs, type BigIntStats, type Stats } from "fs";
import type { FileHandle } from "fs/promises";
import path from "path";
import { writeFileAtomic } from "../atomic-file.js";
import { expandUserPath } from "../path-utils.js";
import {
  ACCESS_OUTSIDE_WORKSPACE_MESSAGE,
  applyEol,
  buildConflictResult,
  createExplorerFile,
  detectEol,
  isLikelyBinary,
  isMissingEntryError,
  normalizeRelativePath,
  resolveScopedPath,
  sha256Hex,
  type ExplorerEol,
} from "./otto-file-mutations.js";

// Back-compat: the files session and its tests import these from this file.
export {
  createExplorerEntry,
  deleteExplorerEntry,
  renameExplorerEntry,
  resolveExplorerFileIdentity,
  writeExplorerBinaryFile,
  type CreateExplorerEntryResult,
  type DeleteExplorerEntryResult,
  type ExplorerEol,
  type ExplorerFileIdentity,
  type RenameExplorerEntryResult,
  type WriteBinaryFileParams,
  type WriteExplorerBinaryFileResult,
} from "./otto-file-mutations.js";

export type ExplorerEntryKind = "file" | "directory";

export type ExplorerFileKind = "text" | "image" | "binary";

export type ExplorerEncoding = "utf-8" | "base64" | "none";

export interface ListDirectoryParams {
  root: string;
  relativePath?: string;
}

export interface ReadFileParams {
  root: string;
  relativePath: string;
}

export interface FileExplorerEntry {
  name: string;
  path: string;
  kind: ExplorerEntryKind;
  size: number;
  modifiedAt: string;
}

export interface FileExplorerDirectory {
  path: string;
  entries: FileExplorerEntry[];
}

export interface FileExplorerFile {
  path: string;
  kind: ExplorerFileKind;
  encoding: ExplorerEncoding;
  content?: string;
  mimeType?: string;
  size: number;
  modifiedAt: string;
  // Present for text files on the inline JSON read path; the editor keeps
  // both as its save-precondition baseline.
  eol?: ExplorerEol;
  hash?: string;
}

export interface WriteFileParams {
  root: string;
  relativePath: string;
  content: string;
  expectedModifiedAt: string;
  expectedHash?: string;
  /** Only the deleted-file "save re-creates" flow sets this. */
  allowCreate?: boolean;
  /** EOL to apply when creating (there is no on-disk EOL to detect). */
  eol?: ExplorerEol;
}

export type WriteExplorerFileResult =
  | { status: "ok"; modifiedAt: string; hash: string; size: number; eol: ExplorerEol }
  | { status: "conflict"; modifiedAt: string; hash: string; content?: string; eol?: ExplorerEol };

export interface FileExplorerFileBytes {
  path: string;
  kind: ExplorerFileKind;
  encoding: "utf-8" | "binary";
  bytes: Uint8Array;
  mimeType: string;
  size: number;
  modifiedAt: string;
}

/**
 * The streaming counterpart to {@link FileExplorerFileBytes}: the same metadata,
 * but the content arrives as chunks instead of one buffer. `revision` pins the
 * exact file the metadata describes, so a consumer that has already forwarded
 * the header can still be told the file moved underneath it.
 */
export interface FileExplorerFileStream {
  path: string;
  kind: ExplorerFileKind;
  encoding: "utf-8" | "binary";
  mimeType: string;
  size: number;
  modifiedAt: string;
  revision: string;
  chunks: AsyncIterable<Uint8Array>;
}

const TEXT_MIME_TYPES: Record<string, string> = {
  ".json": "application/json",
};

const DEFAULT_TEXT_MIME_TYPE = "text/plain";

const FILE_TYPE_SAMPLE_BYTES = 8192;

export const FILE_EXPLORER_STREAM_CHUNK_BYTES = 256 * 1024;

const READ_FILE_OPEN_FLAGS =
  process.platform === "win32" ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW;

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

interface EntryPayloadParams {
  root: string;
  targetPath: string;
  name: string;
  kind: ExplorerEntryKind;
}

export type ExplorerFileVersion =
  | {
      status: "ready";
      cwd: string;
      path: string;
      size: number;
      modifiedAt: string;
      revision: string;
    }
  | { status: "missing"; cwd: string; path: string }
  | { status: "error"; cwd: string; path: string; error: string };

function fileRevision(stats: BigIntStats): string {
  return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}`;
}

/**
 * Compares a caller's recorded mtime against the file's current one, allowing a
 * single millisecond of slack.
 *
 * The wire carries millisecond ISO strings while filesystems keep sub-millisecond
 * stamps, and Node derives `mtime` from `mtimeNs` under bigint stats but from a
 * float `mtimeMs` otherwise. Those two roundings can land a millisecond apart for
 * the very same untouched file, so a caller that read its mtime through a plain
 * stat could be told its save conflicted with itself. The slack is smaller than
 * the resolution the string can express, so it cannot mask a real edit: any write
 * that actually changed the file moves the stamp far further than that.
 */
function matchesExpectedModifiedAt(expected: string | undefined, current: string): boolean {
  if (expected === current) {
    return true;
  }
  if (expected === undefined) {
    return false;
  }
  const expectedMs = Date.parse(expected);
  const currentMs = Date.parse(current);
  if (Number.isNaN(expectedMs) || Number.isNaN(currentMs)) {
    return false;
  }
  return Math.abs(expectedMs - currentMs) <= 1;
}

export async function listDirectoryEntries({
  root,
  relativePath = ".",
}: ListDirectoryParams): Promise<FileExplorerDirectory> {
  const directoryPath = await resolveScopedPath({ root, relativePath });
  const stats = await fs.stat(directoryPath.resolvedPath);

  if (!stats.isDirectory()) {
    throw new Error("Requested path is not a directory");
  }

  const dirents = await fs.readdir(directoryPath.resolvedPath, { withFileTypes: true });

  const entriesWithNulls = await Promise.all(
    dirents.map(async (dirent) => {
      const targetPath = path.join(directoryPath.requestedPath, dirent.name);
      const kind: ExplorerEntryKind = dirent.isDirectory() ? "directory" : "file";
      try {
        return await buildEntryPayload({
          root,
          targetPath,
          name: dirent.name,
          kind,
        });
      } catch (error) {
        // Directories can contain dangling links (e.g. AGENTS.md -> CLAUDE.md).
        // Skip entries whose targets disappeared instead of failing the whole listing.
        if (isMissingEntryError(error) || isOutsideWorkspaceError(error)) {
          return null;
        }
        throw error;
      }
    }),
  );
  const entries = entriesWithNulls.filter((entry): entry is FileExplorerEntry => entry !== null);

  entries.sort((a, b) => {
    const modifiedComparison = new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
    if (modifiedComparison !== 0) {
      return modifiedComparison;
    }
    return a.name.localeCompare(b.name);
  });

  return {
    path: normalizeRelativePath({ root, targetPath: directoryPath.requestedPath }),
    entries,
  };
}

export async function readExplorerFile({
  root,
  relativePath,
}: ReadFileParams): Promise<FileExplorerFile> {
  const file = await readExplorerFileBytes({ root, relativePath });

  if (file.kind === "image") {
    return {
      path: file.path,
      kind: file.kind,
      encoding: "base64",
      content: Buffer.from(file.bytes).toString("base64"),
      mimeType: file.mimeType,
      size: file.size,
      modifiedAt: file.modifiedAt,
    };
  }

  if (file.kind === "binary") {
    return {
      path: file.path,
      kind: file.kind,
      encoding: "none",
      mimeType: file.mimeType,
      size: file.size,
      modifiedAt: file.modifiedAt,
    };
  }

  const text = Buffer.from(file.bytes).toString("utf-8");
  return {
    path: file.path,
    kind: file.kind,
    encoding: "utf-8",
    content: text,
    mimeType: file.mimeType,
    size: file.size,
    modifiedAt: file.modifiedAt,
    eol: detectEol(text),
    hash: sha256Hex(file.bytes),
  };
}

/**
 * Conditional, atomic save for the text editor. Refuses to write unless the
 * on-disk file still matches the identity the client last read (hash when
 * provided, mtime otherwise) - a mismatch returns a conflict and leaves the
 * file untouched. Content arrives LF-normalized; the file's detected EOL is
 * re-applied so uniform CRLF files round-trip byte-identical.
 */
export async function writeExplorerFile({
  root,
  relativePath,
  content,
  expectedModifiedAt,
  expectedHash,
  allowCreate,
  eol: requestedEol,
}: WriteFileParams): Promise<WriteExplorerFileResult> {
  const filePath = await resolveScopedPath({ root, relativePath });

  // The editor only saves files it opened; a missing target is never an
  // invitation to create one through this RPC - except the explicit
  // deleted-file "save re-creates" flow.
  let handle: FileHandle;
  try {
    handle = await openFileForRead(filePath.resolvedPath);
  } catch (error) {
    if (isMissingEntryError(error)) {
      if (allowCreate) {
        return createExplorerFile({
          resolvedPath: filePath.resolvedPath,
          content,
          eol: requestedEol ?? "lf",
        });
      }
      throw new Error("File no longer exists on disk", { cause: error });
    }
    throw error;
  }

  let stats: Stats;
  let currentBytes: Buffer;
  try {
    stats = await handle.stat();
    if (!stats.isFile()) {
      throw new Error("Requested path is not a file");
    }
    currentBytes = await handle.readFile();
  } finally {
    await handle.close();
  }

  const currentModifiedAt = stats.mtime.toISOString();
  const currentHash = sha256Hex(currentBytes);
  const unchanged = expectedHash
    ? expectedHash === currentHash
    : matchesExpectedModifiedAt(expectedModifiedAt, currentModifiedAt);
  if (!unchanged) {
    return buildConflictResult(currentBytes, currentModifiedAt);
  }

  if (isLikelyBinary(currentBytes)) {
    throw new Error("Refusing to overwrite a binary file");
  }

  const eol = detectEol(currentBytes.toString("utf-8"));
  const outputBytes = applyEol(content, eol);
  // The check-then-replace window is unavoidable without file locks; the
  // replacement itself is all-or-nothing, and mode is preserved so executable
  // scripts keep their bits.
  // Number(), because these are BigIntStats and fs.chmod rejects a bigint mode.
  await writeFileAtomic(filePath.resolvedPath, outputBytes, { mode: Number(stats.mode) });
  const newStats = await fs.stat(filePath.resolvedPath);
  return {
    status: "ok",
    modifiedAt: newStats.mtime.toISOString(),
    hash: sha256Hex(outputBytes),
    size: outputBytes.length,
    eol,
  };
}

export async function readExplorerFileBytes({
  root,
  relativePath,
}: ReadFileParams): Promise<FileExplorerFileBytes> {
  const filePath = await resolveScopedPath({ root, relativePath });
  const handle = await openFileForRead(filePath.resolvedPath);

  try {
    const stats = await handle.stat();

    if (!stats.isFile()) {
      throw new Error("Requested path is not a file");
    }

    const ext = path.extname(filePath.resolvedPath).toLowerCase();
    const basePayload = {
      path: normalizeRelativePath({ root, targetPath: filePath.requestedPath }),
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    };

    const buffer = await handle.readFile();
    if (ext in IMAGE_MIME_TYPES) {
      return {
        ...basePayload,
        kind: "image",
        encoding: "binary",
        bytes: buffer,
        mimeType: IMAGE_MIME_TYPES[ext],
      };
    }

    if (isLikelyBinary(buffer)) {
      return {
        ...basePayload,
        kind: "binary",
        encoding: "binary",
        bytes: buffer,
        mimeType: "application/octet-stream",
      };
    }

    return {
      ...basePayload,
      kind: "text",
      encoding: "utf-8",
      bytes: buffer,
      mimeType: textMimeTypeForExtension(ext),
    };
  } finally {
    await handle.close();
  }
}

/**
 * Reads a file to a consumer in bounded chunks instead of buffering it whole.
 * `readExplorerFileBytes` calls `handle.readFile()`, so opening a large file in
 * the viewer used to allocate the entire thing before a single byte reached the
 * client, which is how large file views ended up disconnecting.
 *
 * The handle stays open for the whole callback, and the revision captured up
 * front is re-checked after the last chunk: a file that grows, shrinks, or is
 * overwritten mid-transfer fails loudly rather than delivering a silently
 * spliced-together mix of two revisions.
 */
export async function streamExplorerFile(
  { root, relativePath }: ReadFileParams,
  consume: (file: FileExplorerFileStream) => Promise<void>,
): Promise<void> {
  const filePath = await resolveScopedPath({ root, relativePath });
  const handle = await openFileForRead(filePath.resolvedPath);

  try {
    const stats = await handle.stat({ bigint: true });
    if (!stats.isFile()) {
      throw new Error("Requested path is not a file");
    }

    const advertisedSize = Number(stats.size);
    const advertisedRevision = fileRevision(stats);
    const ext = path.extname(filePath.resolvedPath).toLowerCase();
    const isImage = ext in IMAGE_MIME_TYPES;
    const isBinary = isImage || (await isFileHandleBinary(handle, advertisedSize));
    let kind: ExplorerFileKind = "text";
    let mimeType = textMimeTypeForExtension(ext);
    if (isImage) {
      kind = "image";
      mimeType = IMAGE_MIME_TYPES[ext];
    } else if (isBinary) {
      kind = "binary";
      mimeType = "application/octet-stream";
    }

    await consume({
      path: normalizeRelativePath({ root, targetPath: filePath.requestedPath }),
      kind,
      encoding: isBinary ? "binary" : "utf-8",
      mimeType,
      size: advertisedSize,
      modifiedAt: stats.mtime.toISOString(),
      revision: advertisedRevision,
      chunks: readFileHandleChunks(handle, advertisedSize, advertisedRevision),
    });
  } finally {
    await handle.close();
  }
}

/**
 * Classifies a file without buffering it. `isLikelyBinary` only ever sees the
 * first sample block, so a text file with binary bytes past that block reads as
 * text; this walks the whole file, and decodes with a streaming UTF-8 decoder so
 * a multi-byte sequence split across two blocks is not mistaken for garbage.
 */
async function isFileHandleBinary(handle: FileHandle, advertisedSize: number): Promise<boolean> {
  if (advertisedSize === 0) return false;

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let position = 0;
  let suspiciousBytes = 0;
  while (position < advertisedSize) {
    const block = Buffer.allocUnsafe(
      Math.min(FILE_EXPLORER_STREAM_CHUNK_BYTES, advertisedSize - position),
    );
    const { bytesRead } = await handle.read(block, 0, block.byteLength, position);
    if (bytesRead === 0) {
      throw new Error("File changed during transfer");
    }
    const bytes = block.subarray(0, bytesRead);
    for (const byte of bytes) {
      if (byte === 0) return true;
      const isControl = byte < 32 && byte !== 9 && byte !== 10 && byte !== 13;
      if (isControl || byte === 127) suspiciousBytes += 1;
    }
    try {
      decoder.decode(bytes, { stream: true });
    } catch {
      return true;
    }
    position += bytesRead;
  }

  // Flushes the decoder: a file ending on a truncated multi-byte sequence is
  // only detectable here, once there is no more input to complete it.
  try {
    decoder.decode();
  } catch {
    return true;
  }
  return suspiciousBytes / advertisedSize > 0.3;
}

async function* readFileHandleChunks(
  handle: FileHandle,
  advertisedSize: number,
  advertisedRevision: string,
): AsyncIterable<Uint8Array> {
  let position = 0;
  while (position < advertisedSize) {
    const chunk = Buffer.allocUnsafe(
      Math.min(FILE_EXPLORER_STREAM_CHUNK_BYTES, advertisedSize - position),
    );
    const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, position);
    if (bytesRead === 0) {
      throw new Error("File changed during transfer");
    }
    position += bytesRead;
    yield chunk.subarray(0, bytesRead);
  }

  const finalStats = await handle.stat({ bigint: true });
  if (fileRevision(finalStats) !== advertisedRevision) {
    throw new Error("File changed during transfer");
  }
}

export async function getDownloadableFileInfo({ root, relativePath }: ReadFileParams): Promise<{
  path: string;
  absolutePath: string;
  fileName: string;
  mimeType: string;
  size: number;
}> {
  const filePath = await resolveScopedPath({ root, relativePath });
  const handle = await openFileForRead(filePath.resolvedPath);

  try {
    const stats = await handle.stat();

    if (!stats.isFile()) {
      throw new Error("Requested path is not a file");
    }

    const ext = path.extname(filePath.resolvedPath).toLowerCase();
    let mimeType = "application/octet-stream";
    if (ext in IMAGE_MIME_TYPES) {
      mimeType = IMAGE_MIME_TYPES[ext];
    } else {
      const sample = Buffer.alloc(FILE_TYPE_SAMPLE_BYTES);
      const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
      const chunk = bytesRead < sample.length ? sample.subarray(0, bytesRead) : sample;
      if (!isLikelyBinary(chunk)) {
        mimeType = textMimeTypeForExtension(ext);
      }
    }

    return {
      path: normalizeRelativePath({ root, targetPath: filePath.requestedPath }),
      absolutePath: filePath.resolvedPath,
      fileName: path.basename(filePath.requestedPath),
      mimeType,
      size: stats.size,
    };
  } finally {
    await handle.close();
  }
}

async function openFileForRead(filePath: string): Promise<FileHandle> {
  return fs.open(filePath, READ_FILE_OPEN_FLAGS);
}

async function buildEntryPayload({
  root,
  targetPath,
  name,
  kind,
}: EntryPayloadParams): Promise<FileExplorerEntry> {
  const entryPath = await resolveScopedPath({
    root,
    relativePath: normalizeRelativePath({ root, targetPath }),
  });
  const stats = await fs.stat(entryPath.resolvedPath);
  return {
    name,
    path: normalizeRelativePath({ root, targetPath }),
    kind,
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
  };
}

function isOutsideWorkspaceError(error: unknown): boolean {
  return error instanceof Error && error.message === ACCESS_OUTSIDE_WORKSPACE_MESSAGE;
}

function textMimeTypeForExtension(ext: string): string {
  return TEXT_MIME_TYPES[ext] ?? DEFAULT_TEXT_MIME_TYPE;
}

export async function getExplorerFileVersion({
  root,
  relativePath,
}: ReadFileParams): Promise<ExplorerFileVersion> {
  const cwd = expandUserPath(root);
  try {
    const filePath = await resolveScopedPath({ root, relativePath });
    const stats = await fs.stat(filePath.resolvedPath, { bigint: true });
    if (!stats.isFile()) {
      return { status: "error", cwd, path: relativePath, error: "Requested path is not a file" };
    }
    return {
      status: "ready",
      cwd,
      path: normalizeRelativePath({ root, targetPath: filePath.requestedPath }),
      size: Number(stats.size),
      modifiedAt: stats.mtime.toISOString(),
      revision: fileRevision(stats),
    };
  } catch (error) {
    if (isMissingEntryError(error)) {
      return { status: "missing", cwd, path: relativePath };
    }
    return {
      status: "error",
      cwd,
      path: relativePath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function resolveExplorerFilePath({
  root,
  relativePath,
}: ReadFileParams): Promise<string> {
  return (await resolveScopedPath({ root, relativePath })).resolvedPath;
}

export type DuplicateExplorerEntryResult =
  | { status: "ok"; path: string }
  | { status: "error"; error: string };

/** Duplicate a file or directory beside its source without overwriting an existing copy. */
export async function duplicateExplorerEntry({
  root,
  relativePath,
}: ReadFileParams): Promise<DuplicateExplorerEntryResult> {
  try {
    const source = await resolveScopedPath({ root, relativePath });
    const realRoot = await fs.realpath(expandUserPath(root));
    if (source.resolvedPath === realRoot) {
      return { status: "error", error: "Cannot duplicate the workspace root" };
    }

    const stats = await fs.lstat(source.requestedPath);
    const sourceName = path.basename(source.requestedPath);
    const extension = stats.isDirectory() ? "" : path.extname(sourceName);
    const baseName = extension ? sourceName.slice(0, -extension.length) : sourceName;
    let targetPath = "";
    for (let copyNumber = 1; ; copyNumber += 1) {
      const suffix = copyNumber === 1 ? " copy" : ` copy ${copyNumber}`;
      targetPath = path.join(
        path.dirname(source.requestedPath),
        `${baseName}${suffix}${extension}`,
      );
      try {
        await fs.lstat(targetPath);
      } catch (error) {
        if (isMissingEntryError(error)) break;
        throw error;
      }
    }

    await fs.cp(source.requestedPath, targetPath, {
      recursive: stats.isDirectory(),
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
    });
    return { status: "ok", path: normalizeRelativePath({ root, targetPath }) };
  } catch (error) {
    if (isMissingEntryError(error)) {
      return { status: "error", error: "File or folder no longer exists" };
    }
    return { status: "error", error: error instanceof Error ? error.message : String(error) };
  }
}
