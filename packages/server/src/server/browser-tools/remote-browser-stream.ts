import { createHash } from "node:crypto";
import type { CDPSession, Page } from "playwright";

// JSON/base64 plus relay encryption must fit Cloudflare's 1 MiB WebSocket frame.
const MAX_FRAME_BYTES = 650_000;
const JPEG_QUALITIES = [55, 35, 20, 10];
const MAX_WAIT_MS = 10_000;
// Chromium sends the next pushed frame only after the last one is acknowledged,
// so the acknowledgement delay is the frame rate cap.
const ACTIVE_FRAME_MS = 66;
const IDLE_FRAME_MS = 250;
const ACTIVE_WINDOW_MS = 1_200;
// A page that never stops moving is held to a byte rate, not a frame rate: a
// large frame waits longer than a small one. Measured with
// `npm run measure:hosted-browser`; see docs/preview.md before changing these.
const ACTIVE_BYTES_PER_SECOND = 300_000;
const IDLE_BYTES_PER_SECOND = 40_000;
// With nobody asking for frames the page is left to idle.
const VIEWER_IDLE_MS = 5_000;
const FIRST_PUSH_WAIT_MS = 300;
// Screenshot pacing, used only where Chromium cannot push frames.
const FALLBACK_FRAME_MS = 700;
const FALLBACK_ACTIVE_FRAME_MS = 150;

interface Size {
  width: number;
  height: number;
}

export interface StreamFrame {
  image: Buffer;
  width: number;
  height: number;
  revision: number;
}

export interface StreamStats {
  /** Screenshots taken because no pushed frame was available. */
  captures: number;
  /** Frames Chromium pushed after a repaint. */
  pushed: number;
  /** Frames dropped because they matched the one before. */
  unchanged: number;
  framesSent: number;
  bytesSent: number;
}

/**
 * One tab's frame source. Chromium pushes a frame when the page repaints; a
 * still page therefore costs nothing, and a request can wait for the next
 * repaint instead of asking again.
 */
export class TabStream {
  private page: Page | null = null;
  private frame: Buffer | null = null;
  private hash = "";
  private revision = 0;
  private stale = true;
  private lastFrameAt = 0;
  private lastInputAt = 0;
  private viewerSeenAt = 0;
  // Base64 makes the wire a third larger than the frame; binary does not.
  private wireScale = 4 / 3;
  private session: CDPSession | null = null;
  private starting: Promise<void> | null = null;
  private pushUnavailable = false;
  private qualityIndex = 0;
  private capturing: Promise<void> | null = null;
  private acknowledge: (() => void) | null = null;
  private readonly waiters = new Set<() => void>();
  private readonly counters: StreamStats = {
    captures: 0,
    pushed: 0,
    unchanged: 0,
    framesSent: 0,
    bytesSent: 0,
  };

  attach(page: Page): void {
    this.page = page;
    this.stale = true;
  }

  async detach(): Promise<void> {
    this.page = null;
    this.frame = null;
    this.hash = "";
    this.stale = true;
    await this.stopPush();
    this.release();
  }

  /** The user acted on the page, so the next frames should arrive quickly. */
  noteInput(): void {
    this.lastInputAt = Date.now();
    this.acknowledge?.();
  }

  /** The page may look different. A pushing page reports that itself. */
  invalidate(): void {
    if (!this.session) this.stale = true;
  }

  /** The viewport changed, so pushed frames must be resized. */
  async resize(): Promise<void> {
    this.stale = true;
    this.qualityIndex = 0;
    await this.stopPush();
  }

  stats(): StreamStats {
    return { ...this.counters };
  }

  async next(input: {
    size: Size;
    knownRevision: number | undefined;
    waitMs: number | undefined;
    /** The viewer takes bytes, so the wire carries no base64 overhead. */
    binary: boolean;
  }): Promise<StreamFrame | undefined> {
    const page = this.page;
    if (!page) return undefined;
    this.viewerSeenAt = Date.now();
    this.wireScale = input.binary ? 1 : 4 / 3;
    await this.ensurePush(page, input.size);

    if (this.session) {
      if (!this.frame || this.stale) await this.waitForFrame(FIRST_PUSH_WAIT_MS);
      if (!this.frame || this.stale) await this.capture(page);
      if (input.knownRevision === this.revision && input.waitMs)
        await this.waitForFrame(Math.min(input.waitMs, MAX_WAIT_MS));
    } else {
      const interval = this.isActive() ? FALLBACK_ACTIVE_FRAME_MS : FALLBACK_FRAME_MS;
      if (!this.frame || this.stale || Date.now() - this.lastFrameAt >= interval)
        await this.capture(page);
    }

    if (!this.frame || input.knownRevision === this.revision) return undefined;
    this.counters.framesSent++;
    this.counters.bytesSent += Math.round(this.frame.length * this.wireScale);
    return {
      image: this.frame,
      width: input.size.width,
      height: input.size.height,
      revision: this.revision,
    };
  }

  private frameIntervalMs(frameBytes: number): number {
    const active = this.isActive();
    const wireBytes = frameBytes * this.wireScale;
    const budget = active ? ACTIVE_BYTES_PER_SECOND : IDLE_BYTES_PER_SECOND;
    return Math.max(active ? ACTIVE_FRAME_MS : IDLE_FRAME_MS, (wireBytes / budget) * 1_000);
  }

  private isActive(): boolean {
    return Date.now() - this.lastInputAt < ACTIVE_WINDOW_MS;
  }

  private accept(buffer: Buffer): void {
    this.lastFrameAt = Date.now();
    this.stale = false;
    const hash = createHash("sha1").update(buffer).digest("base64");
    if (this.frame && hash === this.hash) {
      this.counters.unchanged++;
      return;
    }
    this.hash = hash;
    this.frame = buffer;
    this.revision++;
    this.release();
  }

  private release(): void {
    const waiters = [...this.waiters];
    this.waiters.clear();
    for (const waiter of waiters) waiter();
  }

  private async waitForFrame(ms: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let waiter: (() => void) | undefined;
    const changed = new Promise<void>((resolve) => {
      waiter = resolve;
      this.waiters.add(resolve);
    });
    const expired = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    });
    await Promise.race([changed, expired]);
    clearTimeout(timer);
    if (waiter) this.waiters.delete(waiter);
  }

  private capture(page: Page): Promise<void> {
    this.capturing ??= this.screenshot(page).finally(() => {
      this.capturing = null;
    });
    return this.capturing;
  }

  private async screenshot(page: Page): Promise<void> {
    for (const quality of JPEG_QUALITIES) {
      this.counters.captures++;
      // Animations stay live so the stream shows what the page shows.
      const buffer = await page.screenshot({ type: "jpeg", quality, timeout: 10_000 });
      if (buffer.length <= MAX_FRAME_BYTES) {
        this.accept(buffer);
        return;
      }
    }
    throw new Error("Page frame exceeds the mobile transfer limit. Try a smaller viewport.");
  }

  private async ensurePush(page: Page, size: Size): Promise<void> {
    if (this.pushUnavailable || this.session) return;
    this.starting ??= this.startPush(page, size)
      .catch(() => {
        // Screenshots still work where this Chromium cannot screencast.
        this.pushUnavailable = true;
      })
      .finally(() => {
        this.starting = null;
      });
    await this.starting;
  }

  private async startPush(page: Page, size: Size): Promise<void> {
    const session = await page.context().newCDPSession(page);
    session.on("Page.screencastFrame", (event) => {
      if (this.session !== session) return;
      this.counters.pushed++;
      const buffer = Buffer.from(event.data, "base64");
      if (buffer.length > MAX_FRAME_BYTES) {
        if (this.qualityIndex < JPEG_QUALITIES.length - 1) this.qualityIndex++;
        void this.stopPush();
        return;
      }
      this.accept(buffer);
      if (Date.now() - this.viewerSeenAt > VIEWER_IDLE_MS) {
        this.stale = true;
        void this.stopPush();
        return;
      }
      const acknowledge = () => {
        if (this.acknowledge !== acknowledge) return;
        this.acknowledge = null;
        clearTimeout(timer);
        void session
          .send("Page.screencastFrameAck", { sessionId: event.sessionId })
          .catch(() => undefined);
      };
      const timer = setTimeout(acknowledge, this.frameIntervalMs(buffer.length));
      this.acknowledge = acknowledge;
    });
    this.session = session;
    try {
      await session.send("Page.startScreencast", {
        format: "jpeg",
        quality: JPEG_QUALITIES[this.qualityIndex],
        maxWidth: size.width,
        maxHeight: size.height,
        everyNthFrame: 1,
      });
    } catch (cause) {
      this.session = null;
      await session.detach().catch(() => undefined);
      throw cause;
    }
  }

  private async stopPush(): Promise<void> {
    const session = this.session;
    this.session = null;
    this.acknowledge = null;
    if (!session) return;
    await session.send("Page.stopScreencast").catch(() => undefined);
    await session.detach().catch(() => undefined);
  }
}
