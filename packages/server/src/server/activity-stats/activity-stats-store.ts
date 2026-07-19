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
  // --- Usage & cost accounting (WP-G) ---------------------------------------
  // All additive leaves, default 0 like every other counter, so they ride the
  // existing rollup/persist/wire machinery. "In" = input+cached+cache-write
  // tokens; "Out" = output tokens (same split recordUsageActivity uses for the
  // tokensSent/tokensReceived grand totals). Cost is stored as an INTEGER count
  // of micro-USD (usd * 1e6, rounded) so it stays summable like every other
  // counter — never a float in the store. Cost is only populated for turns that
  // report a real provider cost (Claude's totalCostUsd today); token-only
  // categories leave their cost leaf at 0.
  /** Grand real spend across all categories, micro-USD. Claude-backed today. */
  costMicroUsd: number;
  /** User-facing agent turns (a turn's own compaction spend is broken back out). */
  mainChatTokensIn: number;
  mainChatTokensOut: number;
  mainChatCostMicroUsd: number;
  /** Bare-completion metadata generation (titles, names, commit/PR, summaries). */
  generationsTokensIn: number;
  generationsTokensOut: number;
  generationsCostMicroUsd: number;
  /** Observed/child subagent turns. */
  subagentTokensIn: number;
  subagentTokensOut: number;
  subagentCostMicroUsd: number;
  /** openai-compat auto-compaction summarizer spend (token-only; no real cost). */
  compactionTokensIn: number;
  compactionTokensOut: number;
  /** Provider split for the in/out totals: Claude (real-cost) vs. everything
   *  else (derive "other" as tokensSent/Received minus these). */
  claudeTokensIn: number;
  claudeTokensOut: number;
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
  "costMicroUsd",
  "mainChatTokensIn",
  "mainChatTokensOut",
  "mainChatCostMicroUsd",
  "generationsTokensIn",
  "generationsTokensOut",
  "generationsCostMicroUsd",
  "subagentTokensIn",
  "subagentTokensOut",
  "subagentCostMicroUsd",
  "compactionTokensIn",
  "compactionTokensOut",
  "claudeTokensIn",
  "claudeTokensOut",
];

// Comfortably covers the "last 30 days" rollup with room for clock/timezone
// drift at the edges.
const DAILY_RETENTION_DAYS = 35;

// Change notifications are coalesced: a burst of increments (a busy agent can
// tick several counters per second) produces at most one onDidChange callback
// per window, so the resulting activity_stats_changed broadcast stays quiet.
const CHANGE_NOTIFY_COALESCE_MS = 2_000;

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
  private changeListener: (() => void) | null = null;
  private changeNotifyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly filePath: string,
    logger?: Logger,
  ) {
    this.logger = logger?.child({ component: "activity-stats-store" });
  }

  /**
   * Register the (single) coalesced change listener. Fires at most once per
   * CHANGE_NOTIFY_COALESCE_MS after any counter increments — the hook behind
   * the daemon-wide activity_stats_changed push.
   */
  onDidChange(listener: () => void): void {
    this.changeListener = listener;
  }

  private scheduleChangeNotification(): void {
    if (!this.changeListener || this.changeNotifyTimer) {
      return;
    }
    this.changeNotifyTimer = setTimeout(() => {
      this.changeNotifyTimer = null;
      try {
        this.changeListener?.();
      } catch (error) {
        this.logger?.warn({ err: error }, "Activity stats change listener failed");
      }
    }, CHANGE_NOTIFY_COALESCE_MS);
    // Never hold the process open for a pending stats ping.
    this.changeNotifyTimer.unref?.();
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
      this.scheduleChangeNotification();
      try {
        await writeJsonFileAtomic(this.filePath, state);
      } catch (error) {
        this.logger?.warn({ err: error, field }, "Failed to persist activity stats");
      }
      return undefined;
    });
    return this.queue;
  }

  /**
   * Wipe every counter back to zero (all-time totals and all day buckets) and
   * persist the empty state — the daemon side of the Metrics "Reset" button.
   * Serialized through the same queue as increment() so it can't race a
   * concurrent write, and fires the coalesced change notification so connected
   * clients re-fetch and see the cleared tiles.
   */
  reset(): Promise<void> {
    this.queue = this.queue.then(async () => {
      const empty: PersistedShape = { version: 1, allTime: zeroCounters(), daily: {} };
      this.cache = empty;
      this.scheduleChangeNotification();
      try {
        await writeJsonFileAtomic(this.filePath, empty);
      } catch (error) {
        this.logger?.warn({ err: error }, "Failed to persist activity stats reset");
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
