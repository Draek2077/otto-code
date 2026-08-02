import { createHash } from "node:crypto";
import { constants, promises as fs, type BigIntStats, type Stats } from "fs";
import type { FileHandle } from "fs/promises";
import path from "path";
import { writeFileAtomic } from "../atomic-file.js";
import { expandUserPath, isSameOrDescendantPath, resolvePathFromBase } from "../path-utils.js";

export type ExplorerEntryKind = "file" | "directory";
export type ExplorerFileKind = "text" | "image" | "binary";
export type ExplorerEncoding = "utf-8" | "base64" | "none";
export type ExplorerEol = "lf" | "crlf";

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

export interface ExplorerFileIdentity {
  modifiedAt: string;
  hash: string;
  size: number;
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
const ACCESS_OUTSIDE_WORKSPACE_MESSAGE = "Access outside of workspace is not allowed";
const WORKSPACE_ROOT_TARGET_MESSAGE = "The workspace root cannot be created, renamed, or deleted";

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

interface ScopedPathParams {
  root: string;
  relativePath?: string;
}

interface ScopedPath {
  requestedPath: string;
  resolvedPath: string;
}

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
 * provided, mtime otherwise) — a mismatch returns a conflict and leaves the
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
  // invitation to create one through this RPC — except the explicit
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
    : expectedModifiedAt === currentModifiedAt;
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
  await writeFileAtomic(filePath.resolvedPath, outputBytes, { mode: stats.mode });
  const newStats = await fs.stat(filePath.resolvedPath);
  return {
    status: "ok",
    modifiedAt: newStats.mtime.toISOString(),
    hash: sha256Hex(outputBytes),
    size: outputBytes.length,
    eol,
  };
}

async function createExplorerFile({
  resolvedPath,
  content,
  eol,
}: {
  resolvedPath: string;
  content: string;
  eol: ExplorerEol;
}): Promise<WriteExplorerFileResult> {
  const outputBytes = applyEol(content, eol);
  // Exclusive create: if the file reappeared between the missing-open above
  // and here, surface the newcomer as a conflict rather than clobbering it.
  let handle: FileHandle;
  try {
    handle = await fs.open(resolvedPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === "EEXIST") {
      const currentBytes = await fs.readFile(resolvedPath);
      const stats = await fs.stat(resolvedPath);
      return buildConflictResult(currentBytes, stats.mtime.toISOString());
    }
    throw error;
  }
  try {
    await handle.writeFile(outputBytes);
  } finally {
    await handle.close();
  }
  const stats = await fs.stat(resolvedPath);
  return {
    status: "ok",
    modifiedAt: stats.mtime.toISOString(),
    hash: sha256Hex(outputBytes),
    size: outputBytes.length,
    eol,
  };
}

export type CreateExplorerEntryResult =
  | { status: "ok"; path: string; kind: ExplorerEntryKind; modifiedAt: string; size: number }
  | { status: "exists" };

export type DeleteExplorerEntryResult =
  | { status: "ok"; path: string; kind: ExplorerEntryKind }
  | { status: "not_found" }
  | { status: "not_empty" };

export type RenameExplorerEntryResult =
  | { status: "ok"; from: string; to: string; kind: ExplorerEntryKind }
  | { status: "not_found" }
  | { status: "exists" };

/**
 * Create an entry. Never overwrites: both branches use an exclusive create, so
 * a target that already exists comes back as `exists` and the file on disk is
 * untouched.
 */
export async function createExplorerEntry({
  root,
  relativePath,
  kind,
}: {
  root: string;
  relativePath: string;
  kind: ExplorerEntryKind;
}): Promise<CreateExplorerEntryResult> {
  const target = await resolveMutationPath({ root, relativePath });

  try {
    if (kind === "directory") {
      await fs.mkdir(target.resolvedPath);
    } else {
      // "wx" — exclusive create. `writeFile` would happily truncate an existing
      // file, which is the one thing this must never do.
      const handle = await fs.open(target.resolvedPath, "wx");
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === "EEXIST") {
      return { status: "exists" };
    }
    throw error;
  }

  const stats = await fs.stat(target.resolvedPath);
  return {
    status: "ok",
    path: target.relativePath,
    kind,
    modifiedAt: stats.mtime.toISOString(),
    size: stats.size,
  };
}

/**
 * Permanently remove an entry. This is an unlink, not a move to any trash — see
 * `FileDeleteRequestSchema` for why the daemon does not pretend to have one.
 *
 * `lstat` and `unlink`, never `stat`: a symlink is deleted as the link it is,
 * not followed to whatever it points at.
 */
export async function deleteExplorerEntry({
  root,
  relativePath,
  recursive,
}: {
  root: string;
  relativePath: string;
  recursive?: boolean;
}): Promise<DeleteExplorerEntryResult> {
  const target = await resolveMutationPath({ root, relativePath });

  let stats: Stats;
  try {
    stats = await fs.lstat(target.resolvedPath);
  } catch (error) {
    if (isMissingEntryError(error)) {
      return { status: "not_found" };
    }
    throw error;
  }

  if (stats.isDirectory()) {
    if (!recursive) {
      const entries = await fs.readdir(target.resolvedPath);
      if (entries.length > 0) {
        return { status: "not_empty" };
      }
    }
    await fs.rm(target.resolvedPath, { recursive: true });
    return { status: "ok", path: target.relativePath, kind: "directory" };
  }

  await fs.unlink(target.resolvedPath);
  return { status: "ok", path: target.relativePath, kind: "file" };
}

/**
 * Rename, which is also move — the destination may sit in a different parent.
 *
 * Never clobbers. POSIX `rename` silently replaces an existing destination
 * while Windows refuses it; the explicit pre-check is what makes both hosts
 * behave the same way, and the safe way.
 */
export async function renameExplorerEntry({
  root,
  relativePath,
  newRelativePath,
}: {
  root: string;
  relativePath: string;
  newRelativePath: string;
}): Promise<RenameExplorerEntryResult> {
  const source = await resolveMutationPath({ root, relativePath });
  const destination = await resolveMutationPath({ root, relativePath: newRelativePath });

  let stats: Stats;
  try {
    stats = await fs.lstat(source.resolvedPath);
  } catch (error) {
    if (isMissingEntryError(error)) {
      return { status: "not_found" };
    }
    throw error;
  }

  if (source.resolvedPath === destination.resolvedPath) {
    return { status: "exists" };
  }

  // A directory moved inside itself would orphan the whole subtree; `rename`
  // reports this as a bare EINVAL, which is not a sentence anyone can act on.
  if (
    stats.isDirectory() &&
    isSameOrDescendantPath(source.resolvedPath, destination.resolvedPath)
  ) {
    throw new Error("Cannot move a folder into itself");
  }

  try {
    await fs.lstat(destination.resolvedPath);
    return { status: "exists" };
  } catch (error) {
    if (!isMissingEntryError(error)) {
      throw error;
    }
  }

  await fs.rename(source.resolvedPath, destination.resolvedPath);
  return {
    status: "ok",
    from: source.relativePath,
    to: destination.relativePath,
    kind: stats.isDirectory() ? "directory" : "file",
  };
}

/**
 * The path guard for every mutation, and the reason they are a separate
 * resolver from `resolveScopedPath`.
 *
 * Reads resolve the *target's* realpath, which is right for reading: a symlink
 * to a file inside the workspace should serve that file. A mutation must not do
 * that — deleting a link would delete its target, and renaming one would move
 * the target instead. So the final component is never followed. What is
 * resolved is the **parent**, because a symlinked parent directory is exactly
 * how `a/../..` style traversal sneaks past a lexical check: `root/link/x` is
 * lexically inside `root` no matter where `link` points.
 *
 * Three refusals, in order:
 *  - the workspace root itself is not a target (the explorer cannot delete the
 *    workspace it is browsing),
 *  - the requested path must be lexically inside the root,
 *  - the parent's *real* path must be inside the root's real path.
 */
async function resolveMutationPath({
  root,
  relativePath,
}: {
  root: string;
  relativePath: string;
}): Promise<{ resolvedPath: string; relativePath: string }> {
  const trimmed = relativePath.trim();
  if (!trimmed) {
    throw new Error("path is required");
  }

  const normalizedRoot = expandUserPath(root);
  const requestedPath = resolvePathFromBase(normalizedRoot, trimmed);
  const relative = path.relative(normalizedRoot, requestedPath);

  if (relative === "") {
    throw new Error(WORKSPACE_ROOT_TARGET_MESSAGE);
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(ACCESS_OUTSIDE_WORKSPACE_MESSAGE);
  }

  const realRoot = await fs.realpath(normalizedRoot);
  let realParent: string;
  try {
    realParent = await fs.realpath(path.dirname(requestedPath));
  } catch (error) {
    if (isMissingEntryError(error)) {
      throw new Error("Parent directory does not exist", { cause: error });
    }
    throw error;
  }

  const parentRelative = path.relative(realRoot, realParent);
  if (
    parentRelative !== "" &&
    (parentRelative.startsWith("..") || path.isAbsolute(parentRelative))
  ) {
    throw new Error(ACCESS_OUTSIDE_WORKSPACE_MESSAGE);
  }

  const resolvedPath = path.join(realParent, path.basename(requestedPath));
  return {
    resolvedPath,
    relativePath: normalizeRelativePath({ root, targetPath: requestedPath }),
  };
}

/**
 * Containment-checked stat (+ hash) used by the file watcher. Returns a null
 * identity when the file does not exist; throws on containment violations.
 * Passing the previous identity skips re-hashing when mtime and size are
 * unchanged.
 */
export async function resolveExplorerFileIdentity({
  root,
  relativePath,
  previous,
}: ReadFileParams & { previous?: ExplorerFileIdentity | null }): Promise<{
  resolvedPath: string;
  identity: ExplorerFileIdentity | null;
}> {
  const filePath = await resolveScopedPath({ root, relativePath });
  let stats: Stats;
  try {
    stats = await fs.stat(filePath.resolvedPath);
  } catch (error) {
    if (isMissingEntryError(error)) {
      return { resolvedPath: filePath.resolvedPath, identity: null };
    }
    throw error;
  }
  if (!stats.isFile()) {
    return { resolvedPath: filePath.resolvedPath, identity: null };
  }
  const modifiedAt = stats.mtime.toISOString();
  if (previous && previous.modifiedAt === modifiedAt && previous.size === stats.size) {
    return { resolvedPath: filePath.resolvedPath, identity: previous };
  }
  const bytes = await fs.readFile(filePath.resolvedPath);
  return {
    resolvedPath: filePath.resolvedPath,
    identity: { modifiedAt, hash: sha256Hex(bytes), size: stats.size },
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

async function resolveScopedPath({
  root,
  relativePath = ".",
}: ScopedPathParams): Promise<ScopedPath> {
  const normalizedRoot = expandUserPath(root);
  const requestedPath = resolvePathFromBase(normalizedRoot, relativePath);
  const relative = path.relative(normalizedRoot, requestedPath);

  if (relative !== "" && (relative.startsWith("..") || path.isAbsolute(relative))) {
    throw new Error(ACCESS_OUTSIDE_WORKSPACE_MESSAGE);
  }

  const realRoot = await fs.realpath(normalizedRoot);

  try {
    const realPath = await fs.realpath(requestedPath);
    const realRelative = path.relative(realRoot, realPath);
    if (realRelative !== "" && (realRelative.startsWith("..") || path.isAbsolute(realRelative))) {
      throw new Error(ACCESS_OUTSIDE_WORKSPACE_MESSAGE);
    }
    return { requestedPath, resolvedPath: realPath };
  } catch (error) {
    if (isMissingEntryError(error)) {
      return { requestedPath, resolvedPath: requestedPath };
    }
    throw error;
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

function isMissingEntryError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP";
}

function isOutsideWorkspaceError(error: unknown): boolean {
  return error instanceof Error && error.message === ACCESS_OUTSIDE_WORKSPACE_MESSAGE;
}

function normalizeRelativePath({ root, targetPath }: { root: string; targetPath: string }): string {
  const normalizedRoot = expandUserPath(root);
  const normalizedTarget = expandUserPath(targetPath);
  const relative = path.relative(normalizedRoot, normalizedTarget);
  return relative === "" ? "." : relative.split(path.sep).join("/");
}

function textMimeTypeForExtension(ext: string): string {
  return TEXT_MIME_TYPES[ext] ?? DEFAULT_TEXT_MIME_TYPE;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function applyEol(content: string, eol: ExplorerEol): Buffer {
  const normalized = content.replace(/\r\n?/g, "\n");
  return Buffer.from(eol === "crlf" ? normalized.replace(/\n/g, "\r\n") : normalized, "utf-8");
}

function buildConflictResult(currentBytes: Buffer, modifiedAt: string): WriteExplorerFileResult {
  const hash = sha256Hex(currentBytes);
  if (isLikelyBinary(currentBytes)) {
    return { status: "conflict", modifiedAt, hash };
  }
  const currentText = currentBytes.toString("utf-8");
  return {
    status: "conflict",
    modifiedAt,
    hash,
    content: currentText,
    eol: detectEol(currentText),
  };
}

// Majority rule: a mixed-EOL file is normalized to its dominant ending on the
// next save. Uniform files (the overwhelmingly common case) round-trip
// byte-identical.
function detectEol(text: string): ExplorerEol {
  let crlf = 0;
  let lf = 0;
  for (let idx = 0; idx < text.length; idx += 1) {
    if (text.charCodeAt(idx) !== 10) {
      continue;
    }
    if (idx > 0 && text.charCodeAt(idx - 1) === 13) {
      crlf += 1;
    } else {
      lf += 1;
    }
  }
  return crlf > lf ? "crlf" : "lf";
}

function isLikelyBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return false;
  }

  let suspicious = 0;
  for (let idx = 0; idx < buffer.length; idx += 1) {
    const byte = buffer[idx];
    if (byte === 0) {
      return true;
    }

    const isControl =
      byte < 32 &&
      byte !== 9 && // tab
      byte !== 10 && // newline
      byte !== 13; // carriage return

    if (isControl || byte === 127) {
      suspicious += 1;
    }
  }

  return suspicious / buffer.length > 0.3;
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
