import { readFile } from "node:fs/promises";
import type { Logger } from "pino";
import { writeJsonFileAtomic } from "../atomic-file.js";

/** Per-personality spawn counts, keyed by personality id. */
export type PersonalityUsageStats = Record<string, number>;

/**
 * A tiny file-backed counter for personality spawns. Kept OUT of the daemon
 * config on purpose: config writes fire the `status:daemon_config_changed`
 * broadcast, and incrementing on every spawn would spam it. This lives in its
 * own JSON file with atomic writes and a serialized read-modify-write queue so
 * concurrent spawns can't lose increments.
 */
export class PersonalityStatsStore {
  private cache: PersonalityUsageStats | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly logger?: Logger;

  constructor(
    private readonly filePath: string,
    logger?: Logger,
  ) {
    this.logger = logger?.child({ component: "personality-stats-store" });
  }

  private async load(): Promise<PersonalityUsageStats> {
    if (this.cache) {
      return this.cache;
    }
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.cache = sanitizeStats(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.logger?.warn({ err: error }, "Failed to read personality stats; starting empty");
      }
      this.cache = {};
    }
    return this.cache;
  }

  /** A snapshot copy of the current counts. */
  async get(): Promise<PersonalityUsageStats> {
    return { ...(await this.load()) };
  }

  /** Increment one personality's spawn count, persisting atomically. */
  increment(personalityId: string): Promise<void> {
    this.queue = this.queue.then(async () => {
      const stats = await this.load();
      stats[personalityId] = (stats[personalityId] ?? 0) + 1;
      try {
        await writeJsonFileAtomic(this.filePath, stats);
      } catch (error) {
        this.logger?.warn({ err: error, personalityId }, "Failed to persist personality stats");
      }
      return undefined;
    });
    return this.queue;
  }
}

function sanitizeStats(value: unknown): PersonalityUsageStats {
  if (!value || typeof value !== "object") {
    return {};
  }
  const out: PersonalityUsageStats = {};
  for (const [key, count] of Object.entries(value as Record<string, unknown>)) {
    if (typeof count === "number" && Number.isFinite(count) && count >= 0) {
      out[key] = count;
    }
  }
  return out;
}
