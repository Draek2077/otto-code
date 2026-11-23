/** Exclusive home ownership is acquired before startup and released after teardown. */
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { ensurePrivateDirectory } from "../config/private-files.js";
import { resolveBrainPaths } from "../config/paths.js";
import { isProcessAlive, readPidFile, removePidFile } from "./pid-lock.js";

export interface ServiceOwnership {
  instanceId: string;
  release(): void;
}

export function acquireServiceOwnership(env: NodeJS.ProcessEnv): ServiceOwnership {
  const paths = resolveBrainPaths(env);
  ensurePrivateDirectory(paths.root);
  const existing = readPidFile(env);
  if (existing && isProcessAlive(existing.pid)) {
    throw new Error(`Brain already running (pid ${existing.pid})`);
  }
  const file = `${paths.pidFile}.owner`;
  const instanceId = randomUUID();
  const contents = JSON.stringify({ pid: process.pid, instanceId });
  try {
    writeFileSync(file, contents, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    let prior: { pid?: unknown; instanceId?: unknown };
    let snapshot: string;
    try {
      snapshot = readFileSync(file, "utf8");
      prior = JSON.parse(snapshot);
    } catch {
      throw new Error(`Invalid Brain ownership record at ${file}`, { cause: error });
    }
    if (
      typeof prior.pid === "number" &&
      Number.isSafeInteger(prior.pid) &&
      prior.pid > 0 &&
      typeof prior.instanceId === "string" &&
      !isProcessAlive(prior.pid)
    ) {
      // Only a proven dead process is recoverable. A reused PID fails closed.
      if (readFileSync(file, "utf8") === snapshot) rmSync(file);
      return acquireServiceOwnership(env);
    }
    // Fail closed, including on PID reuse. Do not unlink another process's
    // claim based only on signal-0: that cannot establish process identity.
    throw new Error(`Brain home already owned; inspect the ownership record at ${file}`, {
      cause: error,
    });
  }
  return {
    instanceId,
    release() {
      if (readPidFile(env)?.instanceId === instanceId) removePidFile(env);
      try {
        if (readFileSync(file, "utf8") === contents) rmSync(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    },
  };
}
