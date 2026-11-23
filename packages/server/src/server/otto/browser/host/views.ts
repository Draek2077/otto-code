import {
  encodeBrowserPaintEnd,
  encodeBrowserPaintFrame,
  isBrowserPaintTicket,
} from "@getpaseo/protocol/otto/browser-frames";
import type { OwnedBinaryOperation } from "../../../session/owned-subscriptions/index.js";
import type { HostBrowserPages, HostPage } from "./pages.js";
import type { BrowserPaintPump, PaintSink } from "../paint-pump.js";
export interface HostBrowserSource {
  readonly source: object;
  retainBinary(stop: () => void): OwnedBinaryOperation;
}
export interface HostCapturePage extends HostPage {
  readonly paint: Pick<BrowserPaintPump, "acknowledge" | "input">;
  watch(sink: PaintSink): () => void;
}
interface View<P> {
  source: object;
  workspaceId: string;
  browserId: string;
  owner: OwnedBinaryOperation;
  page: P | null;
  releaseCapture(): void;
  releasePage(): void;
}
/** Authenticated request source, never appId, is the authority to ack or detach a viewer. */
export class HostBrowserViews<P extends HostCapturePage> {
  private readonly views = new Map<string, View<P>>();
  constructor(
    private readonly pages: HostBrowserPages<P>,
    private readonly validateWorkspace: (workspaceId: string) => Promise<void>,
  ) {}
  async watch(
    input: { workspaceId: string; browserId: string; ticket: string },
    source: HostBrowserSource,
  ): Promise<void> {
    const ticket = input.ticket.toLowerCase();
    if (!isBrowserPaintTicket(ticket) || this.views.has(ticket) || this.views.size >= 128)
      throw new Error("This Host Browser viewer cannot be admitted.");
    // Validate ownership before retaining a source or starting any page work.
    this.pages.get(input.workspaceId, input.browserId);
    const view: View<P> = {
      ...input,
      source: source.source,
      owner: source.retainBinary(() => {
        view.releaseCapture();
        view.releasePage();
        view.page = null;
        if (this.views.get(ticket) === view) this.views.delete(ticket);
      }),
      page: null,
      releaseCapture: () => {},
      releasePage: () => {},
    };
    this.views.set(ticket, view);
    try {
      // Reserve the source-owned ticket before asynchronous registry checks. A hidden
      // viewer can detach during that wait, without creating a cancellation tombstone.
      await this.validateWorkspace(input.workspaceId);
      if (view.owner.signal.aborted)
        throw new Error("The Host Browser viewer was released while opening.");
      const lease = await this.pages.acquire(input.workspaceId, input.browserId);
      view.releasePage = lease.release;
      view.page = lease.page;
      if (view.owner.signal.aborted) {
        lease.release();
        throw new Error("The Host Browser viewer disconnected while opening.");
      }
      view.releaseCapture = lease.page.watch({
        ticket,
        paint: (frame) => view.owner.emitBinary(encodeBrowserPaintFrame(frame)),
        closed: () => {
          view.owner.emitBinary(encodeBrowserPaintEnd({ ticket, reason: "error" }));
          void view.owner.release();
        },
      });
      // A cached frame's observer can close synchronously while watch is being registered.
      if (view.owner.signal.aborted) {
        view.releaseCapture();
        lease.release();
      }
    } catch (error) {
      await view.owner.release();
      throw error;
    }
  }
  private owned(ticket: string, source: HostBrowserSource, workspaceId: string): View<P> | null {
    const view = this.views.get(ticket.toLowerCase());
    return view?.source === source.source &&
      view.workspaceId === workspaceId &&
      !view.owner.signal.aborted
      ? view
      : null;
  }
  acknowledge(
    ticket: string,
    sequence: number,
    source: HostBrowserSource,
    workspaceId: string,
  ): boolean {
    const view = this.owned(ticket, source, workspaceId);
    return view?.page?.paint.acknowledge(ticket, sequence) ?? false;
  }
  async detach(ticket: string, source: HostBrowserSource, workspaceId: string): Promise<void> {
    await this.owned(ticket, source, workspaceId)?.owner.release();
  }
  async input<T>(
    ticket: string,
    source: HostBrowserSource,
    operation: (page: P) => Promise<T>,
    workspaceId: string,
  ): Promise<T> {
    const view = this.owned(ticket, source, workspaceId);
    if (!view?.page) throw new Error("This input does not own a live Host Browser viewer.");
    // UI input must remain usable while an agent is waiting for page text or navigation.
    // The retained page lease prevents suspension; this source check is the input authority.
    view.page.paint.input();
    return operation(view.page);
  }
  async close() {
    await Promise.all(Array.from(this.views.values(), (view) => view.owner.release()));
  }
}
