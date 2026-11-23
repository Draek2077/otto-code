import { createHash } from "node:crypto";
import { promises as fs, type BigIntStats } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ReviewedArchiveRecord } from "./archive-review.js";

const maxRecordBytes = 8n * 1024n * 1024n;

interface ArchiveRecordIdentity {
  id: string;
  archivedAt?: string | null;
  updatedAt: string;
  internal?: boolean;
  owner?: unknown;
}

const recordIdentity = z.object({
  id: z.string(),
  archivedAt: z.string(),
  updatedAt: z.string(),
  internal: z.boolean().optional(),
  owner: z.unknown().optional(),
});

export function isReviewableArchiveRecord(record: ArchiveRecordIdentity): boolean {
  return Boolean(record.archivedAt && !record.internal && record.owner === undefined);
}

function isWithin(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return Boolean(
    relative &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative),
  );
}

function fingerprint(stats: BigIntStats): string {
  return [stats.dev, stats.ino, stats.size, stats.nlink, stats.mtimeNs, stats.ctimeNs].join(":");
}

function isEligibleFile(stats: BigIntStats): boolean {
  return stats.isFile() && stats.nlink === 1n && stats.size <= maxRecordBytes;
}

export interface ArchiveRecordFile {
  path: string;
  record: ReviewedArchiveRecord;
}

async function readCheckedFile(
  file: string,
  identity: string,
  size: number,
): Promise<Buffer | null> {
  const handle = await fs.open(file, "r");
  try {
    if (fingerprint(await handle.stat({ bigint: true })) !== identity) return null;
    const bytes = Buffer.alloc(size);
    for (let offset = 0; offset < size; ) {
      const { bytesRead } = await handle.read(bytes, offset, size - offset, offset);
      if (!bytesRead) return null;
      offset += bytesRead;
    }
    return fingerprint(await handle.stat({ bigint: true })) === identity ? bytes : null;
  } finally {
    await handle.close();
  }
}

/** Only one unambiguous file from AgentStorage's own index is eligible. Check
 * the on-disk record as well as the in-memory identity to detect external edits. */
export async function inspectArchiveRecordFile(input: {
  directory: string;
  indexedPath: string;
  expected: ArchiveRecordIdentity;
}): Promise<ArchiveRecordFile | null> {
  const { directory, indexedPath, expected } = input;
  try {
    if (!isReviewableArchiveRecord(expected)) return null;
    const root = await fs.realpath(directory);
    const target = await fs.realpath(indexedPath);
    const before = await fs.lstat(indexedPath, { bigint: true });
    if (!isWithin(root, target) || !isEligibleFile(before)) return null;

    const identity = fingerprint(before);
    const body = await readCheckedFile(target, identity, Number(before.size));
    if (!body || fingerprint(await fs.lstat(indexedPath, { bigint: true })) !== identity) {
      return null;
    }
    const value = recordIdentity.parse(JSON.parse(body.toString("utf8")));
    if (
      !isReviewableArchiveRecord(value) ||
      value.id !== expected.id ||
      value.archivedAt !== expected.archivedAt ||
      value.updatedAt !== expected.updatedAt
    )
      return null;
    const revision = createHash("sha256").update(identity).update("\0").update(body).digest("hex");
    return { path: target, record: { agentId: expected.id, revision, bytes: body.byteLength } };
  } catch {
    // Missing, ambiguous, malformed or unreadable data is never an eligible removal.
    return null;
  }
}
