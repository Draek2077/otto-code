import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, link, unlink, rmdir } from "node:fs/promises";
import { WorkflowId } from "@getpaseo/plugin/otto/workflows";

export class WorkflowError extends Error {
  constructor(
    readonly kind: "invalid" | "conflict" | "busy" | "unavailable" | "unsupported",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorkflowError";
  }
}
export function workflowDigest(bytes: string | Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}
export function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
export function assertWorkflowId(id: string): void {
  if (!WorkflowId.safeParse(id).success)
    throw new WorkflowError("invalid", "Invalid Workflow identity.");
}

/** Preserve operation and cleanup failures. An unknown publication outcome is never retried here. */
export async function withWorkflowCleanup<T>(
  operation: () => Promise<T>,
  release: () => Promise<void>,
): Promise<T> {
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    outcome = { ok: true, value: await operation() };
  } catch (error) {
    outcome = { ok: false, error };
  }
  let cleanup: { ok: true } | { ok: false; error: unknown };
  try {
    await release();
    cleanup = { ok: true };
  } catch (error) {
    cleanup = { ok: false, error };
  }
  if (!outcome.ok && !cleanup.ok)
    throw new AggregateError(
      [outcome.error, cleanup.error],
      "Workflow operation and cleanup failed.",
      { cause: outcome.error },
    );
  if (!outcome.ok) throw outcome.error;
  if (!cleanup.ok) throw cleanup.error;
  return outcome.value;
}

/** The root is daemon-resolved. All descendants are checked without following links. Reads create nothing. */
export async function workflowDirectory(
  boundary: string,
  directory: string,
  create = false,
): Promise<boolean> {
  const relative = path.relative(boundary, directory);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new WorkflowError("invalid", "Workflow storage is outside its owning root.");
  let current = boundary;
  for (const segment of ["", ...relative.split(path.sep).filter(Boolean)]) {
    if (segment) current = path.join(current, segment);
    try {
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new WorkflowError(
          "invalid",
          "Workflow storage contains a linked or non-directory entry.",
        );
    } catch (error) {
      if (!isMissing(error)) throw error;
      if (!create) return false;
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (mkdirError) {
        if (!(mkdirError instanceof Error && "code" in mkdirError && mkdirError.code === "EEXIST"))
          throw mkdirError;
      }
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new WorkflowError("invalid", "Workflow directory changed during creation.");
    }
  }
  return true;
}

export const WORKFLOW_FILE_LIMIT = 2 * 1024 * 1024;
export async function readWorkflowFile(
  file: string,
  max = WORKFLOW_FILE_LIMIT,
): Promise<string | null> {
  try {
    const before = await lstat(file);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > max)
      throw new WorkflowError("invalid", "Workflow file is linked, oversized or not regular.");
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    return await withWorkflowCleanup(
      async () => {
        const actual = await handle.stat();
        if (
          actual.dev !== before.dev ||
          actual.ino !== before.ino ||
          actual.nlink !== 1 ||
          actual.size > max
        )
          throw new WorkflowError("conflict", "Workflow file changed while opening.");
        const bytes = Buffer.alloc(max + 1);
        let length = 0;
        while (length <= max) {
          const part = await handle.read(bytes, length, max + 1 - length, length);
          if (!part.bytesRead) break;
          length += part.bytesRead;
        }
        const after = await handle.stat();
        const entry = await lstat(file);
        if (
          length > max ||
          after.size !== actual.size ||
          after.mtimeMs !== actual.mtimeMs ||
          entry.isSymbolicLink() ||
          entry.ino !== actual.ino ||
          entry.nlink !== 1
        )
          throw new WorkflowError("conflict", "Workflow file changed during its bounded read.");
        return bytes.subarray(0, length).toString("utf8");
      },
      () => handle.close(),
    );
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/** Only cooperating Workflow writers share this lock. External-editor compare/rename races remain explicit. */
const ownedWorkflowLocks = new Set<string>();
export function isWorkflowLockOwned(file: string): boolean {
  return ownedWorkflowLocks.has(file);
}
export async function workflowExclusive<T>(file: string, operation: () => Promise<T>): Promise<T> {
  const lock = `${file}.otto-lock`;
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST")
      throw new WorkflowError(
        "busy",
        "Another Workflow writer or retained lock owns this record. Inspect the store before recovery.",
        { cause: error },
      );
    throw error;
  }
  ownedWorkflowLocks.add(lock);
  try {
    return await withWorkflowCleanup(operation, () => rmdir(lock));
  } finally {
    ownedWorkflowLocks.delete(lock);
  }
}
export async function assertWorkflowRevision(file: string, expected: string | null): Promise<void> {
  const current = await readWorkflowFile(file);
  if ((current === null ? null : workflowDigest(current)) !== expected)
    throw new WorkflowError(
      "conflict",
      "Workflow changed. Reload and review before another write.",
    );
}
export async function publishWorkflowFile(
  file: string,
  bytes: string,
  expected: string | null,
): Promise<string> {
  if (Buffer.byteLength(bytes) > WORKFLOW_FILE_LIMIT)
    throw new WorkflowError("invalid", "Workflow exceeds the bounded document size.");
  return workflowExclusive(file, async () => {
    await assertWorkflowRevision(file, expected);
    const stage = path.join(path.dirname(file), `.workflow-${randomUUID()}.tmp`);
    return withWorkflowCleanup(
      async () => {
        const handle = await open(stage, "wx", 0o600);
        await withWorkflowCleanup(
          async () => {
            await handle.writeFile(bytes, "utf8");
            await handle.sync();
          },
          () => handle.close(),
        );
        await assertWorkflowRevision(file, expected);
        if (expected === null) await link(stage, file);
        else await rename(stage, file);
        return workflowDigest(bytes);
      },
      async () => {
        try {
          await unlink(stage);
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
      },
    );
  });
}

/** Explicit deletion retains the exact bytes for recovery; it never recursively removes a user directory. */
export async function retireWorkflowFile(file: string, expected: string): Promise<string> {
  return workflowExclusive(file, async () => {
    await assertWorkflowRevision(file, expected);
    const recovery = path.join(path.dirname(file), ".otto-recovery");
    await workflowDirectory(path.dirname(file), recovery, true);
    const target = path.join(recovery, `${path.basename(file)}.${randomUUID()}.deleted`);
    await assertWorkflowRevision(file, expected);
    await rename(file, target);
    return target;
  });
}
