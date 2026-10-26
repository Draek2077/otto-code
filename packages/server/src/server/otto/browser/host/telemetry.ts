import type { Page, Request, ConsoleMessage, Dialog, Download } from "playwright-core";
import { BrowserAutomationDialogEventSchema } from "@getpaseo/protocol/browser-automation/rpc-schemas";
import type {
  BrowserAutomationConsoleLogEntry,
  BrowserAutomationNetworkLogEntry,
  BrowserAutomationDialogEvent,
} from "@getpaseo/protocol/browser-automation/rpc-schemas";
interface HostTelemetryEvents {
  on(event: "console", listener: (message: ConsoleMessage) => void): unknown;
  on(event: "pageerror", listener: (error: Error) => void): unknown;
  on(
    event: "request" | "requestfinished" | "requestfailed",
    listener: (request: Request) => void,
  ): unknown;
  on(event: "dialog", listener: (dialog: Dialog) => void): unknown;
  on(event: "popup", listener: (popup: Page) => void): unknown;
  on(event: "download", listener: (download: Download) => void): unknown;
}
/** Bounded metadata only; no retained Playwright response bodies or request objects. */
export class HostBrowserTelemetry {
  private readonly console: BrowserAutomationConsoleLogEntry[] = [];
  private readonly network: BrowserAutomationNetworkLogEntry[] = [];
  private readonly dialogs: BrowserAutomationDialogEvent[] = [];
  private readonly starts = new WeakMap<Request, number>();
  constructor(page: HostTelemetryEvents) {
    page.on("console", (message) => {
      const location = message.location();
      this.push(this.console, {
        level: message.type(),
        message: message.text().slice(0, 2000),
        source: location.url.slice(0, 8192),
        line: location.lineNumber,
        timestamp: Date.now(),
      });
    });
    page.on("pageerror", (error) =>
      this.push(this.console, {
        level: "error",
        message: error.message.slice(0, 2000),
        timestamp: Date.now(),
      }),
    );
    page.on("request", (request) => this.starts.set(request, Date.now()));
    page.on("requestfinished", (request) => {
      void this.recordRequest(request).catch(() => {});
    });
    page.on("requestfailed", (request) =>
      this.push(this.network, {
        url: request.url().slice(0, 8192),
        method: request.method(),
        type: request.resourceType(),
        startTime: this.starts.get(request) ?? Date.now(),
        duration: 0,
      }),
    );
    page.on("dialog", (dialog) => {
      const type = dialog.type();
      const action = type === "alert" ? "accept" : "dismiss";
      const recorded = BrowserAutomationDialogEventSchema.safeParse({
        type,
        message: dialog.message().slice(0, 2000),
        action: action === "accept" ? "accepted" : "dismissed",
        timestamp: Date.now(),
      });
      if (recorded.success) this.push(this.dialogs, recorded.data);
      void (action === "accept" ? dialog.accept() : dialog.dismiss()).catch(() => {});
    });
    page.on("popup", (popup) => {
      void popup.close().catch(() => {});
    });
    page.on("download", (download) => {
      void download.cancel().catch(() => {});
    });
  }
  private push<T>(list: T[], item: T) {
    list.push(item);
    if (list.length > 200) list.splice(0, list.length - 200);
  }
  private async recordRequest(request: Request) {
    const startTime = this.starts.get(request) ?? Date.now(),
      response = await request.response();
    this.push(this.network, {
      url: request.url().slice(0, 8192),
      method: request.method(),
      type: request.resourceType(),
      status: response?.status(),
      startTime,
      duration: Math.max(0, Date.now() - startTime),
    });
  }
  logs(limit: number) {
    return { console: this.console.slice(-limit), network: this.network.slice(-limit) };
  }
  takeDialogs() {
    return this.dialogs.splice(0);
  }
}
