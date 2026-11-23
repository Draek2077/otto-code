import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export type LocalMeetingTranscriptDeliveryState =
  | "local_only"
  | "waiting_for_secure_connection"
  | "delivery_failed";

export interface LocalMeetingTranscript {
  id: string;
  provider: string;
  title: string;
  content: string;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
  deliveryState: LocalMeetingTranscriptDeliveryState;
}

export interface CreateLocalMeetingTranscriptInput {
  provider: string;
  title: string;
  content: string;
  occurredAt: string;
  deliveryState: LocalMeetingTranscriptDeliveryState;
}

export interface UpdateLocalMeetingTranscriptInput {
  id: string;
  title?: string;
  content?: string;
}

interface DeletedMeetingTranscript {
  id: string;
  deleted: true;
}

type StoredMeetingTranscript = LocalMeetingTranscript | DeletedMeetingTranscript;

function isDeletedTranscript(value: unknown): value is DeletedMeetingTranscript {
  return (
    !!value &&
    typeof value === "object" &&
    Reflect.get(value, "deleted") === true &&
    typeof Reflect.get(value, "id") === "string"
  );
}

function isDeliveryState(value: unknown): value is LocalMeetingTranscriptDeliveryState {
  return (
    value === "local_only" ||
    value === "waiting_for_secure_connection" ||
    value === "delivery_failed"
  );
}

function isLocalTranscript(value: unknown): value is LocalMeetingTranscript {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<LocalMeetingTranscript>;
  return (
    typeof item.id === "string" &&
    typeof item.provider === "string" &&
    typeof item.title === "string" &&
    typeof item.content === "string" &&
    typeof item.occurredAt === "string" &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string" &&
    isDeliveryState(item.deliveryState)
  );
}

/**
 * Durable desktop storage for transcripts that must not yet leave this machine.
 * The recorder worker owns transient audio; this store receives text only.
 */
export class LocalMeetingTranscriptStore {
  private mutation = Promise.resolve();

  constructor(private readonly root: string) {}

  async list(): Promise<LocalMeetingTranscript[]> {
    const records = await this.read();
    return records
      .filter(isLocalTranscript)
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  }

  async create(input: CreateLocalMeetingTranscriptInput): Promise<LocalMeetingTranscript> {
    return this.mutate(async (records) => {
      const now = new Date().toISOString();
      const record: LocalMeetingTranscript = {
        id: `local:${randomUUID()}`,
        provider: input.provider,
        title: input.title,
        content: input.content,
        occurredAt: input.occurredAt,
        createdAt: now,
        updatedAt: now,
        deliveryState: input.deliveryState,
      };
      return { records: [record, ...records], result: record };
    });
  }

  async capture(receipt: string, content: string, occurredAt: string): Promise<void> {
    await this.mutate(async (records) => {
      const id = `local:zoom:${receipt}`;
      if (records.some((record) => record.id === id)) return { records, result: undefined };
      const now = new Date().toISOString();
      const next: LocalMeetingTranscript = {
        id,
        content,
        occurredAt,
        provider: "zoom",
        title: "Meeting notes",
        createdAt: now,
        updatedAt: now,
        deliveryState: "local_only",
      };
      return { records: [next, ...records], result: undefined };
    });
  }

  async update(input: UpdateLocalMeetingTranscriptInput): Promise<LocalMeetingTranscript | null> {
    return this.mutate(async (records) => {
      const index = records.findIndex((record) => record.id === input.id);
      const previous = records[index];
      if (!previous || !isLocalTranscript(previous)) return { records, result: null };
      const next: LocalMeetingTranscript = {
        ...previous,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
        updatedAt: new Date().toISOString(),
      };
      const nextRecords = records.slice();
      nextRecords[index] = next;
      return { records: nextRecords, result: next };
    });
  }

  async delete(id: string): Promise<boolean> {
    return this.mutate(async (records) => {
      const index = records.findIndex((record) => record.id === id && isLocalTranscript(record));
      if (index < 0) return { records, result: false };
      const next = records.slice();
      if (id.startsWith("local:zoom:")) {
        // Remember the receipt after removing its text, even if the helper copy is still present.
        next[index] = { id, deleted: true };
      } else {
        next.splice(index, 1);
      }
      return { records: next, result: true };
    });
  }

  private async mutate<Result>(
    operation: (records: StoredMeetingTranscript[]) => Promise<{
      records: StoredMeetingTranscript[];
      result: Result;
    }>,
  ): Promise<Result> {
    const run = this.mutation.then(async () => {
      const previous = await this.read();
      const { records, result } = await operation(previous);
      if (records !== previous) await this.write(records);
      return result;
    });
    this.mutation = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private get filePath(): string {
    return path.join(this.root, "local-transcripts.json");
  }

  private async read(): Promise<StoredMeetingTranscript[]> {
    try {
      const value: unknown = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      return Array.isArray(value)
        ? value.filter((item) => isDeletedTranscript(item) || isLocalTranscript(item))
        : [];
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async write(records: StoredMeetingTranscript[]): Promise<void> {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, JSON.stringify(records), { flag: "wx", mode: 0o600 });
      await fs.rename(temporaryPath, this.filePath);
    } finally {
      await fs.rm(temporaryPath, { force: true });
    }
  }
}
