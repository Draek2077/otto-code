import { createHash } from "node:crypto";
import { constants, promises as fs, type Stats } from "fs";
import type { FileHandle } from "fs/promises";
import path from "path";
import { writeFileAtomic } from "../atomic-file.js";
import { expandUserPath, resolvePathFromBase } from "../path-utils.js";

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

const TEXT_MIME_TYPES: Record<string, string> = {
  ".json": "application/json",
};

const DEFAULT_TEXT_MIME_TYPE = "text/plain";
const FILE_TYPE_SAMPLE_BYTES = 8192;
const READ_FILE_OPEN_FLAGS =
  process.platform === "win32" ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW;
const ACCESS_OUTSIDE_WORKSPACE_MESSAGE = "Access outside of workspace is not allowed";

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
