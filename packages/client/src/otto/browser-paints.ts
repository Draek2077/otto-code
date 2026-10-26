import {
  decodeBrowserPaintFrame,
  decodeBrowserPaintEnd,
  isBrowserPaintTicket,
  OTTO_BROWSER_FRAME_OPCODE,
  type BrowserPaintFrame,
} from "@getpaseo/protocol/otto/browser-frames";
export interface BrowserPaintObserver {
  paint(frame: BrowserPaintFrame): void;
  closed(reason?: "closed" | "error"): void;
}
interface Viewer {
  observer: BrowserPaintObserver;
  sequence: number;
}
/** Local demand only. A ticket is registered before its owning RPC; unknown/old tickets cannot fan out. */
export class BrowserPaintSubscriptions {
  private readonly viewers = new Map<string, Viewer>();
  private closing = false;
  observe(ticket: string, observer: BrowserPaintObserver): () => void {
    if (this.closing) throw new Error("The Host Browser source is closing.");
    if (!isBrowserPaintTicket(ticket)) throw new Error("Invalid Host Browser paint ticket.");
    const key = ticket.toLowerCase();
    if (this.viewers.has(key))
      throw new Error("This Host Browser paint ticket is already registered.");
    if (this.viewers.size >= 16) throw new Error("Too many active Host Browser paint viewers.");
    const viewer = { observer, sequence: 0 };
    this.viewers.set(key, viewer);
    return () => {
      if (this.viewers.get(key) === viewer) this.viewers.delete(key);
    };
  }
  handle(bytes: Uint8Array): boolean {
    if (bytes[0] !== OTTO_BROWSER_FRAME_OPCODE) return false;
    const end = decodeBrowserPaintEnd(bytes);
    if (end) {
      const viewer = this.viewers.get(end.ticket);
      if (viewer) this.closeViewer(end.ticket, viewer, end.reason);
      return true;
    }
    const frame = decodeBrowserPaintFrame(bytes);
    if (!frame) return true;
    const viewer = this.viewers.get(frame.ticket);
    if (!viewer || frame.sequence <= viewer.sequence) return true;
    viewer.sequence = frame.sequence;
    try {
      viewer.observer.paint(frame);
    } catch {
      this.closeViewer(frame.ticket, viewer);
    }
    return true;
  }
  private closeViewer(ticket: string, viewer: Viewer, reason?: "closed" | "error") {
    if (this.viewers.get(ticket) !== viewer) return;
    this.viewers.delete(ticket);
    try {
      viewer.observer.closed(reason);
    } catch {
      /* One observer cannot break the connection's other domains. */
    }
  }
  disconnected(): void {
    if (this.closing) return;
    this.closing = true;
    try {
      for (const [ticket, viewer] of Array.from(this.viewers)) this.closeViewer(ticket, viewer);
    } finally {
      this.closing = false;
    }
  }
}
