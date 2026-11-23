import path from "node:path";
import { lstat, readdir, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { WorkflowError, workflowDigest, isWorkflowLockOwned, isMissing } from "./files.js";

/** An empty lock is not proof of abandonment. Recovery additionally requires explicit owning-host verification. */
export async function inspectWorkflowLock(file: string) {
  const lock = `${file}.otto-lock`;
  try {
    const info = await lstat(lock);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new WorkflowError(
        "invalid",
        "Workflow lock has an unknown type. Inspect it on the owning host.",
      );
    const entries = await readdir(lock);
    return {
      revision: workflowDigest(
        JSON.stringify([info.dev, info.ino, info.birthtimeMs, info.mtimeMs, entries.sort()]),
      ),
      canRecover: entries.length === 0 && !isWorkflowLockOwned(lock),
    };
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}
export async function recoverWorkflowLock(file: string, expected: string): Promise<void> {
  const lock = await inspectWorkflowLock(file);
  if (!lock?.canRecover || lock.revision !== expected)
    throw new WorkflowError(
      "conflict",
      "Workflow lock changed or has a current writer. Inspect it again before recovery.",
    );
  await rename(
    `${file}.otto-lock`,
    path.join(path.dirname(file), `.recovery-workflow-lock-${randomUUID()}`),
  );
}
