import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface HostPage {
  close(): Promise<void>;
  isClosed(): boolean;
}
export interface HostTab {
  browserId: string;
  workspaceId: string;
  cwd: string;
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  viewportWidth: number;
  viewportHeight: number;
  state: "suspended" | "ready" | "error";
  error: string | null;
}
interface Entry<P> {
  tab: HostTab;
  page: P | null;
  users: number;
  touched: number;
  queue: Promise<unknown>;
  idle: ReturnType<typeof setTimeout> | null;
}
/** One daemon-owned page inventory. Reads are inert; only explicit use wakes a page. */
export class HostBrowserPages<P extends HostPage> {
  private readonly entries = new Map<string, Entry<P>>();
  private readonly actor = new AsyncResource("otto-host-browser-pages", {
    requireManualDestroy: true,
  });
  private openings: Promise<unknown> = Promise.resolve();
  private closed = false;
  private closing: Promise<void> | null = null;
  constructor(
    private readonly ports: {
      open(tab: HostTab): Promise<P>;
      close(): Promise<void>;
      now?: () => number;
      changed?(): void;
    },
  ) {}
  private now() {
    return this.ports.now?.() ?? Date.now();
  }
  private entry(workspaceId: string, browserId: string): Entry<P> {
    if (this.closed) throw new Error("Host Browser is closed.");
    const entry = this.entries.get(browserId);
    if (!entry || entry.tab.workspaceId !== workspaceId)
      throw new Error("This Host Browser tab does not belong to the workspace.");
    return entry;
  }
  private publish() {
    try {
      this.ports.changed?.();
    } catch {
      /* A view observer cannot change page ownership. */
    }
  }
  list(workspaceId: string): HostTab[] {
    return Array.from(this.entries.values())
      .filter((entry) => entry.tab.workspaceId === workspaceId)
      .map((entry) => Object.assign({}, entry.tab));
  }
  get(workspaceId: string, browserId: string): HostTab {
    return { ...this.entry(workspaceId, browserId).tab };
  }
  update(
    workspaceId: string,
    browserId: string,
    patch: Partial<
      Pick<
        HostTab,
        | "url"
        | "title"
        | "isLoading"
        | "canGoBack"
        | "canGoForward"
        | "viewportWidth"
        | "viewportHeight"
        | "error"
      >
    >,
  ): void {
    const entry = this.entry(workspaceId, browserId);
    entry.tab = { ...entry.tab, ...patch };
    this.publish();
  }
  async create(binding: { workspaceId: string; cwd: string }, url: string): Promise<HostTab> {
    if (this.closed) throw new Error("Host Browser is closed.");
    if (this.entries.size >= 256)
      throw new Error("Close an existing Host Browser tab before creating another.");
    const tab: HostTab = {
      ...binding,
      browserId: randomUUID(),
      url,
      title: "",
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      viewportWidth: 390,
      viewportHeight: 844,
      state: "suspended",
      error: null,
    };
    const entry: Entry<P> = {
      tab,
      page: null,
      users: 0,
      touched: this.now(),
      queue: Promise.resolve(),
      idle: null,
    };
    this.entries.set(tab.browserId, entry);
    try {
      await this.use(binding.workspaceId, tab.browserId, async () => {});
      return { ...entry.tab };
    } catch (error) {
      // An unreturned identity must not accumulate invisible failed creates.
      this.clearIdle(entry);
      if (!entry.page) this.entries.delete(tab.browserId);
      throw error;
    }
  }
  private clearIdle(entry: Entry<P>) {
    if (entry.idle !== null) clearTimeout(entry.idle);
    entry.idle = null;
  }
  private idle(entry: Entry<P>) {
    this.clearIdle(entry);
    if (
      this.closed ||
      this.entries.get(entry.tab.browserId) !== entry ||
      entry.users ||
      !entry.page
    )
      return;
    entry.idle = setTimeout(() => {
      entry.idle = null;
      void this.serial(entry, async () => {
        if (!entry.users) await this.suspend(entry);
      }).catch(() => {
        /* Failed close retains the page and its capacity; explicit close can retry. */
      });
    }, 5 * 60_000);
    entry.idle.unref?.();
  }
  private serial<T>(entry: Entry<P>, task: () => Promise<T>): Promise<T> {
    const next = entry.queue.catch(() => {}).then(() => this.actor.runInAsyncScope(task));
    entry.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
  private async suspend(entry: Entry<P>) {
    if (!entry.page) return;
    await entry.page.close();
    entry.page = null;
    entry.tab = { ...entry.tab, state: "suspended", isLoading: false };
    this.clearIdle(entry);
    this.publish();
  }
  private async wake(entry: Entry<P>): Promise<P> {
    const next = this.openings
      .catch(() => {})
      .then(() =>
        this.actor.runInAsyncScope(async () => {
          if (this.closed || this.entries.get(entry.tab.browserId) !== entry)
            throw new Error("This Host Browser tab was closed.");
          if (entry.page && !entry.page.isClosed()) return entry.page;
          entry.page = null;
          const live = Array.from(this.entries.values()).filter(
            (candidate) => candidate.page && !candidate.page.isClosed(),
          );
          if (live.length >= 4) {
            const victim = live
              .filter((candidate) => !candidate.users)
              .toSorted((left, right) => left.touched - right.touched)[0];
            if (!victim)
              throw new Error(
                "Four Host Browser pages are in use. Close a viewer before opening another page.",
              );
            await this.suspend(victim);
          }
          try {
            entry.tab = { ...entry.tab, error: null };
            const page = await this.ports.open({ ...entry.tab });
            entry.page = page;
            if (this.closed) {
              await this.suspend(entry);
              throw new Error("Host Browser closed while the page was opening.");
            }
            entry.tab = { ...entry.tab, state: "ready" };
            this.publish();
            return page;
          } catch (error) {
            entry.tab = {
              ...entry.tab,
              state: "error",
              error:
                "The host could not open this page. Inspect the host browser runtime and explicitly reopen the tab.",
            };
            this.publish();
            throw error;
          }
        }),
      );
    this.openings = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
  /** A viewer holds this lease until hidden/disconnected; commands release it after their operation. */
  async acquire(workspaceId: string, browserId: string): Promise<{ page: P; release(): void }> {
    const entry = this.entry(workspaceId, browserId);
    entry.users++;
    this.clearIdle(entry);
    try {
      const page = await this.serial(entry, () => this.wake(entry));
      let active = true;
      return {
        page,
        release: () => {
          if (!active) return;
          active = false;
          entry.users--;
          entry.touched = this.now();
          this.idle(entry);
        },
      };
    } catch (error) {
      entry.users--;
      this.idle(entry);
      throw error;
    }
  }
  async use<T>(
    workspaceId: string,
    browserId: string,
    operation: (page: P) => Promise<T>,
  ): Promise<T> {
    const entry = this.entry(workspaceId, browserId);
    // Reserve demand before asynchronous admission, so another create cannot evict it.
    entry.users++;
    this.clearIdle(entry);
    try {
      return await this.serial(entry, async () => operation(await this.wake(entry)));
    } finally {
      entry.users--;
      entry.touched = this.now();
      this.idle(entry);
    }
  }
  async remove(workspaceId: string, browserId: string): Promise<void> {
    const entry = this.entry(workspaceId, browserId);
    await this.serial(entry, async () => {
      await this.suspend(entry);
      this.entries.delete(browserId);
      this.publish();
    });
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    for (const entry of this.entries.values()) this.clearIdle(entry);
    this.closing = this.shutdown();
    return this.closing;
  }
  private async shutdown() {
    try {
      await Promise.allSettled(Array.from(this.entries.values(), (entry) => entry.queue));
      await this.openings.catch(() => {});
      // Context ownership, not PID/port discovery, is the shutdown authority.
      await this.ports.close();
      this.entries.clear();
    } finally {
      this.actor.emitDestroy();
    }
  }
}
