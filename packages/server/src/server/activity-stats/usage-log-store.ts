import { readFile } from "node:fs/promises";
import type { Logger } from "pino";
import type { UsageEvent } from "@otto-code/protocol/messages";
import { writeJsonFileAtomic } from "../atomic-file.js";

// The itemized usage ledger (usage-ledger project). Sibling to ActivityStatsStore:
// the same UsageEvent that the counters roll up is appended here as a scrollable
// row. This is a bounded window of recent detail, NOT the cumulative record (the
// counters are that, and they outlive trimmed rows). Best-effort: a dropped
// append just costs one row, never correctness of the durable counters.
//
// Retention is the 30-day age window and nothing else (user decision) — every
// row within the last 30 days is kept, however many that is.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const DEFAULT_PAGE = 200;
const MAX_PAGE = 500;

// A burst of activity can append several rows/second; coalesce the whole-file
// rewrite so we persist at most once per interval (mirrors the stats store).
const WRITE_COALESCE_MS = 2_000;

export interface UsageLogPage {
  /** Newest-first page of rows. */
  events: UsageEvent[];
  /** True when older rows exist before this page's oldest row. */
  hasMore: boolean;
}

export interface UsageLogPageQuery {
  limit?: number;
  /** Return only rows strictly older than this epoch-ms (cursor for "load more"). */
  before?: number;
}

interface PersistedShape {
  version: 1;
  /** Stored oldest-first (natural append order). */
  events: UsageEvent[];
}

function numOr0(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function sanitizeEvent(value: unknown): UsageEvent | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const r = value as Record<string, unknown>;
  if (
    typeof r.id !== "string" ||
    typeof r.at !== "number" ||
    !Number.isFinite(r.at) ||
    typeof r.kind !== "string" ||
    typeof r.provider !== "string"
  ) {
    return null;
  }
  const event: UsageEvent = {
    id: r.id,
    at: r.at,
    kind: r.kind,
    provider: r.provider,
    tokensIn: numOr0(r.tokensIn),
    tokensOut: numOr0(r.tokensOut),
    costMicroUsd: numOr0(r.costMicroUsd),
  };
  if (typeof r.subtype === "string") event.subtype = r.subtype;
  if (typeof r.model === "string") event.model = r.model;
  if (typeof r.agentId === "string") event.agentId = r.agentId;
  if (typeof r.cachedTokensIn === "number") event.cachedTokensIn = r.cachedTokensIn;
  if (typeof r.rounds === "number") event.rounds = r.rounds;
  if (typeof r.compactionTokensIn === "number") event.compactionTokensIn = r.compactionTokensIn;
  if (typeof r.compactionTokensOut === "number") event.compactionTokensOut = r.compactionTokensOut;
  return event;
}

function sanitizePersisted(value: unknown): PersistedShape {
  if (!value || typeof value !== "object") {
    return { version: 1, events: [] };
  }
  const raw = (value as Record<string, unknown>).events;
  const events: UsageEvent[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const event = sanitizeEvent(item);
      if (event) {
        events.push(event);
      }
    }
  }
  events.sort((a, b) => a.at - b.at);
  return { version: 1, events };
}

/** Drop rows older than the 30-day age window — the sole retention rule. */
function trim(events: UsageEvent[], now: number): UsageEvent[] {
  const cutoff = now - MAX_AGE_MS;
  return events.filter((event) => event.at >= cutoff);
}

/**
 * Daemon-wide, file-backed itemized usage ledger. One JSON array under
 * $OTTO_HOME, cached in memory, rewritten atomically on a coalesced timer —
 * modeled on ActivityStatsStore (serialized read-modify-write queue, atomic
 * writes). Reads are pure in-memory slices, so pagination is cheap.
 */
export class UsageLogStore {
  private cache: PersistedShape | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly logger?: Logger;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(
    private readonly filePath: string,
    logger?: Logger,
  ) {
    this.logger = logger?.child({ component: "usage-log-store" });
  }

  private async load(): Promise<PersistedShape> {
    if (this.cache) {
      return this.cache;
    }
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.cache = sanitizePersisted(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.logger?.warn({ err: error }, "Failed to read usage log; starting empty");
      }
      this.cache = { version: 1, events: [] };
    }
    return this.cache;
  }

  /**
   * Append one ledger row. Fire-and-forget by callers; the returned promise
   * (the internal queue) is there for tests and graceful shutdown to await.
   * Trims to the cap and schedules a coalesced flush.
   */
  append(event: UsageEvent): Promise<void> {
    this.queue = this.queue.then(async () => {
      const state = await this.load();
      state.events.push(event);
      state.events = trim(state.events, Date.now());
      this.scheduleWrite();
      return undefined;
    });
    return this.queue;
  }

  /**
   * Drop every ledger row and persist the empty log immediately — the daemon
   * side of the Metrics "Reset" button. Serialized through the same queue as
   * append() so it can't race an in-flight append, and written synchronously
   * (not on the coalesced timer) so a follow-up getPage() reflects the wipe.
   */
  reset(): Promise<void> {
    this.queue = this.queue.then(async () => {
      this.cache = { version: 1, events: [] };
      this.dirty = false;
      if (this.writeTimer) {
        clearTimeout(this.writeTimer);
        this.writeTimer = null;
      }
      try {
        await writeJsonFileAtomic(this.filePath, this.cache);
      } catch (error) {
        this.logger?.warn({ err: error }, "Failed to persist usage log reset");
        this.dirty = true;
      }
      return undefined;
    });
    return this.queue;
  }

  private scheduleWrite(): void {
    this.dirty = true;
    if (this.writeTimer) {
      return;
    }
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      void this.flush();
    }, WRITE_COALESCE_MS);
    this.writeTimer.unref?.();
  }

  /** Force-persist any pending rows now (graceful shutdown / tests). */
  async flush(): Promise<void> {
    await this.queue;
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    if (!this.dirty || !this.cache) {
      return;
    }
    this.dirty = false;
    try {
      await writeJsonFileAtomic(this.filePath, this.cache);
    } catch (error) {
      this.logger?.warn({ err: error }, "Failed to persist usage log");
      this.dirty = true;
    }
  }

  /** A newest-first page of rows, optionally before a timestamp cursor. */
  async getPage(query: UsageLogPageQuery = {}): Promise<UsageLogPage> {
    const state = await this.load();
    const limit = Math.min(MAX_PAGE, Math.max(1, Math.floor(query.limit ?? DEFAULT_PAGE)));
    // Newest-first view of the oldest-first store.
    const descending = state.events.toReversed();
    const filtered =
      query.before !== undefined
        ? descending.filter((event) => event.at < query.before!)
        : descending;
    const events = filtered.slice(0, limit);
    return { events, hasMore: filtered.length > events.length };
  }
}
