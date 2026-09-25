/* eslint-disable unicorn/require-post-message-target-origin -- Node worker messages have no browser origin. */
import { Worker } from "node:worker_threads";
import { join } from "node:path";
import type { Logger } from "pino";
import type { AgentTimelineRow } from "../agent/agent-timeline-store-types.js";
import type { ChatSearchInput, ChatSearchResult, SearchChat, SearchSource } from "./types.js";

interface TimelineSnapshot {
  rows: AgentTimelineRow[];
  complete: boolean;
  busy?: boolean;
}
interface Options {
  ottoHome: string;
  logger: Logger;
  list(): Promise<SearchChat[]>;
  snapshot(id: string): TimelineSnapshot | null;
  backfill(id: string, signal: AbortSignal): Promise<AgentTimelineRow[] | null>;
  revision?(id: string): Promise<string | null>;
  refreshIntervalMs?: number;
}

export class ChatSearchService {
  private worker: Worker | null = null;
  private sequence = 0;
  private readonly pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  private readonly dirty = new Set<string>();
  private readonly generations = new Map<string, number>();
  private readonly retryAt = new Map<string, number>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  private reconciling: Promise<void> | null = null;
  private flushing: Promise<void> | null = null;
  private historyAbort: AbortController | null = null;
  private stopped = false;
  private stopping = false;
  private readonly deleted = new Set<string>();

  constructor(private readonly options: Options) {}

  start(): void {
    void this.reconcile().catch((error) =>
      this.options.logger.warn({ err: error }, "Chat search reconciliation failed"),
    );
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    const url = new URL(
      import.meta.url.endsWith(".ts") ? "./search-worker.ts" : "./search-worker.js",
      import.meta.url,
    );
    const worker = import.meta.url.endsWith(".ts")
      ? new Worker(
          `import('tsx/esm/api').then(({ tsImport }) => tsImport(${JSON.stringify(url.href)}, ${JSON.stringify(import.meta.url)}));`,
          { eval: true, workerData: { directory: join(this.options.ottoHome, "chat-search") } },
        )
      : new Worker(url, { workerData: { directory: join(this.options.ottoHome, "chat-search") } });
    this.worker = worker;
    worker.on("message", (message: { id: number; value?: unknown; error?: string }) => {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error));
      else pending.resolve(message.value);
    });
    const fail = (error: Error) => {
      if (this.worker !== worker) return;
      this.worker = null;
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
    worker.on("error", fail);
    worker.on("exit", (code) => fail(new Error(`Chat search worker exited (${code})`)));
    return worker;
  }

  private request<T>(message: object): Promise<T> {
    if (this.stopped) return Promise.reject(new Error("Chat search is closed"));
    // Bound queued structured clones when clients query faster than storage can respond.
    if (this.pending.size >= 64) return Promise.reject(new Error("Chat search is catching up"));
    const worker = this.getWorker();
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      worker.postMessage({ ...message, id });
    });
  }

  schedule(id: string): void {
    if (this.deleted.has(id) || this.stopping || this.stopped) return;
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
    this.dirty.add(id);
    if (!this.flushTimer && !this.stopped) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flush().catch((error) =>
          this.options.logger.warn({ err: error }, "Chat search capture will retry"),
        );
      }, 1000);
      this.flushTimer.unref();
    }
  }

  async capture(
    id: string,
    rows: readonly AgentTimelineRow[],
    complete: boolean,
    providerRevision?: string,
  ): Promise<void> {
    if (this.deleted.has(id)) return;
    // Enqueue synchronously with the timeline snapshot. No provider I/O can reorder this
    // replacement after a later rewind or deletion. Hashing/tokenization stay off-thread.
    const messages = rows.filter(
      (row) => row.item.type === "user_message" || row.item.type === "assistant_message",
    );
    await this.request({
      type: "capture",
      agentId: id,
      rows: messages,
      complete,
      providerRevision,
      verifiedAt: Date.now(),
    });
  }

  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.flushDirty().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async flushDirty(): Promise<void> {
    for (const id of this.dirty) {
      const snapshot = this.options.snapshot(id);
      if (!snapshot) {
        this.dirty.delete(id);
        continue;
      }
      const generation = this.generations.get(id);
      await this.capture(id, snapshot.rows, snapshot.complete);
      if (generation === this.generations.get(id)) this.dirty.delete(id);
    }
  }

  async delete(id: string): Promise<void> {
    this.deleted.add(id);
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
    this.dirty.delete(id);
    this.retryAt.delete(id);
    await this.request({ type: "delete", agentId: id });
  }

  async reconcile(): Promise<void> {
    if (this.stopping || this.stopped) return;
    if (this.reconcileTimer) {
      clearTimeout(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    if (this.reconciling) return this.reconciling;
    this.reconciling = this.runReconciliation().finally(() => {
      this.reconciling = null;
      if (!this.stopped && !this.stopping) {
        this.reconcileTimer = setTimeout(() => this.start(), 30_000);
        this.reconcileTimer.unref();
      }
    });
    return this.reconciling;
  }

  private async runReconciliation(): Promise<void> {
    const chats = await this.options.list();
    await this.flush();
    await this.request({ type: "sync", chats });
    for (const chat of chats) {
      if (this.stopped || this.stopping) return;
      const live = this.options.snapshot(chat.id);
      if (live && !(await this.request({ type: "source", agentId: chat.id }))) {
        await this.capture(chat.id, live.rows, live.complete);
      }
      if (live?.busy) {
        if (this.dirty.has(chat.id)) await this.capture(chat.id, live.rows, live.complete);
        continue;
      }
      await this.reconcileChat(chat.id);
    }
  }

  private jobIsStale(id: string, generation: number | undefined): boolean {
    return (
      this.stopping ||
      this.stopped ||
      this.deleted.has(id) ||
      generation !== this.generations.get(id)
    );
  }

  private sourceIsCurrent(
    source: Omit<SearchSource, "messages"> | null,
    revision: string | null,
  ): boolean {
    if (!source?.complete || source.verifiedAt === undefined) return false;
    if (Date.now() - source.verifiedAt >= (this.options.refreshIntervalMs ?? 15 * 60_000))
      return false;
    return revision === null || source.providerRevision === revision;
  }

  private async reconcileChat(id: string): Promise<void> {
    if ((this.retryAt.get(id) ?? 0) > Date.now()) return;
    const generation = this.generations.get(id);
    const source = await this.request<Omit<SearchSource, "messages"> | null>({
      type: "source",
      agentId: id,
    }).catch(() => null);
    try {
      const revision = (await this.options.revision?.(id)) ?? null;
      if (this.sourceIsCurrent(source, revision)) return;
      const rows = await this.readHistory(id);
      if (this.jobIsStale(id, generation)) return;
      if (revision !== ((await this.options.revision?.(id)) ?? null)) return;
      // Providers without offline history retain messages already observed by Otto.
      if (rows === null && source?.complete) return;
      if (rows === null) throw new Error("Provider history is unavailable");
      // Re-read ownership after history I/O; a failed enumeration is not a deletion.
      if (!(await this.options.list()).some((current) => current.id === id)) return;
      if (this.jobIsStale(id, generation)) return;
      await this.capture(id, rows, true, revision ?? undefined);
      this.retryAt.delete(id);
    } catch (error) {
      if (this.jobIsStale(id, generation)) return;
      this.retryAt.set(id, Date.now() + 60_000);
      await this.request({ type: "unavailable", agentId: id });
      this.options.logger.debug({ err: error, agentId: id }, "Chat search history will retry");
    }
  }

  private async readHistory(id: string): Promise<AgentTimelineRow[] | null> {
    const controller = new AbortController();
    this.historyAbort = controller;
    const timer = setTimeout(
      () => controller.abort(new Error("Chat history read timed out")),
      60_000,
    );
    timer.unref();
    let onAbort: () => void = () => {};
    const canceled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([this.options.backfill(id, controller.signal), canceled]);
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", onAbort);
      if (this.historyAbort === controller) this.historyAbort = null;
    }
  }

  async search(input: ChatSearchInput): Promise<ChatSearchResult> {
    // Refresh cheap registry facets on every query: moves/deletion never depend on a timer.
    const chats = await this.options.list();
    await this.flush();
    await this.request({ type: "sync", chats });
    return this.request({ type: "search", input });
  }

  async close(): Promise<void> {
    if (this.stopped) return;
    this.stopping = true;
    this.historyAbort?.abort(new Error("Chat search is shutting down"));
    if (this.reconcileTimer) clearTimeout(this.reconcileTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    try {
      await this.reconciling?.catch(() => undefined);
      await this.flush();
      await this.request({ type: "close" });
    } finally {
      this.stopped = true;
      await this.worker?.terminate();
      this.worker = null;
    }
  }
}
