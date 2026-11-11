import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import type { Logger } from "pino";
import type { AgentTimelineRow } from "../../../agent/agent-timeline-store-types.js";
import type { SearchWorkerRequest } from "./search-worker.js";
import type { ChatSearchInput, ChatSearchResult, SearchChat } from "./types.js";

export interface SearchTimeline {
  rows: AgentTimelineRow[];
  complete: boolean;
}

interface WorkerReply {
  id: number;
  value?: unknown;
  error?: string;
}

function createWorker(directory: string): Worker {
  const source = import.meta.url.endsWith(".ts");
  const url = new URL(source ? "./search-worker.ts" : "./search-worker.js", import.meta.url);
  const workerData = { directory };
  if (!source) return new Worker(url, { workerData });
  const script = `import('tsx/esm/api').then(({ tsImport }) => tsImport(${JSON.stringify(url.href)}, ${JSON.stringify(import.meta.url)}));`;
  return new Worker(script, { eval: true, workerData });
}

function isInScope(chat: SearchChat, input: ChatSearchInput) {
  if (input.workspaceId && input.workspaceId !== chat.workspaceId) return false;
  if (input.projectId && input.projectId !== chat.projectId) return false;
  if (input.archive === "active") return !chat.archived;
  if (input.archive === "archived") return chat.archived;
  return true;
}

/** This captures existing timeline projections; it never starts or resumes an agent. */
export class ChatSearchService {
  private readonly dirty = new Set<string>();
  private readonly pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  private readonly directory: string;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushing: Promise<void> | undefined;
  private worker: Worker | undefined;
  private sequence = 0;
  private closing = false;

  constructor(
    private readonly options: {
      home: string;
      logger: Pick<Logger, "warn">;
      snapshot(id: string): SearchTimeline | null;
      list(): Promise<SearchChat[]>;
    },
  ) {
    this.directory = join(options.home, "chat-search");
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = createWorker(this.directory);
    this.worker = worker;
    worker.on("message", (message: WorkerReply) => {
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error));
      else request.resolve(message.value);
    });
    const fail = (error: Error) => {
      if (this.worker !== worker) return;
      this.worker = undefined;
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
    };
    worker.on("error", fail);
    worker.on("exit", (code) => fail(new Error(`Chat search worker exited (${code})`)));
    worker.unref();
    return worker;
  }

  private request<T>(message: SearchWorkerRequest): Promise<T> {
    if (this.pending.size >= 32) return Promise.reject(new Error("Chat search is busy"));
    const worker = this.getWorker();
    const send = worker.postMessage.bind(worker);
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      try {
        send({ ...message, id });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  changed(agentId: string): void {
    if (this.closing) return;
    this.dirty.add(agentId);
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush().catch((error: unknown) =>
        this.options.logger.warn({ err: error }, "Chat search capture failed"),
      );
    }, 4_000);
    this.timer.unref();
  }

  private flush(): Promise<void> {
    this.flushing ??= this.captureDirty().finally(() => {
      this.flushing = undefined;
    });
    return this.flushing;
  }

  private async captureDirty(): Promise<void> {
    // Bound this pass; live deltas can add more work during each awaited write.
    const limit = this.dirty.size;
    let processed = 0;
    for (const id of this.dirty) {
      if (processed >= limit) break;
      if (!this.dirty.delete(id)) continue;
      processed += 1;
      const snapshot = this.options.snapshot(id);
      if (!snapshot) continue;
      try {
        await this.capture(id, snapshot);
      } catch (error) {
        this.dirty.add(id);
        throw error;
      }
    }
  }

  capture(agentId: string, snapshot: SearchTimeline): Promise<void> {
    return this.request({
      type: "capture",
      agentId,
      rows: snapshot.rows,
      complete: snapshot.complete,
      verifiedAt: Date.now(),
    });
  }

  async forget(agentId: string): Promise<void> {
    this.dirty.delete(agentId);
    if (this.worker) {
      await this.request({ type: "delete", agentId });
      return;
    }
    const key = createHash("sha256").update(agentId).digest("hex");
    for (const source of ["sources-v2", "sources"]) {
      await rm(join(this.directory, source, `${key}.json`), { force: true });
    }
  }

  async search(input: ChatSearchInput, visibleProvider: (id: string) => boolean) {
    if (this.closing) throw new Error("Chat search is closed");
    const chats = (await this.options.list()).filter(
      (chat) => visibleProvider(chat.provider) && isInScope(chat, input),
    );
    if (!chats.length) {
      return {
        hits: [],
        hasMore: false,
        coverage: { total: 0, indexed: 0, pending: 0, unavailable: 0 },
      };
    }
    await this.flush();
    return this.request<ChatSearchResult>({ type: "search", input, chats });
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    clearTimeout(this.timer);
    try {
      await this.flush();
      if (this.worker) await this.request({ type: "close" });
    } finally {
      await this.worker?.terminate();
    }
  }
}
