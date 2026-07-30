/**
 * The service pid/lock file, following the daemon's `otto.pid` pattern: a small
 * JSON record of the running brain's pid + bind address under
 * `$OTTO_HOME/otto-brain/otto-brain.pid`. Lets `otto brain status`/`stop` find a
 * running instance and lets the Otto daemon supervise a managed child.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";

import { resolveBrainPaths } from "../config/paths.js";
import { writePrivateFileAtomicSync } from "../config/private-files.js";

export interface PidRecord {
  pid: number;
  host: string;
  port: number;
  startedAt: string;
}

export function writePidFile(record: PidRecord, env: NodeJS.ProcessEnv = process.env): void {
  const { pidFile } = resolveBrainPaths(env);
  writePrivateFileAtomicSync(pidFile, `${JSON.stringify(record, null, 2)}\n`);
}

export function readPidFile(env: NodeJS.ProcessEnv = process.env): PidRecord | null {
  const { pidFile } = resolveBrainPaths(env);
  if (!existsSync(pidFile)) return null;
  try {
    return JSON.parse(readFileSync(pidFile, "utf8")) as PidRecord;
  } catch {
    return null;
  }
}

export function removePidFile(env: NodeJS.ProcessEnv = process.env): void {
  const { pidFile } = resolveBrainPaths(env);
  rmSync(pidFile, { force: true });
}

/** signal 0 probes liveness without delivering a signal; EPERM means alive. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The running service record, clearing a stale pid file if the process is gone. */
export function readRunningService(env: NodeJS.ProcessEnv = process.env): PidRecord | null {
  const record = readPidFile(env);
  if (!record) return null;
  if (!isProcessAlive(record.pid)) {
    removePidFile(env);
    return null;
  }
  return record;
}
