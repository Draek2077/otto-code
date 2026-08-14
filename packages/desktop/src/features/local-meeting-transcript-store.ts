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
    return records.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
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

  async update(input: UpdateLocalMeetingTranscriptInput): Promise<LocalMeetingTranscript | null> {
    return this.mutate(async (records) => {
      const index = records.findIndex((record) => record.id === input.id);
      if (index < 0) return { records, result: null };
      const previous = records[index];
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
      const next = records.filter((record) => record.id !== id);
      return { records: next, result: next.length !== records.length };
    });
  }

  private async mutate<Result>(
    operation: (records: LocalMeetingTranscript[]) => Promise<{
      records: LocalMeetingTranscript[];
      result: Result;
    }>,
  ): Promise<Result> {
    const run = this.mutation.then(async () => {
      const { records, result } = await operation(await this.read());
      await this.write(records);
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

  private async read(): Promise<LocalMeetingTranscript[]> {
    try {
      const value: unknown = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      return Array.isArray(value) ? value.filter(isLocalTranscript) : [];
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async write(records: LocalMeetingTranscript[]): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(records), "utf8");
    await fs.rename(temporaryPath, this.filePath);
  }
}
