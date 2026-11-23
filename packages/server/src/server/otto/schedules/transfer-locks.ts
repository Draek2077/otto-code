import path from "node:path";
import type { ScheduleTransferLockKind } from "@getpaseo/plugin/otto/schedules";
import { inspectWorkflowLock } from "../workflows/locks.js";
import type { ScheduleRegistry } from "./registry.js";
import type { ScheduleTransferRecord } from "./transfer-record.js";

/** Lock paths are derived only from the retained receipt and current canonical
 * stores. Clients select a bounded kind, never a filesystem path. */
export async function scheduleTransferLockFiles(
  registry: ScheduleRegistry,
  file: string,
  record: ScheduleTransferRecord | null,
) {
  const files: Partial<Record<ScheduleTransferLockKind, string>> = {
    transaction: `${file}.transaction`,
    receipt: file,
    backup: path.join(path.dirname(file), "source.json"),
  };
  if (record) {
    const source = await registry.transferOrigin(record.input.source);
    const destination = await registry.transferOrigin(record.destination);
    files.source = path.join(source.directory, `${record.input.source.id}.json`);
    files.destination = path.join(destination.directory, `${record.destination.id}.json`);
  }
  return files;
}
export async function inspectScheduleTransferLocks(
  registry: ScheduleRegistry,
  file: string,
  record: ScheduleTransferRecord | null,
) {
  const files = await scheduleTransferLockFiles(registry, file, record);
  const locks: Array<{ kind: ScheduleTransferLockKind; revision: string; canRecover: boolean }> =
    [];
  for (const kind of ["transaction", "receipt", "backup", "source", "destination"] as const) {
    const lockFile = files[kind];
    if (!lockFile) continue;
    const lock = await inspectWorkflowLock(lockFile);
    if (lock) locks.push({ kind, revision: lock.revision, canRecover: lock.canRecover });
  }
  return locks;
}
