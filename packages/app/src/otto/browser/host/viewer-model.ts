import type { BrowserPaintFrame } from "@getpaseo/protocol/otto/browser-frames";
import type { HostBrowserInput, HostBrowserTab } from "@getpaseo/plugin/otto/host-browser";
import { HostViewerInputQueue } from "./input-queue";

export interface HostViewerPort {
  ticket(): string;
  observe(
    ticket: string,
    observer: {
      paint(frame: BrowserPaintFrame): void;
      closed(reason?: "closed" | "error"): void;
    },
  ): () => void;
  watch(ticket: string): Promise<HostBrowserTab>;
  detach(ticket: string): Promise<void>;
  acknowledge(ticket: string, sequence: number): Promise<boolean>;
  input(ticket: string, event: HostBrowserInput): Promise<void>;
  update(tab: HostBrowserTab): void;
}
export interface HostViewerState {
  phase: "inactive" | "connecting" | "live" | "ended" | "error";
  frame: BrowserPaintFrame | null;
  error: string | null;
}
interface Opening {
  ticket: string;
  active: boolean;
  release(): void;
  input: HostViewerInputQueue;
  acknowledged: number;
}
/** Local paint/demand only. Canonical tab metadata belongs to Paseo's browser store. */
export class HostBrowserViewer {
  private state: HostViewerState = { phase: "inactive", frame: null, error: null };
  private listeners = new Set<() => void>();
  private opening: Opening | null = null;
  constructor(private readonly port: HostViewerPort) {}
  readonly getSnapshot = () => this.state;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: HostViewerState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  activate(): () => void {
    if (this.opening) throw new Error("This Host Browser viewer is already active.");
    const ticket = this.port.ticket();
    const opening: Opening = {
      ticket,
      active: true,
      release: () => {},
      acknowledged: 0,
      input: new HostViewerInputQueue(
        (event) => this.port.input(ticket, event),
        () =>
          this.fail(
            opening,
            "Host Browser input was interrupted. Reconnect the viewer before interacting again.",
          ),
      ),
    };
    this.opening = opening;
    this.publish({ phase: "connecting", frame: null, error: null });
    try {
      // The first paint may arrive before the JSON watch acknowledgment.
      opening.release = this.port.observe(ticket, {
        paint: (frame) => this.receive(opening, frame),
        closed: (reason) => {
          if (!opening.active) return;
          if (reason === "error")
            this.fail(opening, "Host Browser streaming ended. Reconnect the viewer explicitly.");
          else this.finish(opening, "ended", null);
        },
      });
      if (!opening.active) opening.release();
      else void this.watch(opening);
    } catch {
      this.fail(
        opening,
        "Host Browser streaming could not connect. Reconnect the viewer explicitly.",
      );
    }
    return () => {
      if (this.opening === opening) this.finish(opening, "inactive", null);
    };
  }
  private async watch(opening: Opening) {
    try {
      const tab = await this.port.watch(opening.ticket);
      if (opening.active) this.port.update(tab);
      else this.detach(opening.ticket);
    } catch {
      this.fail(
        opening,
        "The host could not open this viewer. Check its connection and reconnect explicitly.",
      );
    }
  }
  private detach(ticket: string) {
    // Best effort on the original source. Source teardown also revokes the lease;
    // never reconnect a socket or stop a host tab to repair a local viewer.
    void this.port.detach(ticket).catch(() => {});
  }
  private receive(opening: Opening, frame: BrowserPaintFrame) {
    if (
      !opening.active ||
      frame.ticket !== opening.ticket ||
      frame.sequence <= (this.state.frame?.sequence ?? 0)
    )
      return;
    this.publish({ phase: "live", frame, error: null });
  }
  /** A paint is acknowledged only after the image decoder reports it was displayed. */
  displayed(sequence: number) {
    const opening = this.opening;
    if (
      !opening?.active ||
      sequence !== this.state.frame?.sequence ||
      sequence <= opening.acknowledged
    )
      return;
    opening.acknowledged = sequence;
    void this.port
      .acknowledge(opening.ticket, sequence)
      .then((accepted) => {
        if (!accepted)
          this.fail(opening, "The host released this viewer. Reconnect it explicitly.");
        return;
      })
      .catch(() =>
        this.fail(opening, "The viewer lost its host connection. Reconnect it explicitly."),
      );
  }
  decodeFailed(sequence: number) {
    if (sequence === this.state.frame?.sequence && this.opening)
      this.fail(
        this.opening,
        "The host image could not be displayed. Reconnect the viewer explicitly.",
      );
  }
  input(event: HostBrowserInput) {
    if (this.state.phase === "live") this.opening?.input.push(event);
  }
  async type(text: string): Promise<boolean> {
    const opening = this.opening;
    if (!opening?.active || this.state.phase !== "live" || text.length > 16384) return false;
    if (text) return opening.input.acknowledged({ kind: "text", text });
    if (!(await opening.input.acknowledged({ kind: "key", phase: "down", key: "Enter" })))
      return false;
    return opening.input.acknowledged({ kind: "key", phase: "up", key: "Enter" });
  }
  private fail(opening: Opening, error: string) {
    if (opening.active) this.finish(opening, "error", error);
  }
  private finish(opening: Opening, phase: HostViewerState["phase"], error: string | null) {
    if (!opening.active) return;
    opening.active = false;
    opening.input.close();
    opening.release();
    this.detach(opening.ticket);
    if (this.opening === opening) {
      this.opening = null;
      this.publish({ phase, frame: null, error });
    }
  }
}
