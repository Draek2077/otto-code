import type { AgentTimelineRow } from "../../../agent/agent-timeline-store-types.js";
import type { SearchChat } from "./types.js";

const MAX_QUEUED = 24;
const RETRY_DELAY = 60_000;

export interface OfflineHistoryReader {
  supports(provider: string): boolean;
  read(chat: SearchChat, signal: AbortSignal): Promise<AgentTimelineRow[] | null>;
}

/** Demand comes from explicit search. A host never scans native histories on chat startup. */
export class SearchBackfill {
  private readonly queue = new Map<string, SearchChat>();
  private readonly attempted = new Map<string, number>();
  private active: { id: string; abort: AbortController } | null = null;
  private running: Promise<void> | null = null;
  private closed = false;

  constructor(
    private readonly reader: OfflineHistoryReader,
    private readonly capture: (id: string, rows: AgentTimelineRow[]) => Promise<void>,
    private readonly hasLiveWork: (id: string) => boolean,
  ) {}

  offer(chats: readonly SearchChat[], missing: readonly string[]): void {
    if (this.closed) return;
    const ids = new Set(missing);
    for (const chat of chats) {
      if (this.queue.size >= MAX_QUEUED) break;
      if (ids.has(chat.id) && this.mayRead(chat)) this.queue.set(chat.id, chat);
    }
    if (this.queue.size && !this.running) {
      this.running = this.drain().finally(() => {
        this.running = null;
      });
    }
  }

  private mayRead(chat: SearchChat): boolean {
    return (
      this.active?.id !== chat.id &&
      this.reader.supports(chat.provider) &&
      !this.hasLiveWork(chat.id) &&
      Date.now() >= (this.attempted.get(chat.id) ?? 0)
    );
  }

  private async drain(): Promise<void> {
    while (!this.closed) {
      const head = this.queue.values().next().value;
      if (!head) return;
      this.queue.delete(head.id);
      if (!this.mayRead(head)) continue;
      const abort = new AbortController();
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]);
      this.active = { id: head.id, abort };
      try {
        const rows = await this.reader.read(head, signal);
        signal.throwIfAborted();
        if (rows && !this.hasLiveWork(head.id)) await this.capture(head.id, rows);
      } catch {
        // A missing or changing provider transcript must not affect search or chat.
      } finally {
        this.active = null;
        this.attempted.set(head.id, Date.now() + RETRY_DELAY);
        if (this.attempted.size > 512) {
          const oldest = this.attempted.keys().next().value;
          if (oldest !== undefined) this.attempted.delete(oldest);
        }
      }
    }
  }

  discard(id: string): void {
    this.queue.delete(id);
    if (this.active?.id === id) this.active.abort.abort();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.queue.clear();
    this.active?.abort.abort();
    await this.running;
  }
}
