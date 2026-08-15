import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonFileAtomic } from "../atomic-file.js";

export interface MeetingTranscript {
  id: string;
  provider: string;
  title: string;
  content: string;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMeetingTranscript {
  provider: string;
  title: string;
  content: string;
  occurredAt?: string;
}

export interface UpdateMeetingTranscript {
  title?: string;
  content?: string;
}

function normalizeText(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  if (normalized.length > maxLength) throw new Error(`${field} exceeds the maximum length.`);
  return normalized;
}

function parseTranscript(value: unknown): MeetingTranscript {
  if (!value || typeof value !== "object") throw new Error("Stored meeting transcript is invalid.");
  const record = value as Record<string, unknown>;
  const fields = ["id", "provider", "title", "content", "occurredAt", "createdAt", "updatedAt"];
  if (fields.some((field) => typeof record[field] !== "string")) {
    throw new Error("Stored meeting transcript is invalid.");
  }
  return record as unknown as MeetingTranscript;
}

/**
 * Daemon-owned transcript persistence. Each record is its own atomic JSON file,
 * so a partial write cannot corrupt the user's whole meeting library.
 */
export class MeetingTranscriptStore {
  private readonly mutations = new Map<string, Promise<unknown>>();

  constructor(private readonly ottoHome: string) {}

  private get directory(): string {
    return join(this.ottoHome, "meetings", "transcripts");
  }

  private pathFor(id: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Meeting transcript id is invalid.");
    return join(this.directory, `${id}.json`);
  }

  private async ensureDirectory(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
  }

  async list(): Promise<MeetingTranscript[]> {
    await this.ensureDirectory();
    const entries = await readdir(this.directory, { withFileTypes: true });
    const records = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && /^[0-9a-f-]{36}\.json$/i.test(entry.name))
        .map(async (entry) =>
          parseTranscript(JSON.parse(await readFile(join(this.directory, entry.name), "utf8"))),
        ),
    );
    return records.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  }

  async get(id: string): Promise<MeetingTranscript | null> {
    await this.ensureDirectory();
    try {
      return parseTranscript(JSON.parse(await readFile(this.pathFor(id), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async create(input: CreateMeetingTranscript): Promise<MeetingTranscript> {
    await this.ensureDirectory();
    const now = new Date().toISOString();
    const record: MeetingTranscript = {
      id: randomUUID(),
      provider: normalizeText(input.provider, "Provider", 48),
      title: normalizeText(input.title, "Title", 160),
      content: normalizeText(input.content, "Transcript", 5_000_000),
      occurredAt: input.occurredAt?.trim() || now,
      createdAt: now,
      updatedAt: now,
    };
    await writeJsonFileAtomic(this.pathFor(record.id), record);
    return record;
  }

  async update(id: string, update: UpdateMeetingTranscript): Promise<MeetingTranscript | null> {
    return this.serialize(id, async () => {
      const existing = await this.get(id);
      if (!existing) return null;
      const next: MeetingTranscript = {
        ...existing,
        ...(update.title === undefined ? {} : { title: normalizeText(update.title, "Title", 160) }),
        ...(update.content === undefined
          ? {}
          : { content: normalizeText(update.content, "Transcript", 5_000_000) }),
        updatedAt: new Date().toISOString(),
      };
      await writeJsonFileAtomic(this.pathFor(id), next);
      return next;
    });
  }

  async delete(id: string): Promise<boolean> {
    return this.serialize(id, async () => {
      const path = this.pathFor(id);
      try {
        await rm(path);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    });
  }

  private async serialize<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutations.get(id) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    this.mutations.set(
      id,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }
}
