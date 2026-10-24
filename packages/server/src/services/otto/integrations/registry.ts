import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { writeJsonFileAtomic } from "../../../server/atomic-file.js";

const RecordSchema = z
  .object({
    version: z.literal(1),
    connections: z.record(z.string(), z.unknown()),
  })
  .passthrough();
export interface IntegrationRegistrySnapshot {
  revision: string;
  connections: Readonly<Record<string, unknown>>;
}
export interface IntegrationRegistry {
  read(): Promise<IntegrationRegistrySnapshot>;
  update(input: {
    expectedRevision: string;
    integrationId: string;
    value: unknown;
  }): Promise<IntegrationRegistrySnapshot>;
}
export class IntegrationRegistryConflictError extends Error {
  constructor() {
    super("Integration settings changed. Reload before saving.");
  }
}
function revision(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
/** One daemon-owned nonsecret registry, reusable by all integration adapters. */
export class FileIntegrationRegistry implements IntegrationRegistry {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}
  private async exclusive<T>(run: () => Promise<T>): Promise<T> {
    const task = this.pending.catch(() => undefined).then(run);
    this.pending = task;
    return task;
  }
  private async load() {
    let bytes: string;
    try {
      bytes = await readFile(this.file, "utf8");
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT"))
        throw new Error("Integration settings could not be read; they were left unchanged.", {
          cause: error,
        });
      bytes = "";
    }
    const record = bytes
      ? RecordSchema.parse(JSON.parse(bytes))
      : { version: 1 as const, connections: {} };
    return {
      bytes,
      record,
      snapshot: { revision: revision(bytes), connections: record.connections },
    };
  }
  read(): Promise<IntegrationRegistrySnapshot> {
    return this.exclusive(async () => (await this.load()).snapshot);
  }
  update(input: {
    expectedRevision: string;
    integrationId: string;
    value: unknown;
  }): Promise<IntegrationRegistrySnapshot> {
    return this.exclusive(async () => {
      const current = await this.load();
      if (current.snapshot.revision !== input.expectedRevision)
        throw new IntegrationRegistryConflictError();
      const next = {
        ...current.record,
        connections: { ...current.record.connections, [input.integrationId]: input.value },
      };
      // External editors do not share the daemon queue. Refuse an observed
      // external change before publication; this is not a cross-process lock.
      if ((await this.load()).bytes !== current.bytes) throw new IntegrationRegistryConflictError();
      await writeJsonFileAtomic(this.file, next);
      return (await this.load()).snapshot;
    });
  }
}
