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
export interface OttoProjectUpdate {
  projectId: string;
  expectedRevision: string;
  patch: Readonly<Record<string, unknown>>;
  /** Trusted daemon-only final filesystem validation under the registry queue.
   * Must not reenter this registry or a host-preference queue. */
  beforePublish?(): Promise<void>;
}
export interface OttoKnowledgeDirectoryBinding {
  projectId: string;
  directoryName: string;
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
  knowledgeDirectoryBindings(): Promise<OttoKnowledgeDirectoryBinding[]> {
    return this.ports.exclusive(async () => {
      const current = await this.loadAll();
      const bindings: OttoKnowledgeDirectoryBinding[] = [];
      for (const row of current.records) {
        const directoryName = object(row).knowledgeDirectoryName;
        if (directoryName === null || directoryName === undefined) continue;
        if (typeof directoryName !== "string")
          throw new OttoProjectMetadataError(
            "invalid",
            "A preserved Knowledge directory binding is invalid",
          );
        bindings.push({ projectId: this.ports.parse(row).projectId, directoryName });
      }
      return bindings;
    });
  }

  update(input: OttoProjectUpdate): Promise<OttoProjectSnapshot> {
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
      const directory = input.patch.knowledgeDirectoryName;
      if (
        typeof directory === "string" &&
        current.records.some((row) => {
          const identity = this.ports.parse(row);
          const bound = object(row).knowledgeDirectoryName;
          return (
            identity.projectId !== input.projectId &&
            typeof bound === "string" &&
            directoryKey(bound) === directoryKey(directory)
          );
        })
      )
        throw new OttoProjectMetadataError(
          "conflict",
          "This Knowledge directory is already bound to another project, including archived projects.",
        );
      await input.beforePublish?.();
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

  /** A host-default change must not redirect already initialized inherited
   * stores. Keep the canonical registry queue through default publication, so
   * a first writer cannot initialize an unpinned store in the publication gap.
   * Archived records are retained too; revival must not appear to erase data. */
  retainKnowledgeHostStores<T>(input: {
    initialized(project: OttoProjectSnapshot): Promise<boolean>;
    publish(): Promise<T>;
  }): Promise<T> {
    return this.ports.exclusive(async () => {
      const current = await this.loadAll({ allowMissing: true });
      const records: Record<string, unknown>[] = [];
      let changed = false;
      for (const row of current.records) {
        const record = object(row);
        const identity = this.ports.parse(record);
        const inherited =
          record.knowledgeLocation === undefined || record.knowledgeLocation === null;
        const keep =
          inherited &&
          (await input.initialized({
            projectId: identity.projectId,
            rootPath: identity.rootPath,
            record,
            revision: revision(record),
          }));
        if (keep) {
          const next = { ...record, knowledgeLocation: "host" };
          this.ports.parse(next);
          records.push(next);
          changed = true;
        } else records.push(record);
      }
      let bytes: string;
      let missing = false;
      try {
        bytes = await readFile(this.ports.file, "utf8");
      } catch (error) {
        if (
          current.missing &&
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          bytes = "";
          missing = true;
        } else throw error;
      }
      if (bytes !== current.bytes || missing !== current.missing)
        throw new OttoProjectMetadataError(
          "conflict",
          "Project Settings changed while preserving existing Knowledge stores. Reload before saving.",
        );
      if (changed) await writeJsonFileAtomic(this.ports.file, records);
      // A failed publication retains these protective bindings. Never roll back
      // over newer registry values or implicitly move/delete a store.
      return input.publish();
    });
  }

  private async loadAll({ allowMissing = false }: { allowMissing?: boolean } = {}) {
    let bytes: string;
    let missing = false;
    try {
      bytes = await readFile(this.ports.file, "utf8");
    } catch (error) {
      if (
        allowMissing &&
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        bytes = "";
        missing = true;
      } else throw error;
    }
    let decoded: unknown;
    try {
      decoded = missing ? [] : JSON.parse(bytes);
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
    return { bytes, records, missing };
  }

  private async load(projectId: string) {
    const { bytes, records } = await this.loadAll();
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
function directoryKey(value: string) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}
