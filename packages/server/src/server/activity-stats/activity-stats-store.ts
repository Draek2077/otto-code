import { readFile } from "node:fs/promises";
import type { Logger } from "pino";
import { writeJsonFileAtomic } from "../atomic-file.js";

/** One calendar day's worth of counters. Every field defaults to 0 when absent. */
export interface ActivityCounters {
  messagesSent: number;
  messagesReceived: number;
  tokensSent: number;
  tokensReceived: number;
  agentsCreated: number;
  runsOrchestrated: number;
  subagentsInvoked: number;
  backgroundTasksInvoked: number;
  thoughts: number;
  toolsCalled: number;
  artifactsCreated: number;
  schedulesExecuted: number;
}

export type ActivityCounterField = keyof ActivityCounters;

/** Fire-and-forget increment callback threaded into the services that produce activity. */
export type ActivityIncrementFn = (field: ActivityCounterField, by?: number) => void;

export interface ActivityRollups {
  today: ActivityCounters;
  yesterday: ActivityCounters;
  last7Days: ActivityCounters;
  last30Days: ActivityCounters;
  allTime: ActivityCounters;
}

const COUNTER_FIELDS: readonly ActivityCounterField[] = [
  "messagesSent",
  "messagesReceived",
  "tokensSent",
  "tokensReceived",
  "agentsCreated",
  "runsOrchestrated",
  "subagentsInvoked",
  "backgroundTasksInvoked",
  "thoughts",
  "toolsCalled",
  "artifactsCreated",
  "schedulesExecuted",
];

// Comfortably covers the "last 30 days" rollup with room for clock/timezone
// drift at the edges.
const DAILY_RETENTION_DAYS = 35;

function zeroCounters(): ActivityCounters {
  const counters = {} as ActivityCounters;
  for (const field of COUNTER_FIELDS) {
    counters[field] = 0;
  }
  return counters;
}

function addCounters(target: ActivityCounters, source: ActivityCounters): void {
  for (const field of COUNTER_FIELDS) {
    target[field] += source[field];
  }
}

function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysAgoKey(from: Date, daysAgo: number): string {
  const d = new Date(from);
  d.setDate(d.getDate() - daysAgo);
  return dayKey(d);
}

interface PersistedShape {
  version: 1;
  allTime: ActivityCounters;
  daily: Record<string, ActivityCounters>;
}

function sanitizeCounters(value: unknown): ActivityCounters {
  const counters = zeroCounters();
  if (!value || typeof value !== "object") {
    return counters;
  }
  for (const field of COUNTER_FIELDS) {
    const raw = (value as Record<string, unknown>)[field];
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
      counters[field] = raw;
    }
  }
  return counters;
}

function sanitizePersisted(value: unknown): PersistedShape {
  const fallback: PersistedShape = { version: 1, allTime: zeroCounters(), daily: {} };
  if (!value || typeof value !== "object") {
    return fallback;
  }
  const record = value as Record<string, unknown>;
  const allTime = sanitizeCounters(record.allTime);
  const daily: Record<string, ActivityCounters> = {};
  if (record.daily && typeof record.daily === "object") {
    for (const [key, counters] of Object.entries(record.daily as Record<string, unknown>)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
        daily[key] = sanitizeCounters(counters);
      }
    }
  }
  return { version: 1, allTime, daily };
}

/**
 * Daemon-wide, file-backed "fun stats" counters — messages, tokens, agents
 * created, runs, subagents, background tasks, thoughts, tool calls, artifacts,
 * schedules. Bucketed by calendar day (not by session/connection) so activity
 * that happens while no client is connected is never lost, and restarts don't
 * need any recovery bookkeeping. Modeled on PersonalityStatsStore/PushTokenStore:
 * atomic writes, serialized read-modify-write queue for concurrent increments.
 */
export class ActivityStatsStore {
  private cache: PersistedShape | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly logger?: Logger;

  constructor(
    private readonly filePath: string,
    logger?: Logger,
  ) {
    this.logger = logger?.child({ component: "activity-stats-store" });
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
        this.logger?.warn({ err: error }, "Failed to read activity stats; starting empty");
      }
      this.cache = { version: 1, allTime: zeroCounters(), daily: {} };
    }
    return this.cache;
  }

  /** Increment one counter, persisting atomically. Fire-and-forget by callers. */
  increment(field: ActivityCounterField, by = 1): Promise<void> {
    if (by === 0) {
      return this.queue;
    }
    this.queue = this.queue.then(async () => {
      const state = await this.load();
      const today = dayKey(new Date());
      state.allTime[field] += by;
      state.daily[today] = state.daily[today] ?? zeroCounters();
      state.daily[today][field] += by;
      trimOldDays(state.daily);
      try {
        await writeJsonFileAtomic(this.filePath, state);
      } catch (error) {
        this.logger?.warn({ err: error, field }, "Failed to persist activity stats");
      }
      return undefined;
    });
    return this.queue;
  }

  /** Pre-summed rollups for the five preset dashboard windows. */
  async getRollups(): Promise<ActivityRollups> {
    const state = await this.load();
    const now = new Date();
    const todayKey = dayKey(now);
    const yesterdayKey = daysAgoKey(now, 1);

    const last7Days = zeroCounters();
    const last30Days = zeroCounters();
    for (let i = 0; i < DAILY_RETENTION_DAYS; i++) {
      const key = daysAgoKey(now, i);
      const bucket = state.daily[key];
      if (!bucket) continue;
      if (i < 7) addCounters(last7Days, bucket);
      if (i < 30) addCounters(last30Days, bucket);
    }

    return {
      today: { ...(state.daily[todayKey] ?? zeroCounters()) },
      yesterday: { ...(state.daily[yesterdayKey] ?? zeroCounters()) },
      last7Days,
      last30Days,
      allTime: { ...state.allTime },
    };
  }
}

function trimOldDays(daily: Record<string, ActivityCounters>): void {
  const keys = Object.keys(daily).sort();
  const excess = keys.length - DAILY_RETENTION_DAYS;
  for (let i = 0; i < excess; i++) {
    delete daily[keys[i]];
  }
}
