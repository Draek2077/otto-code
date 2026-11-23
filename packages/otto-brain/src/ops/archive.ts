import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod/v3";
import { ensurePrivateDirectory, writePrivateFileAtomicSync } from "../config/private-files.js";

import { resolveBrainPaths } from "../config/paths.js";
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

/** Resolve the writable transcript store for a given host environment. */
function resolveArchiveDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveBrainPaths(env).resultsDir, "transcripts");
}

// Raw benchmark exchanges are host state too. They must follow the score store
// into OTTO_HOME rather than attempting to write beside the installed package.

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

const TranscriptSchema = z
  .object({
    taskId: z.string(),
    label: z.string().nullable(),
    at: z.string(),
    meta: z.record(z.unknown()),
    request: z.unknown(),
    response: z.unknown(),
  })
  .passthrough();

function runId(model: Model | null, timestamp: Date = new Date()): string {
  const stamp = timestamp.toISOString().replace(/[:.]/g, "-");
  const slug = String(model?.displayName || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${stamp}_${slug}_${crypto.randomUUID().slice(0, 8)}`;
}

/** Where a run's transcripts live. */
function runDir(id: string, env: NodeJS.ProcessEnv = process.env): string {
  if (id.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(id))
    throw new Error("Invalid Brain archive id");
  return path.join(resolveArchiveDir(env), id);
}

/**
 * Record one exchange. `request` and `response` are stored verbatim so a future
 * scorer sees exactly what the model saw and said.
 */
function put(
  id: string,
  taskId: string,
  { label, request, response, meta = {} }: PutOptions,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const dir = runDir(id, env);
  ensurePrivateDirectory(dir);

  const key = crypto
    .createHash("sha1")
    .update(`${taskId}:${label || ""}:${JSON.stringify(meta)}`)
    .digest("hex")
    .slice(0, 8);
  const file = path.join(dir, `${taskId.replace(/[^\w.-]/g, "_")}.${key}.json`);

  writePrivateFileAtomicSync(
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
function load(id: string, env: NodeJS.ProcessEnv = process.env): Record<string, TranscriptEntry[]> {
  const dir = runDir(id, env);
  if (!fs.existsSync(dir)) return {};
  // Task IDs are external data, including names such as "__proto__".
  const byTask: Record<string, TranscriptEntry[]> = Object.create(null);
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed = TranscriptSchema.parse(
        JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")),
      );
      const entry: TranscriptEntry = {
        ...parsed,
        request: parsed.request,
        response: parsed.response,
      };
      if (!byTask[entry.taskId]) byTask[entry.taskId] = [];
      byTask[entry.taskId].push(entry);
    } catch {
      /* skip an unreadable transcript rather than failing the whole load */
    }
  }
  for (const entries of Object.values(byTask)) entries.sort((a, b) => (a.at < b.at ? -1 : 1));
  return byTask;
}

/** All archived run ids, newest first. */
function list(env: NodeJS.ProcessEnv = process.env): string[] {
  const ARCHIVE_DIR = resolveArchiveDir(env);
  if (!fs.existsSync(ARCHIVE_DIR)) return [];
  return fs
    .readdirSync(ARCHIVE_DIR)
    .filter((name) => {
      if (name.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name)) return false;
      try {
        return fs.lstatSync(path.join(ARCHIVE_DIR, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort()
    .toReversed();
}

/** Total bytes held, so the archive can be pruned knowingly. */
function size(env: NodeJS.ProcessEnv = process.env): number {
  let bytes = 0;
  for (const id of list(env)) {
    const dir = runDir(id, env);
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

export { resolveArchiveDir, runId, runDir, put, load, list, size };
