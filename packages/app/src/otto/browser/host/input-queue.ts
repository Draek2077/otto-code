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
  private pending: HostBrowserInput[] = [];
  private running = false;
  private closed = false;
  constructor(
    private readonly send: (event: HostBrowserInput) => Promise<void>,
    private readonly failed: () => void,
  ) {}
  push(event: HostBrowserInput) {
    if (this.closed) return;
    const previous = this.pending.at(-1),
      merged = previous && combine(previous, event);
    if (merged) this.pending[this.pending.length - 1] = merged;
    else {
      if (this.pending.length >= 64) {
        this.fail();
        return;
      }
      this.pending.push(event);
    }
    void this.drain();
  }
  private async drain() {
    if (this.running || this.closed) return;
    this.running = true;
    try {
      while (!this.closed && this.pending.length) {
        const event = this.pending.shift();
        if (event) await this.send(event);
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
    this.pending = [];
  }
}
