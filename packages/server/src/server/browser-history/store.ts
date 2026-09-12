import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BrowserHistoryEntrySchema, type BrowserHistoryEntry } from "@otto-code/protocol/messages";
import { writeJsonFileAtomic } from "../atomic-file.js";

const MAX_ENTRIES = 1000;
// All sessions share a queue per project file, including clears and reads.
const queues = new Map<string, Promise<unknown>>();

export class BrowserHistoryStore {
  constructor(private readonly ottoHome: string) {}

  private async access<T>(projectId: string, operation: (file: string) => Promise<T>): Promise<T> {
    const key = createHash("sha256").update(projectId).digest("hex");
    const file = path.join(this.ottoHome, "browser-history", `${key}.json`);
    const previous = queues.get(file) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(() => operation(file));
    queues.set(file, pending);
    try {
      return await pending;
    } finally {
      if (queues.get(file) === pending) queues.delete(file);
    }
  }

  private async read(file: string): Promise<BrowserHistoryEntry[]> {
    try {
      const value: unknown = JSON.parse(await readFile(file, "utf8"));
      return BrowserHistoryEntrySchema.array().max(MAX_ENTRIES).parse(value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  search(projectId: string, query: string): Promise<BrowserHistoryEntry[]> {
    return this.access(projectId, async (file) => {
      const needle = query.trim().toLocaleLowerCase();
      return (await this.read(file))
        .filter((entry) => `${entry.url}\n${entry.title}`.toLocaleLowerCase().includes(needle))
        .slice(0, 10);
    });
  }

  record(projectId: string, address: string, title: string): Promise<void> {
    return this.access(projectId, async (file) => {
      const url = new URL(address);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("Unsupported browser URL");
      // User-info is never persisted or offered back as a suggestion.
      url.username = "";
      url.password = "";
      const normalized = url.href;
      const entries = await this.read(file);
      const previous = entries.find((entry) => entry.url === normalized);
      const entry = BrowserHistoryEntrySchema.parse({
        url: normalized,
        title: title.trim().slice(0, 512) || previous?.title || "",
        visitedAt: new Date().toISOString(),
      });
      await writeJsonFileAtomic(
        file,
        [entry, ...entries.filter((item) => item.url !== normalized)].slice(0, MAX_ENTRIES),
      );
    });
  }

  clear(projectId: string): Promise<void> {
    return this.access(projectId, (file) => writeJsonFileAtomic(file, []));
  }
}
