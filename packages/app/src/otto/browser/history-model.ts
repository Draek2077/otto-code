import type { BrowserHistoryEntry } from "@getpaseo/plugin/otto/browser-history";

export interface BrowserHistoryPort {
  search(query: string): Promise<BrowserHistoryEntry[]>;
  record(url: string, title: string): Promise<void>;
  clear(): Promise<void>;
}
interface HistorySnapshot {
  entries: BrowserHistoryEntry[];
  query: string;
  selected: number;
  searching: boolean;
  clearing: boolean;
  cleared: boolean;
  searchError: string;
  visitError: string;
  clearError: string;
}
export function browserHistoryVisit(
  address: string | null,
  title: string,
): { url: string; title: string } | null {
  if (!address || address.length > 8192) return null;
  try {
    const url = new URL(address);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    return { url: url.href, title: title.slice(0, 512) };
  } catch {
    return null;
  }
}
/** Address draft/search state only. The owning daemon is the sole durable history store. */
export class BrowserHistoryModel {
  private state: HistorySnapshot = {
    entries: [],
    query: "",
    selected: -1,
    searching: false,
    clearing: false,
    cleared: false,
    searchError: "",
    visitError: "",
    clearError: "",
  };
  private listeners = new Set<() => void>();
  private active = false;
  private authority = 0;
  private focused = false;
  private sequence = 0;
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private visitTimer: ReturnType<typeof setTimeout> | undefined;
  private lastVisit: { url: string; title: string } | null = null;
  private pending: Promise<void> = Promise.resolve();
  private clearing = false;
  private failedVisit: { url: string; title: string } | null = null;
  private retrying = false;
  constructor(private readonly port: BrowserHistoryPort) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<HistorySnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  activate() {
    this.active = true;
    const authority = ++this.authority;
    this.publish({ clearing: this.clearing, searching: false });
    if (this.focused) this.search(this.state.query);
    return () => {
      if (authority !== this.authority) return;
      this.authority++;
      this.active = false;
      this.focused = false;
      this.sequence++;
      clearTimeout(this.searchTimer);
      clearTimeout(this.visitTimer);
    };
  }
  focus(focused: boolean) {
    this.focused = focused;
    this.search(this.state.query);
  }
  search(query: string) {
    clearTimeout(this.searchTimer);
    const sequence = ++this.sequence;
    this.publish({ query, entries: [], selected: -1, searching: false, searchError: "" });
    if (!this.active || !this.focused) return;
    this.publish({ searching: true });
    this.searchTimer = setTimeout(() => {
      void this.fetch(query, sequence);
    }, 120);
  }
  private async fetch(query: string, sequence: number) {
    try {
      const entries = await this.port.search(query.slice(0, 8192));
      if (this.active && this.focused && sequence === this.sequence)
        this.publish({ entries, searching: false });
    } catch {
      if (this.active && this.focused && sequence === this.sequence)
        this.publish({ searchError: "Could not load browsing history.", searching: false });
    }
  }
  move(direction: 1 | -1) {
    const length = this.state.entries.length;
    if (!length) return;
    const selected =
      this.state.selected < 0 && direction === -1
        ? length - 1
        : (this.state.selected + direction + length) % length;
    this.publish({ selected });
  }
  selected(): string | null {
    return this.state.entries[this.state.selected]?.url ?? null;
  }
  dismiss() {
    this.focus(false);
  }
  visit(address: string | null, title: string) {
    clearTimeout(this.visitTimer);
    this.lastVisit = browserHistoryVisit(address, title);
    if (!this.active || !this.lastVisit) return;
    const visit = this.lastVisit;
    this.visitTimer = setTimeout(() => {
      this.queueVisit(visit);
    }, 180);
  }
  retryVisit() {
    const visit = this.failedVisit ?? this.lastVisit;
    if (!this.active || !visit || this.retrying) return;
    this.retrying = true;
    void this.queueVisit(visit).finally(() => {
      this.retrying = false;
    });
  }
  private queueVisit(visit: { url: string; title: string }) {
    const authority = this.authority;
    this.pending = this.pending.then(async () => {
      try {
        await this.port.record(visit.url, visit.title);
        this.failedVisit = null;
        if (this.active && authority === this.authority)
          this.publish({ visitError: "", cleared: false });
      } catch {
        this.failedVisit = visit;
        if (this.active && authority === this.authority)
          this.publish({
            visitError: "Could not save browsing history. Your saved history has been preserved.",
          });
      }
      return undefined;
    });
    return this.pending;
  }
  async clear(confirm: () => Promise<boolean>): Promise<boolean> {
    if (this.clearing || !this.active) return false;
    this.clearing = true;
    const authority = this.authority;
    try {
      if (!(await confirm()) || !this.active || authority !== this.authority) return false;
      clearTimeout(this.visitTimer);
      this.sequence++;
      clearTimeout(this.searchTimer);
      this.publish({
        entries: [],
        selected: -1,
        searching: false,
        clearing: true,
        cleared: false,
        clearError: "",
      });
      const operation = this.pending.then(() => this.port.clear());
      this.pending = operation.catch(() => undefined);
      await operation;
      if (this.active && authority === this.authority)
        this.publish({ clearing: false, cleared: true, visitError: "" });
      return true;
    } catch {
      if (this.active && authority === this.authority)
        this.publish({
          clearing: false,
          clearError: "Could not clear browsing history. Retry when this host is available.",
        });
      return false;
    } finally {
      this.clearing = false;
      if (this.active && authority !== this.authority) this.publish({ clearing: false });
    }
  }
}
