import type { HostBrowserInput } from "@getpaseo/plugin/otto/host-browser";

function combine(previous: HostBrowserInput, next: HostBrowserInput): HostBrowserInput | null {
  if (previous.kind === "wheel" && next.kind === "wheel")
    return {
      ...next,
      deltaX: Math.max(-100000, Math.min(100000, previous.deltaX + next.deltaX)),
      deltaY: Math.max(-100000, Math.min(100000, previous.deltaY + next.deltaY)),
    };
  if (previous.kind === next.kind && previous.kind === "pointer" && next.kind === "pointer")
    return previous.phase === "move" && next.phase === "move" ? next : null;
  if (previous.kind === "touch" && next.kind === "touch")
    return previous.phase === "move" && next.phase === "move" ? next : null;
  return null;
}

/** Ordered discrete input, latest adjacent motion. A viewer owns this queue, never the host page. */
export class HostViewerInputQueue {
  private pending: Array<{ event: HostBrowserInput; done?: (accepted: boolean) => void }> = [];
  private current: { event: HostBrowserInput; done?: (accepted: boolean) => void } | null = null;
  private running = false;
  private closed = false;
  constructor(
    private readonly send: (event: HostBrowserInput) => Promise<void>,
    private readonly failed: () => void,
  ) {}
  push(event: HostBrowserInput) {
    this.append(event);
  }
  acknowledged(event: HostBrowserInput): Promise<boolean> {
    return new Promise((resolve) => this.append(event, resolve));
  }
  private append(event: HostBrowserInput, done?: (accepted: boolean) => void) {
    if (this.closed) {
      done?.(false);
      return;
    }
    const previous = this.pending.at(-1),
      merged = previous && !previous.done && !done && combine(previous.event, event);
    if (merged) previous.event = merged;
    else {
      if (this.pending.length >= 64) {
        done?.(false);
        this.fail();
        return;
      }
      this.pending.push({ event, done });
    }
    void this.drain();
  }
  private async drain() {
    if (this.running || this.closed) return;
    this.running = true;
    try {
      while (!this.closed && this.pending.length) {
        const entry = this.pending.shift();
        if (!entry) continue;
        this.current = entry;
        await this.send(entry.event);
        this.complete(entry, !this.closed);
        this.current = null;
      }
    } catch {
      if (!this.closed) this.fail();
    } finally {
      this.running = false;
    }
  }
  private fail() {
    this.close();
    this.failed();
  }
  close() {
    this.closed = true;
    if (this.current) this.complete(this.current, false);
    for (const entry of this.pending) this.complete(entry, false);
    this.pending = [];
  }
  private complete(entry: { done?: (accepted: boolean) => void }, accepted: boolean) {
    const done = entry.done;
    entry.done = undefined;
    done?.(accepted);
  }
}
