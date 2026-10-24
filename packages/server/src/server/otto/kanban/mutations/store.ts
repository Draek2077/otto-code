/** Durable admission survives lost responses and host restarts; it never stores card content. */
import { createHash } from "node:crypto";
import { readFile, mkdir, open } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { KanbanErrorSchema, type BoardMutationIntent } from "@getpaseo/plugin/otto/kanban";
import { writeJsonFileAtomic } from "../../../atomic-file.js";

const RecordSchema = z
  .object({
    version: z.literal(1),
    fingerprint: z.string(),
    state: z.enum(["admitted", "applied", "rejected", "uncertain"]),
    error: KanbanErrorSchema.optional(),
  })
  .strict();
export type MutationRecord = z.infer<typeof RecordSchema>;
export interface MutationStore {
  read(intent: BoardMutationIntent): Promise<MutationRecord | null>;
  admit(intent: BoardMutationIntent, fingerprint: string): Promise<boolean>;
  save(intent: BoardMutationIntent, record: MutationRecord): Promise<void>;
}
export function mutationFingerprint(intent: BoardMutationIntent): string {
  // Schema parsing establishes field ordering and removes no unknown write fields.
  return createHash("sha256").update(JSON.stringify(intent)).digest("hex");
}
function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
export class FileMutationStore implements MutationStore {
  constructor(private readonly directory: string) {}
  private file(intent: BoardMutationIntent): string {
    const identity = JSON.stringify([
      intent.binding.hostId,
      intent.binding.projectId,
      intent.operationId,
    ]);
    return path.join(this.directory, createHash("sha256").update(identity).digest("hex") + ".json");
  }
  async read(intent: BoardMutationIntent): Promise<MutationRecord | null> {
    try {
      return RecordSchema.parse(JSON.parse(await readFile(this.file(intent), "utf8")));
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  }
  async admit(intent: BoardMutationIntent, fingerprint: string): Promise<boolean> {
    await mkdir(this.directory, { recursive: true });
    // Exclusive admission precedes provider effects. A partial/crashed record is
    // deliberately unreadable: repair/reconciliation is safer than a repeated create.
    let handle;
    try {
      handle = await open(this.file(intent), "wx", 0o600);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") return false;
      throw error;
    }
    try {
      await handle.writeFile(JSON.stringify({ version: 1, fingerprint, state: "admitted" }));
      await handle.sync();
    } finally {
      await handle.close();
    }
    return true;
  }
  async save(intent: BoardMutationIntent, record: MutationRecord): Promise<void> {
    await writeJsonFileAtomic(this.file(intent), RecordSchema.parse(record));
  }
}
