/** Durable, per-service-run diagnostics for Otto Brain. */
import {
  appendFileSync,
  mkdirSync,
  openSync,
  readSync,
  closeSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";

import { resolveBrainPaths } from "../config/paths.js";
import { timestampBrainLogLine } from "./log-format.js";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const RUN_LOG_SUFFIX = "-brain.log";

export interface BrainRunLog {
  path: string;
  write(line: string): string[];
  /** The current Brain-service session's durable tail, including every source. */
  tail(limit: number): { lines: string[]; total: number };
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
  let lineCount = 0;
  const write = (line: string): string[] => {
    const lines = line.split(/\r?\n|\r/u).filter((entry) => entry.length > 0);
    if (lines.length === 0) return [];
    try {
      const timestamp = new Date().toISOString().slice(11, 23);
      const entries = lines.map((entry) => timestampBrainLogLine(timestamp, entry));
      appendFileSync(filePath, `${entries.join("\n")}\n`, "utf8");
      lineCount += lines.length;
      return entries;
    } catch {
      return [];
    }
  };
  write(`Brain service started (pid ${process.pid})`);
  return {
    path: filePath,
    write,
    tail(limit: number) {
      const count = Math.max(1, Math.floor(limit));
      // The Brain log is append-only for the service lifetime. Read only enough
      // of its end for the live viewer, rather than loading an unbounded bench
      // or download log every two-second poll.
      try {
        const size = statSync(filePath).size;
        const bytes = Math.min(size, Math.max(64 * 1024, count * 1024));
        const fd = openSync(filePath, "r");
        try {
          const data = Buffer.alloc(bytes);
          readSync(fd, data, 0, bytes, size - bytes);
          const text = data.toString("utf8");
          const firstNewline = text.indexOf("\n");
          const completeLines =
            bytes < size && firstNewline !== -1 ? text.slice(firstNewline + 1) : text;
          return {
            lines: completeLines.split(/\r?\n/u).filter(Boolean).slice(-count),
            total: lineCount,
          };
        } finally {
          closeSync(fd);
        }
      } catch {
        return { lines: [], total: lineCount };
      }
    },
  };
}

export function pruneBrainRunLogs(logsDir: string, now = Date.now()): void {
  for (const entry of readdirSync(logsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(RUN_LOG_SUFFIX)) continue;
    const filePath = path.join(logsDir, entry.name);
    if (now - statSync(filePath).mtimeMs > RETENTION_MS) rmSync(filePath, { force: true });
  }
}
