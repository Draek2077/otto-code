/** Durable, per-service-run diagnostics for Otto Brain. */
import { appendFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

import { resolveBrainPaths } from "../config/paths.js";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const RUN_LOG_SUFFIX = "-brain.log";

export interface BrainRunLog {
  path: string;
  write(line: string): void;
}

/** Start a fresh Brain log and prune only expired Brain run logs. */
export function createBrainRunLog(env: NodeJS.ProcessEnv = process.env): BrainRunLog {
  const { logsDir } = resolveBrainPaths(env);
  const startedAt = new Date();
  const stamp = startedAt
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const filePath = path.join(logsDir, `${stamp}-${process.pid}${RUN_LOG_SUFFIX}`);
  try {
    mkdirSync(logsDir, { recursive: true });
    pruneBrainRunLogs(logsDir, startedAt.getTime());
  } catch {}
  const write = (line: string): void => {
    try {
      appendFileSync(filePath, `${new Date().toISOString()} ${line}\n`, "utf8");
    } catch {}
  };
  write(`Brain service started (pid ${process.pid})`);
  return { path: filePath, write };
}

export function pruneBrainRunLogs(logsDir: string, now = Date.now()): void {
  for (const entry of readdirSync(logsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(RUN_LOG_SUFFIX)) continue;
    const filePath = path.join(logsDir, entry.name);
    if (now - statSync(filePath).mtimeMs > RETENTION_MS) rmSync(filePath, { force: true });
  }
}
