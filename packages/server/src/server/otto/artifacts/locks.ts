import path from "node:path";
import { lstat, readdir, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { ArtifactError, digest, missing, isArtifactLockOwned } from "./files.js";
export async function inspectArtifactLock(directory: string, id: string) {
  const file = path.join(directory, `.artifact-${id}.lock`);
  try {
    const info = await lstat(file);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new ArtifactError(
        "invalid",
        "Unknown Artifacts lock type. Inspect it on the owning host.",
      );
    const entries = await readdir(file);
    return {
      revision: digest(
        JSON.stringify([info.dev, info.ino, info.birthtimeMs, info.mtimeMs, entries.sort()]),
      ),
      canRecover: !entries.length && !isArtifactLockOwned(directory, id),
    };
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}
/** Empty and old do not mean abandoned. Recovery requires fresh identity and explicit human verification. */
export async function recoverArtifactLock(directory: string, id: string, expected: string) {
  const current = await inspectArtifactLock(directory, id);
  if (!current?.canRecover || current.revision !== expected)
    throw new ArtifactError(
      "conflict",
      "The inspected lock changed or has a current writer. Inspect it again before recovery.",
    );
  await rename(
    path.join(directory, `.artifact-${id}.lock`),
    path.join(directory, `.recovery-lock-${id}-${randomUUID()}`),
  );
}
