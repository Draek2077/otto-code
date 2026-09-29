import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  chromium,
  type BrowserContext,
  type ElementHandle,
  type Page,
  type Request,
  type Response,
} from "playwright";
import type {
  RemoteBrowserCommand,
  RemoteBrowserTab,
} from "@otto-code/protocol/browser-remote/rpc-schemas";
import type {
  BrowserAutomationExecuteRequest,
  BrowserAutomationExecuteResponse,
  BrowserAutomationCommandName,
  BrowserAutomationResult,
} from "@otto-code/protocol/browser-automation/rpc-schemas";
import {
  BrowserSnapshotEngine,
  type SnapshotPage,
} from "@otto-code/protocol/browser-automation/snapshot-engine";
import { browserToolsFailure } from "./errors.js";
import { browserErrorText, isErrorPageUrl, isPageLoadFailure } from "./page-load-errors.js";
import { TabStream, type StreamStats } from "./remote-browser-stream.js";

type Viewport = RemoteBrowserTab["viewport"];
type BrowserLogs = Extract<BrowserAutomationResult, { command: "logs" }>;
type BrowserNetwork = Extract<BrowserAutomationResult, { command: "network" }>;
interface TabOrigin {
  preview?: RemoteBrowserTab["preview"];
  layout?: RemoteBrowserTab["layout"];
}
interface Tab extends TabOrigin {
  browserId: string;
  workspaceId: string;
  url: string;
  title: string;
  viewport: Viewport;
  page: Page | null;
  state: RemoteBrowserTab["state"];
  isLoading: boolean;
  loadingRequest: Request | null;
  /** Orders tab snapshots so a late command response cannot replace newer page state. */
  observationId: number;
  error: string | null;
  lastUsed: number;
  // A client that still lists the workspace holds its tabs, even while idle.
  lastClaimed: number;
  canGoBack: boolean;
  canGoForward: boolean;
  lastHeapCheckAt: number;
  focusRequestId: string | null;
  stream: TabStream;
  crashCount: number;
  consoleLog: BrowserLogs["console"];
  networkLog: BrowserLogs["network"];
  networkRequests: NonNullable<BrowserNetwork["requests"]>;
  requestIds: WeakMap<Request, string>;
  requestStartedAt: WeakMap<Request, number>;
  responses: Map<string, Response>;
}

function setPageLoading(tab: Tab, loading: boolean): void {
  if (tab.isLoading === loading) return;
  tab.isLoading = loading;
  tab.stream.noteStatusChange();
}

function isMainFrameNavigation(page: Page, request: Request): boolean {
  if (!request.isNavigationRequest()) return false;
  try {
    return request.frame() === page.mainFrame();
  } catch {
    return false;
  }
}

const MAX_LIVE_TABS = 4;
const RUNTIME_RETRY_MS = 5 * 60_000;
const IDLE_SUSPEND_MS = 5 * 60_000;
const METADATA_REAP_MS = 60 * 60_000;
const MAX_PAGE_JS_HEAP_BYTES = 512 * 1024 * 1024;
const DEFAULT_VIEWPORT: Viewport = { mode: "responsive", width: 390, height: 844 };
// Match the desktop browser tool's vision budget, including for tall full-page captures.
const SCREENSHOT_MAX_LONG_EDGE = 1568;
const SCREENSHOT_MAX_PIXELS = 1_150_000;
const ELEMENT_CAPTURE_MAX_SCALE = 3;
const ELEMENT_CAPTURE_PADDING_PX = 8;

function screenshotScale(width: number, height: number, maxScale: number): number {
  return Math.min(
    maxScale,
    SCREENSHOT_MAX_LONG_EDGE / Math.max(width, height),
    Math.sqrt(SCREENSHOT_MAX_PIXELS / (width * height)),
  );
}

async function captureScreenshot(
  page: Page,
  clip: { x: number; y: number; width: number; height: number },
  scale: number,
): Promise<Buffer> {
  const session = await page.context().newCDPSession(page);
  try {
    // CDP re-renders the clip at scale. Resizing a PNG after capture would blur
    // small text and leave device-pixel-ratio inflation in the AI image.
    const capture = await session.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { ...clip, scale },
    });
    return Buffer.from(capture.data, "base64");
  } finally {
    // A page crash can close the CDP session during capture. Preserve the
    // capture error so the tool reports the actual failure to the caller.
    await session.detach().catch(() => undefined);
  }
}

function normalUrl(value: string | undefined): string {
  const url = value || "https://example.com";
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS pages can be opened.");
  }
  return parsed.toString();
}

function asTab(tab: Tab): RemoteBrowserTab {
  return {
    browserId: tab.browserId,
    workspaceId: tab.workspaceId,
    url: tab.url,
    title: tab.title,
    viewport: tab.viewport,
    state: tab.state,
    isLoading: tab.isLoading,
    observationId: ++tab.observationId,
    canGoBack: tab.canGoBack,
    canGoForward: tab.canGoForward,
    error: tab.error,
    ...(tab.focusRequestId ? { focusRequestId: tab.focusRequestId } : {}),
    ...(tab.preview ? { preview: tab.preview } : {}),
    ...(tab.layout ? { layout: tab.layout } : {}),
  };
}

/** The page's address, or the one it was asked for while an error page shows. */
function visibleUrl(tab: Tab, page: Page): string {
  const url = page.url();
  return isErrorPageUrl(url) ? tab.url : url;
}

/** Runs a navigation. A page that will not load shows that itself. */
async function navigate(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (cause) {
    if (!isPageLoadFailure(cause)) throw cause;
  }
}

async function readHistory(tab: Tab, page: Page): Promise<void> {
  const session = await page.context().newCDPSession(page);
  try {
    const history = await session.send("Page.getNavigationHistory");
    if (tab.page !== page) return;
    tab.canGoBack = history.currentIndex > 0;
    tab.canGoForward = history.currentIndex < history.entries.length - 1;
  } finally {
    await session.detach().catch(() => undefined);
  }
}

function appendBounded<T>(items: T[], item: T, limit = 200): void {
  items.push(item);
  if (items.length > limit) items.splice(0, items.length - limit);
}

/** Daemon-owned pages survive a mobile socket loss, then shed their processes on idle. */
export class RemoteBrowserManager {
  private context: BrowserContext | null = null;
  private readonly snapshotEngine = new BrowserSnapshotEngine();
  private launching: Promise<BrowserContext> | null = null;
  private runtimeMissingUntil = 0;
  private startQueue: Promise<void> = Promise.resolve();
  private readonly tabs = new Map<string, Tab>();
  private readonly closedTabs = new Map<string, number>();
  private readonly reapTimer: ReturnType<typeof setInterval>;

  readonly supportedCommands: readonly BrowserAutomationCommandName[] = [
    "list_tabs",
    "new_tab",
    "snapshot",
    "click",
    "fill",
    "wait",
    "type",
    "keypress",
    "navigate",
    "back",
    "forward",
    "reload",
    "screenshot",
    "screenshot_element",
    "logs",
    "network",
    "upload",
    "evaluate",
    "inspect",
    "select",
    "hover",
    "drag",
    "scroll",
    "resize",
    "close_tab",
    "focus_tab",
    "page_text",
    "set_color_scheme",
  ];

  constructor(private readonly profileDirectory: string) {
    this.reapTimer = setInterval(() => void this.reap(), 30_000);
    this.reapTimer.unref?.();
  }

  /**
   * Whether this host can run a browser. A failure is remembered for a while so
   * each new tab does not retry three launches, and forgotten so installing a
   * browser takes effect without restarting the daemon.
   */
  async hasRuntime(): Promise<boolean> {
    if (Date.now() < this.runtimeMissingUntil) return false;
    try {
      await this.getContext();
      return true;
    } catch {
      this.runtimeMissingUntil = Date.now() + RUNTIME_RETRY_MS;
      return false;
    }
  }

  private async getContext(): Promise<BrowserContext> {
    if (this.context?.browser()?.isConnected()) return this.context;
    if (!this.launching) {
      this.launching = (async () => {
        // One disk-backed profile per daemon shares website sessions across
        // hosted tabs. Each tab still owns its page and viewport.
        // Prefer the installed system browser. Packaged daemons need not download
        // Playwright's separate browser bundle, but a developer bundle also works.
        let context: BrowserContext;
        const options = {
          headless: true,
          viewport: { width: DEFAULT_VIEWPORT.width, height: DEFAULT_VIEWPORT.height },
          deviceScaleFactor: 1,
        } as const;
        try {
          context = await chromium.launchPersistentContext(this.profileDirectory, {
            ...options,
            channel: "msedge",
          });
        } catch {
          try {
            context = await chromium.launchPersistentContext(this.profileDirectory, {
              ...options,
              channel: "chrome",
            });
          } catch {
            try {
              context = await chromium.launchPersistentContext(this.profileDirectory, options);
            } catch (cause) {
              throw new Error(
                "The host browser could not start or open its profile. Install Chrome or Edge on the host (or Playwright Chromium), and make sure another process is not using the profile.",
                { cause },
              );
            }
          }
        }
        context.on("close", () => {
          if (this.context === context) this.context = null;
          for (const tab of this.tabs.values()) {
            if (tab.page) {
              tab.page = null;
              tab.state = "crashed";
              setPageLoading(tab, false);
              tab.error = "The host browser stopped. Reload this tab to recover.";
              void tab.stream.detach();
            }
          }
        });
        // A persistent context starts with a blank page. Otto owns only pages
        // created for registered tabs, so discard Chromium's initial page.
        await Promise.all(context.pages().map((page) => page.close()));
        this.context = context;
        return context;
      })().finally(() => {
        this.launching = null;
      });
    }
    return this.launching;
  }

  private start(tab: Tab): Promise<void> {
    // Serialize starts so concurrent reconnects cannot exceed the live-tab cap
    // or create two contexts for the same browser ID.
    const pending = this.startQueue.then(() => this.startLocked(tab));
    this.startQueue = pending.catch(() => undefined);
    return pending;
  }

  private async startLocked(tab: Tab): Promise<void> {
    if (tab.page && !tab.page.isClosed()) return;
    if (tab.state === "quarantined")
      throw new Error("This tab crashed repeatedly. Close it and open a new tab.");
    const liveTabs = [...this.tabs.values()].filter((item) => item.page);
    if (liveTabs.length >= MAX_LIVE_TABS) {
      const dormant = liveTabs
        .filter((item) => Date.now() - item.lastUsed > 60_000)
        .sort((a, b) => a.lastUsed - b.lastUsed)[0];
      if (!dormant)
        throw new Error(
          `The host browser is at its ${MAX_LIVE_TABS}-tab limit. Close or leave another tab idle to free capacity.`,
        );
      await this.suspend(dormant);
    }
    tab.state = "starting";
    tab.loadingRequest = null;
    setPageLoading(tab, true);
    tab.error = null;
    try {
      const context = await this.getContext();
      const page = await context.newPage();
      await page.setViewportSize({ width: tab.viewport.width, height: tab.viewport.height });
      tab.page = page;
      tab.stream.attach(page);
      this.observePage(tab, page);
      // Until page-created tabs have workspace-layout binding, discard them at
      // birth so an untracked popup cannot hold another renderer indefinitely.
      page.on("popup", (popup) => {
        tab.error = "This page opened a popup that hosted browser tabs cannot display yet.";
        void popup.close().catch(() => undefined);
      });
      page.on("crash", () => {
        tab.crashCount++;
        tab.state = tab.crashCount >= 2 ? "quarantined" : "crashed";
        tab.error =
          tab.state === "quarantined"
            ? "This page crashed repeatedly and was stopped."
            : "The page crashed. Reload to recover.";
        tab.stream.invalidate();
        void this.suspend(tab, tab.state);
      });
      page.on("framenavigated", (frame) => {
        if (frame !== page.mainFrame()) return;
        tab.url = visibleUrl(tab, page);
        tab.title = "";
        this.snapshotEngine.clearBrowser(tab.browserId);
        tab.stream.invalidate();
        // A closing page rejects the history read; its state no longer matters.
        void readHistory(tab, page).catch(() => undefined);
      });
      const url = tab.url;
      await navigate(() => page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 }));
      // An error page replacing the failed load can still be arriving.
      tab.title = await page.title().catch(() => "");
      tab.state = "ready";
    } catch (cause) {
      await this.suspend(tab, "crashed");
      tab.error = browserErrorText(cause);
      throw new Error(tab.error, { cause });
    }
  }

  private async suspend(tab: Tab, state: Tab["state"] = "suspended"): Promise<void> {
    const page = tab.page;
    tab.page = null;
    tab.state = state;
    tab.loadingRequest = null;
    setPageLoading(tab, false);
    await tab.stream.detach();
    tab.canGoBack = false;
    tab.canGoForward = false;
    tab.responses.clear();
    tab.requestIds = new WeakMap();
    tab.requestStartedAt = new WeakMap();
    this.snapshotEngine.clearBrowser(tab.browserId);
    // Suspend only this page. The shared context owns cookies and site data
    // and is reaped separately when all hosted pages are idle.
    if (page) await page.close().catch(() => undefined);
  }

  private ensureTab(
    workspaceId: string,
    command: Extract<RemoteBrowserCommand, { kind: "open" }>,
    origin: TabOrigin = {},
  ): Tab {
    if (this.closedTabs.has(command.browserId))
      throw new Error("This browser tab was closed on the host. Open a new tab instead.");
    const existing = this.tabs.get(command.browserId);
    if (existing && existing.workspaceId !== workspaceId)
      throw new Error("Browser tab belongs to another workspace.");
    if (existing) return existing;
    const tab: Tab = {
      ...origin,
      browserId: command.browserId,
      workspaceId,
      url: normalUrl(command.url),
      title: "",
      viewport: command.viewport ?? DEFAULT_VIEWPORT,
      page: null,
      state: "suspended",
      isLoading: false,
      loadingRequest: null,
      observationId: 0,
      error: null,
      lastUsed: Date.now(),
      lastClaimed: Date.now(),
      canGoBack: false,
      canGoForward: false,
      lastHeapCheckAt: 0,
      focusRequestId: null,
      stream: new TabStream(),
      crashCount: 0,
      consoleLog: [],
      networkLog: [],
      networkRequests: [],
      requestIds: new WeakMap(),
      requestStartedAt: new WeakMap(),
      responses: new Map(),
    };
    this.tabs.set(tab.browserId, tab);
    return tab;
  }

  private get(workspaceId: string, browserId: string): Tab {
    const tab = this.tabs.get(browserId);
    if (!tab || tab.workspaceId !== workspaceId)
      throw new Error("Browser tab not found in this workspace.");
    tab.lastUsed = Date.now();
    return tab;
  }

  private observePage(tab: Tab, page: Page): void {
    page.on("load", () => {
      if (tab.page !== page) return;
      tab.loadingRequest = null;
      setPageLoading(tab, false);
    });
    page.on("console", (message) => {
      appendBounded(tab.consoleLog, {
        level: message.type(),
        message: message.text().slice(0, 4_000),
        timestamp: Date.now(),
      });
    });
    page.on("request", (request) => {
      if (tab.page === page && isMainFrameNavigation(page, request)) {
        tab.loadingRequest = request;
        setPageLoading(tab, true);
      }
      const requestId = randomUUID();
      tab.requestIds.set(request, requestId);
      tab.requestStartedAt.set(request, Date.now());
      appendBounded(tab.networkRequests, {
        requestId,
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        finished: false,
      });
    });
    page.on("response", (response) => {
      const requestId = tab.requestIds.get(response.request());
      const entry = tab.networkRequests.find((item) => item.requestId === requestId);
      if (!entry || !requestId) return;
      entry.status = response.status();
      entry.statusText = response.statusText();
      entry.mimeType = response.headers()["content-type"];
      tab.responses.set(requestId, response);
      if (tab.responses.size > 50) tab.responses.delete(tab.responses.keys().next().value!);
    });
    const finish = (request: Request, failed?: string) => {
      const requestId = tab.requestIds.get(request);
      const entry = tab.networkRequests.find((item) => item.requestId === requestId);
      if (!entry) return;
      entry.finished = true;
      if (failed) entry.failed = failed;
      const startedAt = tab.requestStartedAt.get(request) ?? Date.now();
      appendBounded(tab.networkLog, {
        url: entry.url,
        method: entry.method,
        status: entry.status,
        type: entry.resourceType,
        startTime: startedAt,
        duration: Date.now() - startedAt,
      });
    };
    page.on("requestfinished", (request) => finish(request));
    page.on("requestfailed", (request) => {
      finish(request, request.failure()?.errorText ?? "Request failed");
      if (tab.page === page && tab.loadingRequest === request) {
        tab.loadingRequest = null;
        setPageLoading(tab, false);
      }
    });
  }

  private snapshotPage(page: Page): SnapshotPage {
    return { getURL: () => page.url(), executeJavaScript: (code) => page.evaluate(code) };
  }

  private async elementForRef(
    page: Page,
    browserId: string,
    ref: string,
  ): Promise<ElementHandle<Node>> {
    const expression = this.snapshotEngine.runtimeElementExpression({ browserId, ref });
    if (typeof expression !== "string")
      throw new Error("Element reference is stale. Take a new snapshot.");
    const handle = await page.evaluateHandle(expression);
    const element = handle.asElement();
    if (!element) {
      await handle.dispose();
      throw new Error("Element reference is stale. Take a new snapshot.");
    }
    return element;
  }

  private async checkHeap(tab: Tab, page: Page): Promise<void> {
    if (Date.now() - tab.lastHeapCheckAt <= 30_000) return;
    tab.lastHeapCheckAt = Date.now();
    const usedHeap = await page
      .evaluate(() => {
        const browserPerformance = performance as Performance & {
          memory?: { usedJSHeapSize: number };
        };
        return browserPerformance.memory?.usedJSHeapSize ?? 0;
      })
      .catch(() => 0);
    if (usedHeap > MAX_PAGE_JS_HEAP_BYTES) {
      await this.suspend(tab, "quarantined");
      tab.error = "This page exceeded the host browser memory limit and was stopped.";
      throw new Error(tab.error);
    }
  }

  // Each command has its own bounded side effect and shares the same tab lifecycle.
  // eslint-disable-next-line complexity
  async execute(
    workspaceId: string,
    command: RemoteBrowserCommand,
  ): Promise<{
    tab?: RemoteBrowserTab;
    tabs?: RemoteBrowserTab[];
    frame?: {
      mimeType: "image/jpeg";
      dataBase64: string;
      width: number;
      height: number;
      revision: number;
    };
    binaryFrame?: { width: number; height: number; revision: number };
    /** The picture for `binaryFrame`; the socket layer sends it as bytes. */
    frameImage?: Buffer;
    stream?: StreamStats;
  }> {
    if (command.kind === "list") {
      const tabs = [...this.tabs.values()].filter((tab) => tab.workspaceId === workspaceId);
      for (const tab of tabs) tab.lastClaimed = Date.now();
      return { tabs: tabs.map(asTab) };
    }
    if (command.kind === "open") {
      const tab = this.ensureTab(workspaceId, command);
      // Reattachment is idempotent. The daemon's current page wins over stale
      // local tab metadata after a transient disconnect.
      await this.start(tab);
      if (tab.page) await readHistory(tab, tab.page).catch(() => undefined);
      return { tab: asTab(tab) };
    }
    const tab = this.get(workspaceId, command.browserId);
    if (command.kind === "close") {
      await this.startQueue;
      await this.suspend(tab);
      this.tabs.delete(tab.browserId);
      this.closedTabs.set(tab.browserId, Date.now());
      return {};
    }
    if (command.kind === "suspend") {
      await this.startQueue;
      await this.suspend(tab);
      return { tab: asTab(tab) };
    }
    if (command.kind === "get") return { tab: asTab(tab) };
    if (command.kind === "stop") {
      const page = tab.page;
      if (page && !page.isClosed()) {
        const session = await page.context().newCDPSession(page);
        try {
          await session.send("Page.stopLoading");
        } finally {
          await session.detach().catch(() => undefined);
        }
      }
      tab.loadingRequest = null;
      setPageLoading(tab, false);
      return { tab: asTab(tab) };
    }
    if (command.kind === "viewport") {
      tab.viewport = command.viewport;
      if (tab.page)
        await tab.page.setViewportSize({
          width: command.viewport.width,
          height: command.viewport.height,
        });
      await tab.stream.resize();
      return { tab: asTab(tab) };
    }
    await this.start(tab);
    const page = tab.page!;
    switch (command.kind) {
      case "frame": {
        await this.checkHeap(tab, page);
        const frame = await tab.stream.next({
          size: tab.viewport,
          knownRevision: command.knownRevision,
          waitMs: command.waitMs,
          binary: command.binary === true,
        });
        const shared = { tab: asTab(tab), stream: tab.stream.stats() };
        if (!frame) return shared;
        const { image, ...described } = frame;
        if (command.binary) return { ...shared, binaryFrame: described, frameImage: image };
        return {
          ...shared,
          frame: { mimeType: "image/jpeg", dataBase64: image.toString("base64"), ...described },
        };
      }
      case "navigate": {
        const url = normalUrl(command.url);
        // Kept as the tab's address if the page answers with an error page.
        tab.url = url;
        setPageLoading(tab, true);
        await navigate(() => page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 }));
        break;
      }
      case "back":
        setPageLoading(tab, true);
        await navigate(async () => {
          if (!(await page.goBack({ waitUntil: "domcontentloaded", timeout: 20_000 })))
            setPageLoading(tab, false);
        });
        break;
      case "forward":
        setPageLoading(tab, true);
        await navigate(async () => {
          if (!(await page.goForward({ waitUntil: "domcontentloaded", timeout: 20_000 })))
            setPageLoading(tab, false);
        });
        break;
      case "reload":
        setPageLoading(tab, true);
        await navigate(() => page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 }));
        break;
      case "tap":
        tab.stream.noteInput();
        // Chromium dispatches the page's dblclick/contextmenu from these mouse options.
        await page.mouse.click(command.x, command.y, {
          button: command.button ?? "left",
          clickCount: command.clickCount ?? 1,
        });
        break;
      case "scroll":
        await page.mouse.move(command.x, command.y);
        await page.mouse.wheel(command.deltaX, command.deltaY);
        tab.stream.noteInput();
        break;
      case "type":
        tab.stream.noteInput();
        await page.keyboard.insertText(command.text);
        break;
      case "key":
        tab.stream.noteInput();
        await page.keyboard.press(command.key);
        break;
    }
    tab.url = visibleUrl(tab, page);
    tab.title = await page.title().catch(() => tab.title);
    tab.stream.invalidate();
    await readHistory(tab, page).catch(() => undefined);
    return { tab: asTab(tab) };
  }

  // The broker contract is a command union; the switch keeps responses paired to commands.
  // eslint-disable-next-line complexity
  async executeAutomation(
    request: BrowserAutomationExecuteRequest,
  ): Promise<BrowserAutomationExecuteResponse> {
    const { requestId, workspaceId, command, cwd } = request;
    try {
      if (command.command === "list_tabs") {
        return {
          type: "browser.automation.execute.response",
          payload: {
            requestId,
            ok: true,
            result: {
              command: "list_tabs",
              tabs: [...this.tabs.values()]
                .filter((tab) => Boolean(workspaceId) && tab.workspaceId === workspaceId)
                .map((tab) => ({
                  browserId: tab.browserId,
                  workspaceId: tab.workspaceId,
                  url: tab.url,
                  title: tab.title,
                  isActive: false,
                  isLoading: tab.state === "starting",
                  status: tab.state === "ready" ? ("ready" as const) : ("detached" as const),
                  viewportMode: tab.viewport.mode,
                  viewportWidth: tab.viewport.width,
                  viewportHeight: tab.viewport.height,
                })),
            },
          },
        };
      }
      if (!workspaceId) throw new Error("Workspace is required for a hosted browser tab.");
      if (command.command === "new_tab") {
        const browserId = randomUUID();
        const url = normalUrl(command.args.url);
        // The tab is born with its preview identity so a client that lists it
        // mid-start adopts it correctly.
        this.ensureTab(
          workspaceId,
          { kind: "open", browserId, url },
          {
            ...(command.args.preview ? { preview: command.args.preview } : {}),
            ...(command.args.layout === "split-right" ? { layout: "split-right" } : {}),
          },
        );
        try {
          await this.execute(workspaceId, { kind: "open", browserId, url });
        } catch (cause) {
          this.tabs.delete(browserId);
          throw cause;
        }
        return {
          type: "browser.automation.execute.response",
          payload: {
            requestId,
            ok: true,
            result: { command: "new_tab", browserId, workspaceId, url },
          },
        };
      }
      if (!("browserId" in command.args))
        throw new Error("Open a browser tab in this workspace first.");
      const browserId = command.args.browserId;
      if (command.command === "close_tab") {
        await this.execute(workspaceId, { kind: "close", browserId });
        return {
          type: "browser.automation.execute.response",
          payload: { requestId, ok: true, result: { command: "close_tab", browserId } },
        };
      }
      const tab = this.get(workspaceId, browserId);
      await this.start(tab);
      const page = tab.page!;
      const ref = "ref" in command.args ? command.args.ref : undefined;
      let result: BrowserAutomationResult;
      switch (command.command) {
        case "snapshot": {
          const snapshot = await this.snapshotEngine.snapshot({
            browserId,
            page: this.snapshotPage(page),
          });
          result = {
            command: "snapshot",
            browserId,
            workspaceId,
            url: page.url(),
            title: await page.title(),
            ...snapshot,
          };
          break;
        }
        case "click": {
          if (!ref) throw new Error("Element reference is required.");
          const element = await this.elementForRef(page, browserId, ref);
          await element.click({
            button: command.args.button,
            modifiers: command.args.modifiers,
            clickCount: command.args.doubleClick ? 2 : 1,
          });
          await element.dispose();
          result = { command: "click", browserId, ref };
          break;
        }
        case "fill": {
          if (!ref) throw new Error("Element reference is required.");
          const element = await this.elementForRef(page, browserId, ref);
          await element.fill(command.args.value);
          await element.dispose();
          result = { command: "fill", browserId, ref };
          break;
        }
        case "wait": {
          if (command.args.text) {
            await page
              .getByText(command.args.text)
              .first()
              .waitFor({ timeout: command.args.timeoutMs ?? 15_000 });
            result = { command: "wait", browserId, matched: "text" };
          } else if (command.args.url) {
            await page.waitForURL((url) => url.href.includes(command.args.url!), {
              timeout: command.args.timeoutMs ?? 15_000,
            });
            result = { command: "wait", browserId, matched: "url" };
          } else throw new Error("A text or URL condition is required.");
          break;
        }
        case "select": {
          if (!ref) throw new Error("Element reference is required.");
          const element = await this.elementForRef(page, browserId, ref);
          await element.selectOption(command.args.value);
          await element.dispose();
          result = { command: "select", browserId, ref, value: command.args.value };
          break;
        }
        case "upload": {
          if (!cwd || !ref)
            throw new Error("A workspace directory and element reference are required for upload.");
          const root = await realpath(cwd);
          const filePaths = await Promise.all(
            command.args.filePaths.map(async (filePath) => {
              const path = await realpath(resolve(root, filePath));
              const fromRoot = relative(root, path);
              if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot))
                throw new Error("Uploads must stay within the workspace directory.");
              return path;
            }),
          );
          const element = await this.elementForRef(page, browserId, ref);
          await element.setInputFiles(filePaths);
          await element.dispose();
          result = { command: "upload", browserId, ref, filePaths };
          break;
        }
        case "hover": {
          if (!ref) throw new Error("Element reference is required.");
          const element = await this.elementForRef(page, browserId, ref);
          await element.hover();
          await element.dispose();
          result = { command: "hover", browserId, ref };
          break;
        }
        case "drag": {
          const source = await this.elementForRef(page, browserId, command.args.sourceRef);
          const target = await this.elementForRef(page, browserId, command.args.targetRef);
          const sourceBox = await source.boundingBox();
          const targetBox = await target.boundingBox();
          if (!sourceBox || !targetBox) throw new Error("Drag elements are not visible.");
          await page.mouse.move(
            sourceBox.x + sourceBox.width / 2,
            sourceBox.y + sourceBox.height / 2,
          );
          await page.mouse.down();
          try {
            await page.mouse.move(
              targetBox.x + targetBox.width / 2,
              targetBox.y + targetBox.height / 2,
              { steps: 12 },
            );
          } finally {
            await page.mouse.up();
          }
          await source.dispose();
          await target.dispose();
          result = {
            command: "drag",
            browserId,
            sourceRef: command.args.sourceRef,
            targetRef: command.args.targetRef,
          };
          break;
        }
        case "type": {
          if (ref) {
            const element = await this.elementForRef(page, browserId, ref);
            await element.focus();
            await element.dispose();
          }
          await page.keyboard.insertText(command.args.text);
          result = { command: "type", browserId, ...(ref ? { ref } : {}) };
          break;
        }
        case "keypress": {
          if (ref) {
            const element = await this.elementForRef(page, browserId, ref);
            await element.focus();
            await element.dispose();
          }
          await page.keyboard.press(command.args.key);
          result = {
            command: "keypress",
            browserId,
            key: command.args.key,
            ...(ref ? { ref } : {}),
          };
          break;
        }
        case "navigate":
          await this.execute(workspaceId, { kind: "navigate", browserId, url: command.args.url });
          result = { command: "navigate", browserId, url: page.url() } as typeof result;
          break;
        case "back":
          await this.execute(workspaceId, { kind: "back", browserId });
          result = { command: "back", browserId } as typeof result;
          break;
        case "forward":
          await this.execute(workspaceId, { kind: "forward", browserId });
          result = { command: "forward", browserId } as typeof result;
          break;
        case "reload":
          await this.execute(workspaceId, { kind: "reload", browserId });
          result = { command: "reload", browserId } as typeof result;
          break;
        case "screenshot": {
          const viewport = page.viewportSize();
          if (!viewport) throw new Error("Browser viewport is unavailable for screenshot.");
          const clip = command.args.fullPage
            ? await page.evaluate(
                ({ width, height }) => ({
                  x: 0,
                  y: 0,
                  width: Math.max(
                    width,
                    document.documentElement.scrollWidth,
                    document.body?.scrollWidth ?? 0,
                  ),
                  height: Math.max(
                    height,
                    document.documentElement.scrollHeight,
                    document.body?.scrollHeight ?? 0,
                  ),
                }),
                viewport,
              )
            : await page.evaluate(
                ({ width, height }) => ({
                  x: window.scrollX,
                  y: window.scrollY,
                  width,
                  height,
                }),
                viewport,
              );
          const scale = screenshotScale(clip.width, clip.height, 1);
          const data = await captureScreenshot(page, clip, scale);
          result = {
            command: "screenshot",
            browserId,
            mimeType: "image/png",
            dataBase64: data.toString("base64"),
            width: data.readUInt32BE(16),
            height: data.readUInt32BE(20),
            scale,
          } as typeof result;
          break;
        }
        case "screenshot_element": {
          if (!ref) throw new Error("Element reference is required.");
          const element = await this.elementForRef(page, browserId, ref);
          try {
            const rect = await element.evaluate((node) => {
              if (!(node instanceof Element))
                throw new Error("Element reference is not an element.");
              const box = node.getBoundingClientRect();
              return {
                x: box.x + window.scrollX,
                y: box.y + window.scrollY,
                width: box.width,
                height: box.height,
              };
            });
            if (rect.width <= 0 || rect.height <= 0)
              throw new Error(`Element ${ref} has no visible box to capture.`);
            const clip = {
              x: Math.max(0, rect.x - ELEMENT_CAPTURE_PADDING_PX),
              y: Math.max(0, rect.y - ELEMENT_CAPTURE_PADDING_PX),
              width: rect.width + ELEMENT_CAPTURE_PADDING_PX * 2,
              height: rect.height + ELEMENT_CAPTURE_PADDING_PX * 2,
            };
            const scale = screenshotScale(clip.width, clip.height, ELEMENT_CAPTURE_MAX_SCALE);
            const data = await captureScreenshot(page, clip, scale);
            result = {
              command: "screenshot_element",
              browserId,
              ref,
              mimeType: "image/png",
              dataBase64: data.toString("base64"),
              width: data.readUInt32BE(16),
              height: data.readUInt32BE(20),
              scale,
            } as typeof result;
          } finally {
            await element.dispose();
          }
          break;
        }
        case "logs":
          result = {
            command: "logs",
            browserId,
            console: tab.consoleLog.slice(-command.args.maxEntries),
            network: tab.networkLog.slice(-command.args.maxEntries),
          };
          break;
        case "network": {
          if (command.args.requestId) {
            const response = tab.responses.get(command.args.requestId);
            if (!response)
              throw new Error(
                "The response body is no longer retained. Reload and inspect the request again.",
              );
            const declaredLength = Number(response.headers()["content-length"] ?? 0);
            if (declaredLength > 2_000_000)
              throw new Error("Response body exceeds the 2 MB inspection limit.");
            const body = await response.body();
            if (body.length > 2_000_000)
              throw new Error("Response body exceeds the 2 MB inspection limit.");
            const mime = response.headers()["content-type"] ?? "";
            const isText = mime.startsWith("text/") || /json|javascript|xml/.test(mime);
            result = {
              command: "network",
              browserId,
              body: {
                requestId: command.args.requestId,
                body: isText ? body.toString("utf8") : body.toString("base64"),
                base64Encoded: !isText,
                truncated: false,
              },
            };
          } else {
            result = {
              command: "network",
              browserId,
              requests: tab.networkRequests.filter(
                (entry) => command.args.filter !== "failed" || Boolean(entry.failed),
              ),
            };
          }
          break;
        }
        case "scroll":
          if (ref) {
            const element = await this.elementForRef(page, browserId, ref);
            const box = await element.boundingBox();
            if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await element.dispose();
          }
          await page.mouse.wheel(command.args.deltaX, command.args.deltaY);
          result = {
            command: "scroll",
            browserId,
            deltaX: command.args.deltaX,
            deltaY: command.args.deltaY,
            ...(ref ? { ref } : {}),
          } as typeof result;
          break;
        case "resize":
          await this.execute(workspaceId, {
            kind: "viewport",
            browserId,
            viewport: { mode: "fixed", width: command.args.width, height: command.args.height },
          });
          result = {
            command: "resize",
            browserId,
            width: command.args.width,
            height: command.args.height,
          } as typeof result;
          break;
        case "focus_tab":
          tab.focusRequestId = randomUUID();
          result = { command: "focus_tab", browserId } as typeof result;
          break;
        case "page_text": {
          let source: "article" | "main" | "body" = "body";
          if (await page.locator("article").count()) source = "article";
          else if (await page.locator("main").count()) source = "main";
          const text = await page
            .locator(source)
            .first()
            .innerText()
            .catch(() => "");
          result = {
            command: "page_text",
            browserId,
            url: page.url(),
            title: await page.title(),
            source,
            text: text.slice(0, command.args.maxChars),
            truncated: text.length > command.args.maxChars,
          } as typeof result;
          break;
        }
        case "set_color_scheme":
          await page.emulateMedia({
            colorScheme:
              command.args.colorScheme === "auto" ? "no-preference" : command.args.colorScheme,
          });
          result = {
            command: "set_color_scheme",
            browserId,
            colorScheme: command.args.colorScheme,
          };
          break;
        case "evaluate": {
          const element = ref ? await this.elementForRef(page, browserId, ref) : null;
          let value: unknown;
          try {
            value = await page.evaluate(
              async ({ functionSource, target }) => {
                // Match desktop: browser_evaluate accepts a function and invokes it,
                // with the snapshot element as its first argument when supplied.
                const userFunction: unknown = (0, eval)(`(${functionSource})`);
                if (typeof userFunction !== "function")
                  throw new Error("browser_evaluate input must evaluate to a function.");
                return target ? await userFunction(target) : await userFunction();
              },
              { functionSource: command.args.function, target: element },
            );
          } finally {
            await element?.dispose();
          }
          const serialized = JSON.stringify(value) ?? "null";
          result = {
            command: "evaluate",
            browserId,
            resultJson: serialized.slice(0, 30_000),
            truncated: serialized.length > 30_000,
          };
          break;
        }
        case "inspect": {
          const selector = command.args.selector;
          const inspectedRef = command.args.ref;
          const matchCount = selector ? await page.locator(selector).count() : 1;
          const element = inspectedRef
            ? await this.elementForRef(page, browserId, inspectedRef)
            : await page.locator(selector!).first().elementHandle();
          if (!element) throw new Error("Element not found.");
          const details = await element.evaluate(
            (node, styleNames) => {
              const target = node as HTMLElement;
              const rect = target.getBoundingClientRect();
              const computed = getComputedStyle(target);
              const styles: Record<string, string> = {};
              for (const name of styleNames) styles[name] = computed.getPropertyValue(name);
              return {
                tagName: target.tagName.toLowerCase(),
                id: target.id,
                className: String(target.className),
                text: target.innerText.slice(0, 4_000),
                box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                styles,
              };
            },
            command.args.styles ?? ["color", "background-color", "font-size", "display"],
          );
          await element.dispose();
          result = {
            command: "inspect",
            browserId,
            ...(selector ? { selector } : {}),
            ...(inspectedRef ? { ref: inspectedRef } : {}),
            matchCount,
            ...details,
          };
          break;
        }
        default:
          throw new Error("The hosted browser does not support this command yet.");
      }
      tab.url = visibleUrl(tab, page);
      tab.title = await page.title().catch(() => tab.title);
      tab.stream.invalidate();
      return {
        type: "browser.automation.execute.response",
        payload: { requestId, ok: true, result },
      };
    } catch (cause) {
      return {
        type: "browser.automation.execute.response",
        payload: browserToolsFailure({
          requestId,
          code: "browser_unknown_error",
          message: browserErrorText(cause),
          retryable: true,
        }),
      };
    }
  }

  private async reap(): Promise<void> {
    const now = Date.now();
    for (const [browserId, closedAt] of this.closedTabs)
      if (now - closedAt > METADATA_REAP_MS) this.closedTabs.delete(browserId);
    for (const tab of this.tabs.values()) {
      if (tab.page && now - tab.lastUsed > IDLE_SUSPEND_MS) await this.suspend(tab);
      if (!tab.page && now - Math.max(tab.lastUsed, tab.lastClaimed) > METADATA_REAP_MS)
        this.tabs.delete(tab.browserId);
    }
    if (this.context && ![...this.tabs.values()].some((tab) => tab.page)) {
      const context = this.context;
      this.context = null;
      await context.close().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    clearInterval(this.reapTimer);
    await this.startQueue;
    await Promise.all([...this.tabs.values()].map((tab) => this.suspend(tab)));
    this.tabs.clear();
    this.closedTabs.clear();
    await this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
