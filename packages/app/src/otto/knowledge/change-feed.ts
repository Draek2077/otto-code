/** One active long-poll lease per canonical host/project in an installation.
 * A heartbeat does not invalidate data; only an actual cursor change does. */
export class KnowledgeChangeFeed {
  private listeners = new Set<() => void>();
  private error: string | null = null;
  private session: { id: string; active: boolean } | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private readonly ports: {
      wait(
        leaseId: string,
        cursor: string | null,
      ): Promise<{ cursor: string; error: string | null }>;
      release(leaseId: string): Promise<void>;
      changed(): void;
      unused(): void;
      makeId?: () => string;
    },
  ) {}
  getSnapshot = () => this.error;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  retain(): () => void {
    this.demand++;
    if (this.demand === 1) this.open();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.demand) return;
      if (this.retry) clearTimeout(this.retry);
      this.retry = null;
      if (this.session) {
        this.session.active = false;
        void this.release(this.session.id);
      }
      this.session = null;
      this.ports.unused();
    };
  }
  private demand = 0;
  private publish(error: string | null) {
    if (this.error === error) return;
    this.error = error;
    for (const listener of this.listeners) listener();
  }
  private open() {
    const session = {
      id: (this.ports.makeId ?? (() => globalThis.crypto.randomUUID()))(),
      active: true,
    };
    this.session = session;
    void this.follow(session);
  }
  private async follow(session: { id: string; active: boolean }) {
    let cursor: string | null = null;
    try {
      while (session.active) {
        const next = await this.ports.wait(session.id, cursor);
        if (!session.active) return;
        if (next.error) throw new Error(next.error);
        this.publish(null);
        // The initial cursor also refreshes cached data after reactivation.
        if (next.cursor !== cursor) this.ports.changed();
        cursor = next.cursor;
      }
    } catch {
      if (session.active)
        this.publish(
          "Live Knowledge refresh is disconnected. You can refresh manually while Otto reconnects.",
        );
    } finally {
      // Release again after a late wait admission; an earlier release may have
      // arrived before the daemon resolved the project. Release is idempotent.
      await this.release(session.id);
      if (this.session === session && session.active && this.demand)
        this.retry = setTimeout(() => {
          this.retry = null;
          this.open();
        }, 3000);
    }
  }
  private async release(id: string) {
    try {
      await this.ports.release(id);
    } catch {
      /* Paired-session disconnect and the daemon TTL also release demand. */
    }
  }
}
