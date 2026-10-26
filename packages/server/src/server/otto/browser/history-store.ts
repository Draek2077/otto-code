import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  BrowserHistoryEntrySchema,
  type BrowserHistoryEntry,
} from "@getpaseo/plugin/otto/browser-history";
import { writeJsonFileAtomic } from "../../atomic-file.js";

const MAX_ENTRIES = 1000;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const queues = new Map<string, Promise<unknown>>();
const storedEntries = z.array(BrowserHistoryEntrySchema.passthrough()).max(MAX_ENTRIES);

export function historyUrl(address: string): string {
  const url = new URL(address);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("Unsupported browser history address.");
  url.username = "";
  url.password = "";
  if (url.href.length > 8192) throw new Error("Browser history address is too long.");
  return url.href;
}

/** Same 0.9 file identity and record format. A corrupt/newer file is preserved, never reset. */
export class BrowserHistoryStore {
  constructor(private readonly home: string) {}
  private async access<T>(projectId: string, operation: (file: string) => Promise<T>): Promise<T> {
    const key = createHash("sha256").update(projectId).digest("hex");
    const file = path.join(this.home, "browser-history", `${key}.json`);
    const previous = queues.get(file) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(() => operation(file));
    queues.set(file, pending);
    try {
      return await pending;
    } finally {
      if (queues.get(file) === pending) queues.delete(file);
    }
  }
  private async read(file: string) {
    try {
      const info = await stat(file);
      if (!info.isFile() || info.size > MAX_FILE_BYTES)
        throw new Error("Browser history data is invalid or oversized.");
      const bytes = await readFile(file);
      if (bytes.length > MAX_FILE_BYTES)
        throw new Error("Browser history data exceeded its size limit.");
      return storedEntries.parse(JSON.parse(bytes.toString("utf8")));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
  }
  search(projectId: string, query: string): Promise<BrowserHistoryEntry[]> {
    return this.access(projectId, async (file) => {
      const needle = query.trim().toLocaleLowerCase();
      return (await this.read(file))
        .map((entry) => ({
          url: historyUrl(entry.url),
          title: entry.title,
          visitedAt: entry.visitedAt,
        }))
        .filter((entry) => `${entry.url}\n${entry.title}`.toLocaleLowerCase().includes(needle))
        .slice(0, 10);
    });
  }
  record(projectId: string, address: string, title: string): Promise<void> {
    const normalized = historyUrl(address);
    return this.access(projectId, async (file) => {
      const entries = await this.read(file);
      const prior = entries.find((entry) => entry.url === normalized);
      const entry = {
        ...prior,
        url: normalized,
        title: title.trim().slice(0, 512) || prior?.title || "",
        visitedAt: new Date().toISOString(),
      };
      await writeJsonFileAtomic(
        file,
        [entry, ...entries.filter((item) => item.url !== normalized)].slice(0, MAX_ENTRIES),
      );
    });
  }
  clear(projectId: string): Promise<void> {
    return this.access(projectId, async (file) => {
      await this.read(file);
      await writeJsonFileAtomic(file, []);
    });
  }
}
