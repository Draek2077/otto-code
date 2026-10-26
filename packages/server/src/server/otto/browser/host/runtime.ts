import path from "node:path";
import { chromium, type BrowserContext, type CDPSession, type Page } from "playwright-core";
import { z } from "zod";
import { BrowserPaintPump, type PaintSink } from "../paint-pump.js";
import { OTTO_BROWSER_FRAME_MAX_JPEG_BYTES } from "@getpaseo/protocol/otto/browser-frames";
import { HostBrowserTelemetry } from "./telemetry.js";
import { resolveHostBrowser } from "./runtime-paths.js";
import type { HostTab } from "./pages.js";
import { createHostBrowserInputs } from "./input.js";
import type { HostBrowserInputs } from "./input-state.js";
import { hostBrowserDeadline } from "./deadline.js";
const paintSchema = z.object({
  data: z.string().max(Math.ceil(OTTO_BROWSER_FRAME_MAX_JPEG_BYTES / 3) * 4),
  sessionId: z.number().int().nonnegative(),
});
export class ManagedHostPage {
  readonly telemetry: HostBrowserTelemetry;
  readonly paint: BrowserPaintPump;
  readonly inputs: HostBrowserInputs;
  private capturing = false;
  private demand = false;
  private captureQueue: Promise<void> = Promise.resolve();
  private closed = false;
  private blocked = false;
  private closing: Promise<void> | null = null;
  lastNavigationError: string | null = null;
  constructor(
    readonly page: Page,
    readonly cdp: CDPSession,
  ) {
    this.telemetry = new HostBrowserTelemetry(page);
    this.inputs = createHostBrowserInputs(page, cdp);
    this.paint = new BrowserPaintPump({
      ack: (sessionId) => {
        void cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
      },
      demand: (active) => this.setCaptureDemand(active),
    });
    cdp.on("Page.screencastFrame", (value: unknown) => {
      const frame = paintSchema.safeParse(value),
        viewport = page.viewportSize();
      if (!frame.success || !viewport) {
        this.paint.close(
          "The host paint exceeded its stream budget. Reduce the viewport and reopen the tab.",
        );
        return;
      }
      this.paint.receive({
        sessionId: frame.data.sessionId,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        jpeg: Buffer.from(frame.data.data, "base64"),
      });
    });
    page.on("close", () => this.paint.close());
    page.on("crash", () =>
      this.paint.close("The Host Browser page crashed. Reopen this tab explicitly."),
    );
  }
  watch(sink: PaintSink) {
    this.assertUsable();
    if (this.closing || this.isClosed()) throw new Error("The Host Browser page is closing.");
    const release = this.paint.watch(sink);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      release();
      void hostBrowserDeadline(
        () => this.inputs.release(sink.ticket),
        () => this.close(),
        10_000,
      ).catch(() => {
        this.lastNavigationError =
          "The viewer's native input could not be released. Close this tab and reopen it explicitly.";
        void this.close().catch(() => {});
      });
    };
  }
  private setCaptureDemand(active: boolean) {
    this.demand = active;
    this.captureQueue = this.captureQueue
      .catch(() => {})
      .then(async () => {
        if (this.closed || this.capturing === this.demand) return;
        const requested = this.demand;
        await this.cdp.send(
          requested ? "Page.startScreencast" : "Page.stopScreencast",
          requested
            ? { format: "jpeg", quality: 60, maxWidth: 1568, maxHeight: 1568, everyNthFrame: 1 }
            : {},
        );
        this.capturing = requested;
        return;
      })
      .catch(() => {
        this.paint.close("Host Browser streaming could not start. Reopen this tab explicitly.");
      });
  }
  isClosed() {
    return this.closed || this.page.isClosed();
  }
  assertUsable() {
    if (this.blocked || this.isClosed())
      throw new Error(
        "This Host Browser page was closed or quarantined. Close its tab and reopen it explicitly.",
      );
  }
  async navigate(url: string) {
    this.lastNavigationError = null;
    try {
      await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
    } catch (error) {
      this.lastNavigationError =
        "This page could not be reached. Check its address and the host's network connection.";
      throw error;
    }
  }
  close(): Promise<void> {
    this.blocked = true;
    if (this.closed) return Promise.resolve();
    if (this.closing) return this.closing;
    this.closing = this.closePage().catch((error: unknown) => {
      this.closing = null;
      throw error;
    });
    return this.closing;
  }
  private async closePage() {
    this.inputs.close();
    this.paint.close();
    // Closing an owned target must not wait behind a hung renderer/CDP screencast command.
    // The capture queue already handles its rejection when the target is destroyed.
    await this.page.close();
    this.closed = true;
  }
}
/** Created at daemon composition, but profile/process ownership starts only on explicit page admission. */
export class HostBrowserRuntime {
  private context: BrowserContext | null = null;
  constructor(
    private readonly home: string,
    private readonly changed: (tab: HostTab, page: Page, error: string | null) => void,
    private readonly runtimeState?: (state: "started" | "closed") => void,
  ) {}
  private async getContext(): Promise<BrowserContext> {
    if (this.context) return this.context;
    const executablePath = await resolveHostBrowser();
    const context = await chromium.launchPersistentContext(
      path.join(this.home, "browser-profile"),
      {
        executablePath,
        headless: true,
        timeout: 15_000,
        viewport: { width: 390, height: 844 },
        acceptDownloads: false,
        args: [
          "--disable-dev-shm-usage",
          "--no-default-browser-check",
          ...(process.platform === "linux"
            ? ["--ozone-platform=headless", "--use-angle=swiftshader"]
            : []),
        ],
      },
    );
    this.context = context;
    this.reportState("started");
    context.setDefaultTimeout(10_000);
    context.on("close", () => {
      if (this.context === context) this.context = null;
      this.reportState("closed");
    });
    // Chromium clears session data when its final profile window closes, even while
    // CDP keeps the browser process alive. Keep one unexposed about:blank target for
    // this runtime's session; closing/suspending the final user tab must not sign out
    // every other tab opened later. The context owns and closes this blank target.
    // https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/sessions/session_service.cc
    const restored = context.pages();
    await context.newPage();
    for (const page of restored) await page.close();
    return context;
  }
  private reportState(state: "started" | "closed") {
    try {
      this.runtimeState?.(state);
    } catch {
      /* Diagnostics cannot alter runtime ownership. */
    }
  }
  async open(tab: HostTab): Promise<ManagedHostPage> {
    const context = await this.getContext(),
      page = await context.newPage();
    try {
      await page.setViewportSize({ width: tab.viewportWidth, height: tab.viewportHeight });
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 10 });
      const managed = new ManagedHostPage(page, cdp);
      const update = () => {
        this.changed(tab, page, managed.lastNavigationError);
      };
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) update();
      });
      page.on("load", update);
      page.on("domcontentloaded", update);
      await managed.navigate(tab.url).catch(() => {});
      update();
      return managed;
    } catch (error) {
      await page.close().catch(() => {});
      throw error;
    }
  }
  async close() {
    const context = this.context;
    await context?.close();
    if (this.context === context) this.context = null;
  }
}
