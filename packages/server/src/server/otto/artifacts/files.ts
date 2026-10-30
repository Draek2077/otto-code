import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, rename, unlink, rmdir, open } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { replaceStagedArtifact } from "./atomic-replace.js";

export class ArtifactError extends Error {
  constructor(
    readonly code: "invalid" | "conflict" | "busy" | "unavailable",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
export function digest(bytes: string): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
export function safeId(id: string): void {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(id) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id))
    throw new ArtifactError("invalid", "Invalid artifact identity.");
}
/** No filesystem path ever arrives from the client. Existing links, including ancestor links, are refused. */
export async function safeDirectory(
  boundary: string,
  directory: string,
  create = false,
): Promise<void> {
  const relative = path.relative(boundary, directory);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new ArtifactError("invalid", "Artifact storage escaped its owner.");
  let current = boundary;
  for (const part of ["", ...relative.split(path.sep).filter(Boolean)]) {
    current = path.join(current, part);
    try {
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new ArtifactError(
          "invalid",
          "Artifact storage must use real directories without links.",
        );
    } catch (error) {
      if (!missing(error)) throw error;
      if (!create) return;
      await mkdir(current).catch((creationError) => {
        if (
          !(
            creationError instanceof Error &&
            "code" in creationError &&
            creationError.code === "EEXIST"
          )
        )
          throw creationError;
      });
      const created = await lstat(current);
      if (!created.isDirectory() || created.isSymbolicLink())
        throw new ArtifactError("invalid", "Artifact directory changed while opening.");
    }
  }
}
export async function readBounded(file: string, max = 2000000): Promise<string | null> {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > max)
      throw new ArtifactError(
        "invalid",
        "Artifact file is linked, oversized or not a regular file.",
      );
    const handle = await open(file, "r");
    return await cleanupArtifactOperation(
      async () => {
        const actual = await handle.stat();
        if (
          actual.dev !== info.dev ||
          actual.ino !== info.ino ||
          actual.size > max ||
          actual.nlink !== 1
        )
          throw new ArtifactError("conflict", "Artifact changed while opening.");
        const buffer = Buffer.alloc(max + 1);
        let bytesRead = 0;
        while (bytesRead <= max) {
          const part = await handle.read(buffer, bytesRead, max + 1 - bytesRead, bytesRead);
          if (!part.bytesRead) break;
          bytesRead += part.bytesRead;
        }
        if (bytesRead > max)
          throw new ArtifactError("invalid", "Artifact exceeds its file budget.");
        return buffer.subarray(0, bytesRead).toString("utf8");
      },
      () => handle.close(),
    );
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}
export async function publish(file: string, text: string): Promise<void> {
  const temporary = path.join(path.dirname(file), `.artifact-${randomUUID()}.tmp`);
  await cleanupArtifactOperation(
    async () => {
      const handle = await open(temporary, "wx", 0o600);
      await cleanupArtifactOperation(
        async () => {
          await handle.writeFile(text, "utf8");
          await handle.sync();
        },
        () => handle.close(),
      );
      await replaceStagedArtifact(temporary, file, text, {
        windows: process.platform === "win32",
        read: (target) => readBounded(target, Math.max(2000000, Buffer.byteLength(text))),
        rename,
        wait: delay,
      });
    },
    async () => {
      await unlink(temporary).catch((error) => {
        if (!missing(error)) throw error;
      });
    },
  );
}
export async function exclusive<T>(
  directory: string,
  id: string,
  operation: () => Promise<T>,
): Promise<T> {
  safeId(id);
  const lock = path.join(directory, `.artifact-${id}.lock`);
  try {
    await mkdir(lock);
  } catch (error) {
    throw new ArtifactError(
      "busy",
      "Artifact is locked by another writer. Inspect the owning host before retrying.",
      { cause: error },
    );
  }
  ownedLocks.add(lock);
  return cleanupArtifactOperation(operation, async () => {
    try {
      await rmdir(lock);
    } finally {
      ownedLocks.delete(lock);
    }
  });
}
const ownedLocks = new Set<string>();
export function isArtifactLockOwned(directory: string, id: string) {
  return ownedLocks.has(path.join(directory, `.artifact-${id}.lock`));
}
/** Cleanup cannot hide an operation failure, or trigger an implicit retry. */
export async function cleanupArtifactOperation<T>(
  operation: () => Promise<T>,
  release: () => Promise<void>,
): Promise<T> {
  let value: T;
  try {
    value = await operation();
  } catch (primaryError) {
    const failure = await release().then(
      () => null,
      (error: unknown) => ({ error }),
    );
    if (failure) throw combined(primaryError, failure.error);
    throw primaryError;
  }
  await release();
  return value;
}
function combined(primary: unknown, secondary: unknown) {
  return new AggregateError([primary, secondary], "Artifact operation and cleanup failed", {
    cause: primary,
  });
}
