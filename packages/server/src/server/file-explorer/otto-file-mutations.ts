// Otto's file mutation layer: entry create/delete/rename with mutation-path
// resolution, the binary write, and the file identity / EOL / write-conflict
// machinery, extracted from the Paseo file-explorer service shell. The shared
// path plumbing (resolveScopedPath and friends) relocated here because both
// sides call it and this module must not value-import the shell; the shell
// imports it back. Type-only imports from service.ts are erased at runtime,
// so there is no module cycle.
import { createHash } from "node:crypto";
import { promises as fs, type Stats } from "fs";
import type { FileHandle } from "fs/promises";
import path from "path";
import { writeFileAtomic } from "../atomic-file.js";
import { expandUserPath, isSameOrDescendantPath, resolvePathFromBase } from "../path-utils.js";
import type { ExplorerEntryKind, ReadFileParams, WriteExplorerFileResult } from "./service.js";

export type ExplorerEol = "lf" | "crlf";

export interface WriteBinaryFileParams {
  root: string;
  relativePath: string;
  bytes: Buffer;
  /** Replace an existing file. Off by default; an existing target is `exists`. */
  overwrite?: boolean;
  // Missing parent directories are created either way; see the implementation.
}

export type WriteExplorerBinaryFileResult =
  | { status: "written"; modifiedAt: string; size: number }
  | { status: "exists" };

export interface ExplorerFileIdentity {
  modifiedAt: string;
  hash: string;
  size: number;
}

export const ACCESS_OUTSIDE_WORKSPACE_MESSAGE = "Access outside of workspace is not allowed";

const WORKSPACE_ROOT_TARGET_MESSAGE = "The workspace root cannot be created, renamed, or deleted";

interface ScopedPathParams {
  root: string;
  relativePath?: string;
}

interface ScopedPath {
  requestedPath: string;
  resolvedPath: string;
}

/**
 * Write bytes to a file, verbatim.
 *
 * The sibling of `writeExplorerFile` for content that is not text. It shares
 * that function's path scoping and its atomic replace, and deliberately shares
 * none of its text handling: no EOL detection, no EOL re-application, and none
 * of the `isLikelyBinary` refusal - a PNG or a PDF *is* the binary file that
 * check exists to protect, so re-exporting one has to be allowed.
 *
 * There is no conditional-write precondition here either; see
 * `FsFileWriteBinaryRequestSchema` for why. `overwrite` is the whole policy.
 */
export async function writeExplorerBinaryFile({
  root,
  relativePath,
  bytes,
  overwrite,
}: WriteBinaryFileParams): Promise<WriteExplorerBinaryFileResult> {
  // Both branches below need the target's parent directories, because one of
  // them would create them anyway: `writeFileAtomic` mkdirs before it writes,
  // and an exclusive `open(…, "wx")` does not. Directory creation that depended
  // on whether the caller passed `overwrite` would be nobody's intent.
  await createContainedParentDirectories({ root, relativePath });

  // `resolveMutationPath`, not `resolveScopedPath`. This call CREATES files, and
  // for a target that does not exist yet `resolveScopedPath` has nothing to
  // resolve - its realpath throws ENOENT and it falls back to returning the
  // requested path unchecked, leaving only the lexical `..` test. A parent
  // directory that is a symlink out of the workspace passes that and the bytes
  // land wherever it points. `resolveMutationPath` resolves the parent's REAL
  // path instead, which is the same guard create/delete/rename use and the
  // reason those three can be trusted with names that are not on disk yet.
  const filePath = await resolveMutationPath({ root, relativePath });

  if (!overwrite) {
    // Exclusive create, so the not-there check and the write are one operation
    // rather than a stat the target can slip through behind.
    let handle: FileHandle;
    try {
      handle = await fs.open(filePath.resolvedPath, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === "EEXIST") {
        return { status: "exists" };
      }
      throw error;
    }
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
    const stats = await fs.stat(filePath.resolvedPath);
    return { status: "written", modifiedAt: stats.mtime.toISOString(), size: bytes.length };
  }

  // Preserve the existing file's mode when there is one, matching the text
  // write: replacing a generated artifact should not change its permissions.
  let mode: number | undefined;
  try {
    const existing = await fs.stat(filePath.resolvedPath);
    if (!existing.isFile()) {
      throw new Error("Requested path is not a file");
    }
    mode = existing.mode;
  } catch (error) {
    if (!isMissingEntryError(error)) {
      throw error;
    }
  }

  await writeFileAtomic(filePath.resolvedPath, bytes, mode === undefined ? undefined : { mode });
  const stats = await fs.stat(filePath.resolvedPath);
  return { status: "written", modifiedAt: stats.mtime.toISOString(), size: bytes.length };
}

export async function createExplorerFile({
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
      // "wx" - exclusive create. `writeFile` would happily truncate an existing
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
 * Permanently remove an entry. This is an unlink, not a move to any trash - see
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
 * Rename, which is also move - the destination may sit in a different parent.
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
 * that - deleting a link would delete its target, and renaming one would move
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
 * Create a target's missing parent directories, one segment at a time, refusing
 * to step outside the workspace root.
 *
 * `mkdir(…, { recursive: true })` would be one call and the wrong one: if any
 * existing segment is a symlink pointing out of the workspace it cheerfully
 * builds the rest of the tree at the far end, and a containment check that ran
 * afterwards would only get to decline a directory it had already created out
 * there. Walking down and re-resolving each segment means the first escape
 * stops the walk before anything beyond it exists.
 *
 * Runs BEFORE `resolveMutationPath`, which requires the parent to be on disk -
 * it reports a missing one as an error rather than creating it, because for
 * create/delete/rename a missing parent really is a mistake.
 *
 * The final component is the file, never created here: the exclusive create in
 * {@link writeExplorerBinaryFile} has to stay the operation that discovers an
 * occupied target.
 */
async function createContainedParentDirectories({
  root,
  relativePath,
}: {
  root: string;
  relativePath: string;
}): Promise<void> {
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
  let current = realRoot;
  for (const segment of relative.split(path.sep).slice(0, -1)) {
    const next = path.join(current, segment);
    try {
      await fs.mkdir(next);
    } catch (error) {
      // Already there is the ordinary case. Only the escape check below decides
      // whether "already there" is somewhere we are allowed to be.
      if ((error as NodeJS.ErrnoException | null)?.code !== "EEXIST") {
        throw error;
      }
    }
    current = await fs.realpath(next);
    const containedRelative = path.relative(realRoot, current);
    if (containedRelative.startsWith("..") || path.isAbsolute(containedRelative)) {
      throw new Error(ACCESS_OUTSIDE_WORKSPACE_MESSAGE);
    }
  }
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

export async function resolveScopedPath({
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

export function isMissingEntryError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP";
}

export function normalizeRelativePath({
  root,
  targetPath,
}: {
  root: string;
  targetPath: string;
}): string {
  const normalizedRoot = expandUserPath(root);
  const normalizedTarget = expandUserPath(targetPath);
  const relative = path.relative(normalizedRoot, normalizedTarget);
  return relative === "" ? "." : relative.split(path.sep).join("/");
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function applyEol(content: string, eol: ExplorerEol): Buffer {
  const normalized = content.replace(/\r\n?/g, "\n");
  return Buffer.from(eol === "crlf" ? normalized.replace(/\n/g, "\r\n") : normalized, "utf-8");
}

export function buildConflictResult(
  currentBytes: Buffer,
  modifiedAt: string,
): WriteExplorerFileResult {
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
export function detectEol(text: string): ExplorerEol {
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

export function isLikelyBinary(buffer: Buffer): boolean {
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
