import { createHash } from "node:crypto";
import {
  isBrowserPaintTicket,
  OTTO_BROWSER_FRAME_MAX_JPEG_BYTES,
  OTTO_BROWSER_FRAME_HEADER_BYTES,
  type BrowserPaintFrame,
} from "@getpaseo/protocol/otto/browser-frames";
export interface HostPaint {
  sessionId: number;
  viewportWidth: number;
  viewportHeight: number;
  jpeg: Uint8Array;
}
export interface PaintSink {
  ticket: string;
  paint(frame: BrowserPaintFrame): void;
  closed(message: string): void;
}
interface Viewer {
  sink: PaintSink;
  pending: number | null;
  digest: string | null;
}
/** Paint-driven, one retained JPEG, one unacknowledged packet per viewer. No polling or capture on construction. */
export class BrowserPaintPump {
  private readonly viewers = new Map<string, Viewer>();
  private readonly heldSessions = new Set<number>();
  private latest: HostPaint | null = null;
  private digest: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sequence = 0;
  private lastAt = 0;
  private lastBytes = 0;
  private interactiveUntil = 0;
  private closed = false;
  constructor(
    private readonly ports: {
      ack(sessionId: number): void;
      demand(active: boolean): void;
      now?: () => number;
    },
  ) {}
  private now() {
    return this.ports.now?.() ?? Date.now();
  }
  watch(sink: PaintSink): () => void {
    if (this.closed || !isBrowserPaintTicket(sink.ticket))
      throw new Error("This paint viewer cannot be admitted.");
    const ticket = sink.ticket.toLowerCase();
    if (this.viewers.has(ticket) || this.viewers.size >= 16)
      throw new Error("This paint viewer is already active or the viewer limit is reached.");
    const viewer = { sink: { ...sink, ticket }, pending: null, digest: null };
    this.viewers.set(ticket, viewer);
    if (this.viewers.size === 1) this.ports.demand(true);
    this.schedule();
    return () => {
      if (this.viewers.get(ticket) !== viewer) return;
      this.viewers.delete(ticket);
      if (!this.viewers.size) this.pause();
      else this.schedule();
    };
  }
  receive(frame: HostPaint): void {
    if (this.closed || !this.viewers.size) {
      this.ports.ack(frame.sessionId);
      return;
    }
    if (
      frame.jpeg.length < 4 ||
      frame.jpeg.length > OTTO_BROWSER_FRAME_MAX_JPEG_BYTES ||
      !Number.isInteger(frame.sessionId) ||
      frame.sessionId < 0
    ) {
      this.ports.ack(frame.sessionId);
      this.close(
        "The host paint exceeded its stream budget. Reopen the viewer after reducing its viewport.",
      );
      return;
    }
    if (this.heldSessions.size >= 8 && !this.heldSessions.has(frame.sessionId)) {
      this.ports.ack(frame.sessionId);
      this.close("The browser sent too many unacknowledged paints. Reopen the viewer.");
      return;
    }
    this.heldSessions.add(frame.sessionId);
    this.latest = frame;
    this.digest = createHash("sha256")
      .update(`${frame.viewportWidth}/${frame.viewportHeight}\0`)
      .update(frame.jpeg)
      .digest("hex");
    this.schedule();
  }
  acknowledge(ticket: string, sequence: number): boolean {
    const viewer = this.viewers.get(ticket.toLowerCase());
    if (!viewer || viewer.pending !== sequence) return false;
    viewer.pending = null;
    this.schedule();
    return true;
  }
  input(): void {
    this.interactiveUntil = this.now() + 1200;
    // Input releases captured Chrome backpressure so the next paint reflects that action.
    this.ackHeld();
    this.schedule();
  }
  private ackHeld() {
    for (const id of this.heldSessions) this.ports.ack(id);
    this.heldSessions.clear();
  }
  private clearTimer() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
  private schedule() {
    this.clearTimer();
    if (!this.latest || !this.viewers.size || this.closed) return;
    const ready = Array.from(this.viewers.values()).some((viewer) => viewer.pending === null);
    if (!ready) return;
    const now = this.now(),
      bytesPerSecond = now < this.interactiveUntil ? 300 * 1024 : 40 * 1024;
    const delay = Math.max(0, this.lastAt + (this.lastBytes / bytesPerSecond) * 1000 - now);
    if (delay > 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.schedule();
      }, Math.ceil(delay));
      this.timer.unref?.();
      return;
    }
    this.flush();
  }
  private flush() {
    const frame = this.latest;
    if (!frame || !this.digest) return;
    const ready = Array.from(this.viewers.values()).filter(
      (viewer) => viewer.pending === null && viewer.digest !== this.digest,
    );
    const hadCapture = this.heldSessions.size > 0;
    if (!ready.length && !hadCapture) return;
    this.sequence = this.sequence >= 0xffffffff ? 1 : this.sequence + 1;
    for (const viewer of ready) {
      viewer.pending = this.sequence;
      viewer.digest = this.digest;
      try {
        viewer.sink.paint({
          ticket: viewer.sink.ticket,
          sequence: this.sequence,
          viewportWidth: frame.viewportWidth,
          viewportHeight: frame.viewportHeight,
          jpeg: frame.jpeg,
        });
      } catch {
        this.viewers.delete(viewer.sink.ticket);
        this.notify(viewer, "This paint viewer could not receive its frame.");
      }
    }
    this.lastAt = this.now();
    this.lastBytes =
      (frame.jpeg.length + OTTO_BROWSER_FRAME_HEADER_BYTES) * Math.max(1, ready.length);
    this.ackHeld();
    if (!this.viewers.size) this.pause();
  }
  private notify(viewer: Viewer, message: string) {
    try {
      viewer.sink.closed(message);
    } catch {
      /* One source cannot break another viewer's teardown. */
    }
  }
  private pause() {
    this.clearTimer();
    this.latest = null;
    this.digest = null;
    this.lastBytes = 0;
    this.ackHeld();
    this.ports.demand(false);
  }
  close(message = "Host Browser streaming ended."): void {
    if (this.closed) return;
    this.closed = true;
    const viewers = Array.from(this.viewers.values());
    this.viewers.clear();
    this.pause();
    for (const viewer of viewers) this.notify(viewer, message);
  }
}
