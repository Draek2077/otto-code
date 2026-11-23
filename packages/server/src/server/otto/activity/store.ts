import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import { z } from "zod";
import {
  ActivityCountsSchema,
  ActivityRequestSchema,
  UsageEventSchema,
  UsageLogRequestSchema,
  activityMethods,
  type ActivityCounter,
  type UsageEvent,
} from "@getpaseo/protocol/otto/activity";
import { writeJsonFileAtomic } from "../../atomic-file.js";
import type { AgentTimelineItem, AgentUsage } from "../../agent/agent-sdk-types.js";

const maxAge = 30 * 24 * 60 * 60 * 1000;
const pageSize = 100;
const flushDelay = 2000;
const storedCounts = z.looseObject({
  version: z.literal(1),
  allTime: ActivityCountsSchema,
  daily: z.record(z.string(), ActivityCountsSchema),
});
const storedEvents = z.looseObject({
  version: z.literal(1),
  events: z.array(UsageEventSchema.loose()),
});

type Counts = z.infer<typeof storedCounts>;
type Events = z.infer<typeof storedEvents>;
type CounterValues = Partial<Record<ActivityCounter, number>>;

function day(offset = 0, now = new Date()): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset, 12);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((value) => String(value).padStart(2, "0"))
    .join("-");
}

function collect(target: Record<string, number>, additions: Record<string, number>): void {
  for (const [key, amount] of Object.entries(additions)) {
    if (amount > 0) {
      target[key] = (Object.hasOwn(target, key) ? target[key]! : 0) + amount;
    }
  }
}

function emptyCounts(): Counts {
  return { version: 1, allTime: {}, daily: {} };
}

function emptyEvents(): Events {
  return { version: 1, events: [] };
}

function knownAmount(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function newestFirst(
  left: Pick<UsageEvent, "id" | "at">,
  right: Pick<UsageEvent, "id" | "at">,
): number {
  return right.at - left.at || left.id.localeCompare(right.id);
}

async function load<T>(filePath: string, schema: z.ZodType<T>, blank: () => T): Promise<T> {
  try {
    return schema.parse(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return blank();
    throw new Error("Could not read saved activity data. The original files are preserved.", {
      cause: error,
    });
  }
}

interface Measurement {
  provider: string;
  agentId?: string;
  model?: string | null;
  kind: "chat" | "generation" | "subagent";
  subtype?: string;
  usage: AgentUsage;
}

interface PendingActivity {
  at: number;
  counters: CounterValues;
  event?: UsageEvent;
}

const usageCategories = {
  chat: "mainChat",
  generation: "generations",
  subagent: "subagent",
} as const;

export class ActivityStore {
  private readonly countFile: string;
  private readonly logFile: string;
  private counts: Counts | null = null;
  private events: Events | null = null;
  private readonly pending: PendingActivity[] = [];
  private readonly recent = new Set<string>();
  private tail = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dirty = { counts: false, events: false };

  constructor(
    home: string,
    private readonly logger: Pick<Logger, "warn">,
  ) {
    this.countFile = path.join(home, "activity-stats.json");
    this.logFile = path.join(home, "usage-log.json");
  }

  increment(key: ActivityCounter): void {
    this.enqueue({ at: Date.now(), counters: { [key]: 1 } });
  }

  recordTimeline(agentId: string, item: AgentTimelineItem, turnId?: string): void {
    switch (item.type) {
      case "user_message":
        this.incrementOnce("messagesSent", agentId, item.clientMessageId ?? item.messageId);
        break;
      case "assistant_message":
        this.incrementOnce("messagesReceived", agentId, item.messageId ?? turnId);
        break;
      case "reasoning":
        this.incrementOnce("thoughts", agentId, turnId);
        break;
      case "tool_call":
        this.incrementOnce("toolsCalled", agentId, item.callId);
        break;
    }
  }

  incrementOnce(key: ActivityCounter, agentId: string, identity?: string): void {
    if (identity) {
      const entry = JSON.stringify([key, agentId, identity]);
      if (this.recent.has(entry)) return;
      this.recent.add(entry);
      if (this.recent.size > 16384) {
        const oldest = this.recent.values().next();
        if (!oldest.done) this.recent.delete(oldest.value);
      }
    }
    this.increment(key);
  }

  record(input: Measurement): void {
    const cached = knownAmount(input.usage.cachedInputTokens);
    const reported = knownAmount(input.usage.inputTokens);
    // Claude's SDK accounts cache reads separately. Other adapters can report
    // them inside their input total, so keep the saved cached subtotal separate.
    const writes = knownAmount(input.usage.cacheCreationInputTokens);
    const tokensIn =
      input.provider === "claude" ? reported + cached + writes : Math.max(reported, cached);
    const tokensOut = knownAmount(input.usage.outputTokens);
    const costMicroUsd = knownAmount((input.usage.totalCostUsd ?? 0) * 1e6);
    if (tokensIn === 0 && tokensOut === 0 && costMicroUsd === 0) return;

    const event: UsageEvent = {
      id: randomUUID(),
      at: Date.now(),
      kind: input.kind,
      provider: input.provider,
      subtype: input.subtype,
      model: input.model ?? undefined,
      agentId: input.agentId,
      tokensIn,
      cachedTokensIn: cached || undefined,
      tokensOut,
      costMicroUsd,
    };
    const category = usageCategories[input.kind];
    const counters: CounterValues = {
      tokensSent: tokensIn,
      tokensReceived: tokensOut,
      costMicroUsd,
      [`${category}TokensIn`]: tokensIn,
      [`${category}TokensOut`]: tokensOut,
      [`${category}CostMicroUsd`]: costMicroUsd,
      ...(input.provider === "claude"
        ? { claudeTokensIn: tokensIn, claudeTokensOut: tokensOut }
        : {}),
    };
    this.enqueue({ at: event.at, counters, event });
  }

  private enqueue(activity: PendingActivity): void {
    // A corrupt file or stalled disk must not grow the pending buffer forever.
    if (this.pending.length < 5000) {
      this.pending.push(activity);
      if (this.pending.length === 5000) {
        this.logger.warn("Otto activity buffer full. Inspect the local activity store.");
      }
    }
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush().catch((error: unknown) => {
        this.logger.warn({ err: error }, "Failed to persist Otto activity");
      });
    }, flushDelay);
    this.timer.unref();
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async snapshot(): Promise<{ counts: Counts; events: Events }> {
    const [counts, events] = await Promise.all([
      this.counts ?? load(this.countFile, storedCounts, emptyCounts),
      this.events ?? load(this.logFile, storedEvents, emptyEvents),
    ]);
    const needsOrder = this.events === null;
    this.counts = counts;
    this.events = events;
    const newEvents: UsageEvent[] = [];

    for (const { at, counters, event } of this.pending.splice(0)) {
      collect(counts.allTime, counters);
      const when = day(0, new Date(at));
      collect((counts.daily[when] ??= {}), counters);
      this.dirty.counts = true;
      if (!event) continue;
      newEvents.push(event);
      this.dirty.events = true;
    }

    const cutoff = day(34);
    const keepDays = Object.keys(counts.daily)
      .sort()
      .filter((key) => key >= cutoff)
      .slice(-35);
    const retainedDays = new Set(keepDays);
    for (const key of Object.keys(counts.daily)) {
      if (retainedDays.has(key)) continue;
      delete counts.daily[key];
      this.dirty.counts = true;
    }
    if (newEvents.length > 0 || needsOrder) {
      events.events = [...newEvents, ...events.events].sort(newestFirst);
    }
    const last = events.events.at(-1);
    const oldest = Date.now() - maxAge;
    if (last && last.at < oldest) {
      const end = events.events.findIndex((event) => event.at < oldest);
      events.events.length = end;
      this.dirty.events = true;
    }
    return { counts, events };
  }

  private async persist(counts: Counts, events: Events): Promise<void> {
    if (this.dirty.counts) {
      await writeJsonFileAtomic(this.countFile, counts);
      this.dirty.counts = false;
    }
    if (this.dirty.events) {
      await writeJsonFileAtomic(this.logFile, events);
      this.dirty.events = false;
    }
  }

  flush(): Promise<void> {
    return this.serialize(async () => {
      if (this.pending.length === 0 && !this.dirty.counts && !this.dirty.events) return;
      const { counts, events } = await this.snapshot();
      await this.persist(counts, events);
    });
  }

  private summary() {
    return this.serialize(async () => {
      const { counts } = await this.snapshot();
      const collectWindow = (days: number) => {
        const end = day();
        const begin = day(days - 1);
        const result: Record<string, number> = {};
        for (const [when, values] of Object.entries(counts.daily)) {
          if (when >= begin && when <= end) collect(result, values);
        }
        return result;
      };
      return {
        today: { ...counts.daily[day()] },
        yesterday: { ...counts.daily[day(1)] },
        last7Days: collectWindow(7),
        last30Days: collectWindow(30),
        allTime: { ...counts.allTime },
      };
    });
  }

  private page(input: z.infer<typeof UsageLogRequestSchema>) {
    return this.serialize(async () => {
      const { events } = await this.snapshot();
      const cursor = input.before;
      const first = cursor ? events.events.findIndex((event) => newestFirst(event, cursor) > 0) : 0;
      const slice = first < 0 ? [] : events.events.slice(first, first + pageSize + 1);
      const last = slice.length > pageSize ? slice[pageSize - 1] : undefined;
      return { events: slice.slice(0, pageSize), next: last ? { at: last.at, id: last.id } : null };
    });
  }

  private reset() {
    return this.serialize(async () => {
      // Validate both originals before acknowledging a reset.
      await this.snapshot();
      this.counts = emptyCounts();
      this.events = emptyEvents();
      this.dirty = { counts: true, events: true };
      await this.persist(this.counts, this.events);
      return null;
    });
  }

  invoke(method: string, input: unknown): Promise<unknown> | undefined {
    switch (method) {
      case activityMethods.summary:
        ActivityRequestSchema.parse(input);
        return this.summary();
      case activityMethods.log:
        return this.page(UsageLogRequestSchema.parse(input));
      case activityMethods.reset:
        ActivityRequestSchema.parse(input);
        return this.reset();
      default:
        return undefined;
    }
  }
}
