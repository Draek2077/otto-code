/** Otto-only project fields stay on disk, outside Paseo's runtime/wire records. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { writeJsonFileAtomic } from "../atomic-file.js";

const FIELDS = new Set(["kanban", "knowledgeLocation", "knowledgeDirectoryName"]);
export interface OttoProjectSnapshot {
  projectId: string;
  rootPath: string;
  revision: string;
  record: Readonly<Record<string, unknown>>;
}
interface ProjectIdentity {
  projectId: string;
  rootPath: string;
  archivedAt: string | null;
}
interface Ports {
  file: string;
  parse(value: unknown): ProjectIdentity;
  /** Must hold the SAME queue as ordinary project upsert/archive/remove. */
  exclusive<T>(run: () => Promise<T>): Promise<T>;
}
export class OttoProjectMetadataError extends Error {
  constructor(
    readonly kind: "not_found" | "invalid" | "conflict",
    message: string,
  ) {
    super(message);
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new OttoProjectMetadataError("invalid", "The preserved project record is invalid");
  return value as Record<string, unknown>;
}
function revision(record: Readonly<Record<string, unknown>>): string {
  return createHash("sha256").update(JSON.stringify(record)).digest("hex");
}

/** Daemon-internal only. No client paths, raw-record RPC or plugin-global store. */
export class OttoProjectMetadata {
  constructor(private readonly ports: Ports) {}

  read(projectId: string): Promise<OttoProjectSnapshot> {
    return this.ports.exclusive(async () => (await this.load(projectId)).snapshot);
  }

  update(input: {
    projectId: string;
    expectedRevision: string;
    patch: Readonly<Record<string, unknown>>;
  }): Promise<OttoProjectSnapshot> {
    return this.ports.exclusive(async () => {
      if (Object.keys(input.patch).some((key) => !FIELDS.has(key)))
        throw new OttoProjectMetadataError("invalid", "Only owned Otto project fields may change");
      const current = await this.load(input.projectId);
      if (current.snapshot.revision !== input.expectedRevision)
        throw new OttoProjectMetadataError(
          "conflict",
          "Project Settings changed. Reload before saving.",
        );
      const record = { ...current.snapshot.record, ...input.patch };
      this.ports.parse(record);
      // Also reject edits outside this daemon's queue observed before publication.
      // External editors do not participate in the queue; this is not a cross-process lock.
      if ((await readFile(this.ports.file, "utf8")) !== current.bytes)
        throw new OttoProjectMetadataError(
          "conflict",
          "The project registry changed during this edit",
        );
      const records = current.records.map((row) =>
        this.ports.parse(row).projectId === input.projectId ? record : row,
      );
      await writeJsonFileAtomic(this.ports.file, records);
      return { ...current.snapshot, record, revision: revision(record) };
    });
  }

  private async load(projectId: string) {
    const bytes = await readFile(this.ports.file, "utf8");
    let decoded: unknown;
    try {
      decoded = JSON.parse(bytes);
      if (!Array.isArray(decoded)) throw new Error("Expected project records");
      const seen = new Set<string>();
      for (const row of decoded) {
        const identity = this.ports.parse(row);
        if (seen.has(identity.projectId)) throw new Error("Duplicate project identity");
        seen.add(identity.projectId);
      }
    } catch (error) {
      throw new Error("The project registry could not be read; it was left unchanged", {
        cause: error,
      });
    }
    const records: unknown[] = decoded;
    const record = records.find((row) => this.ports.parse(row).projectId === projectId);
    if (record === undefined || this.ports.parse(record).archivedAt !== null)
      throw new OttoProjectMetadataError("not_found", "Select an active project on this host");
    const identity = this.ports.parse(record);
    const raw = object(record);
    return {
      bytes,
      records,
      snapshot: { projectId, rootPath: identity.rootPath, record: raw, revision: revision(raw) },
    };
  }
}
