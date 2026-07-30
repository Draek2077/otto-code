import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import type { Model } from "../types.js";

/**
 * Raw model output archive.
 *
 * Scoring is a separate, replayable pass over stored transcripts rather than
 * something that only happens live. This exists because a bug in the scorer
 * (a filename matcher that attributed every test block to the wrong file) made
 * seven models look identical, and fixing it cost a full re-run on the GPU. The
 * model outputs had been correct all along - only the grading was wrong.
 *
 * With the transcript on disk, a scorer fix re-grades history in seconds.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const ARCHIVE_DIR = path.join(ROOT, "results", "transcripts");

/** One archived request/response exchange. */
export interface TranscriptEntry {
  taskId: string;
  label: string | null;
  at: string;
  meta: Record<string, unknown>;
  request: unknown;
  response: unknown;
}

/** Arguments to `put`: one exchange to archive. */
export interface PutOptions {
  label?: string;
  request: unknown;
  response: unknown;
  meta?: Record<string, unknown>;
}

function runId(model: Model | null, timestamp: Date = new Date()): string {
  const stamp = timestamp.toISOString().replace(/[:.]/g, "-");
  const slug = String(model?.displayName || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${stamp}_${slug}`;
}

/** Where a run's transcripts live. */
function runDir(id: string): string {
  return path.join(ARCHIVE_DIR, id);
}

/**
 * Record one exchange. `request` and `response` are stored verbatim so a future
 * scorer sees exactly what the model saw and said.
 */
function put(
  id: string,
  taskId: string,
  { label, request, response, meta = {} }: PutOptions,
): string {
  const dir = runDir(id);
  fs.mkdirSync(dir, { recursive: true });

  const key = crypto
    .createHash("sha1")
    .update(`${taskId}:${label || ""}:${JSON.stringify(meta)}`)
    .digest("hex")
    .slice(0, 8);
  const file = path.join(dir, `${taskId.replace(/[^\w.-]/g, "_")}.${key}.json`);

  fs.writeFileSync(
    file,
    `${JSON.stringify(
      {
        taskId,
        label: label || null,
        at: new Date().toISOString(),
        meta,
        request,
        response,
      },
      null,
      2,
    )}\n`,
  );
  return file;
}

/** Every transcript for a run, grouped by task id. */
function load(id: string): Record<string, TranscriptEntry[]> {
  const dir = runDir(id);
  if (!fs.existsSync(dir)) return {};
  const byTask: Record<string, TranscriptEntry[]> = {};
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const entry = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as TranscriptEntry;
      if (!byTask[entry.taskId]) byTask[entry.taskId] = [];
      byTask[entry.taskId].push(entry);
    } catch {
      /* skip an unreadable transcript rather than failing the whole load */
    }
  }
  for (const list of Object.values(byTask)) list.sort((a, b) => (a.at < b.at ? -1 : 1));
  return byTask;
}

/** All archived run ids, newest first. */
function list(): string[] {
  if (!fs.existsSync(ARCHIVE_DIR)) return [];
  return fs
    .readdirSync(ARCHIVE_DIR)
    .filter((name) => fs.statSync(path.join(ARCHIVE_DIR, name)).isDirectory())
    .sort()
    .reverse();
}

/** Total bytes held, so the archive can be pruned knowingly. */
function size(): number {
  let bytes = 0;
  for (const id of list()) {
    const dir = runDir(id);
    for (const name of fs.readdirSync(dir)) {
      try {
        bytes += fs.statSync(path.join(dir, name)).size;
      } catch {
        /* gone */
      }
    }
  }
  return bytes;
}

export { ARCHIVE_DIR, runId, runDir, put, load, list, size };
