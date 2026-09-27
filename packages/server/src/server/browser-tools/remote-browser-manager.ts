import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  chromium,
  type Browser,
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

type Viewport = RemoteBrowserTab["viewport"];
type BrowserLogs = Extract<BrowserAutomationResult, { command: "logs" }>;
type BrowserNetwork = Extract<BrowserAutomationResult, { command: "network" }>;
interface Tab {
  browserId: string;
  workspaceId: string;
  url: string;
  title: string;
  viewport: Viewport;
  context: BrowserContext | null;
  page: Page | null;
  state: RemoteBrowserTab["state"];
  error: string | null;
  lastUsed: number;
  lastFrameAt: number;
  lastScrollAt: number;
  lastHeapCheckAt: number;
  frameRevision: number;
  cachedFrame: Buffer | null;
  frameInFlight: Promise<Buffer> | null;
  crashCount: number;
  consoleLog: BrowserLogs["console"];
  networkLog: BrowserLogs["network"];
  networkRequests: NonNullable<BrowserNetwork["requests"]>;
  requestIds: WeakMap<Request, string>;
  requestStartedAt: WeakMap<Request, number>;
  responses: Map<string, Response>;
}

const MAX_LIVE_TABS = 4;
const IDLE_SUSPEND_MS = 5 * 60_000;
const METADATA_REAP_MS = 60 * 60_000;
const FRAME_INTERVAL_MS = 700;
const ACTIVE_SCROLL_FRAME_INTERVAL_MS = 150;
const ACTIVE_SCROLL_WINDOW_MS = 1_200;
// JSON/base64 plus relay encryption must fit Cloudflare's 1 MiB WebSocket frame.
const MAX_FRAME_BYTES = 650_000;
const MAX_PAGE_JS_HEAP_BYTES = 512 * 1024 * 1024;
const DEFAULT_VIEWPORT: Viewport = { mode: "responsive", width: 390, height: 844 };

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
    canGoBack: false,
    canGoForward: false,
    error: tab.error,
  };
}

function appendBounded<T>(items: T[], item: T, limit = 200): void {
  items.push(item);
  if (items.length > limit) items.splice(0, items.length - limit);
}

/** Daemon-owned pages survive a mobile socket loss, then shed their processes on idle. */
export class RemoteBrowserManager {
  private browser: Browser | null = null;
  private readonly snapshotEngine = new BrowserSnapshotEngine();
  private launching: Promise<Browser> | null = null;
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

  constructor() {
    this.reapTimer = setInterval(() => void this.reap(), 30_000);
    this.reapTimer.unref?.();
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    if (!this.launching) {
      this.launching = (async () => {
        // Prefer the installed system browser. Packaged daemons need not download
        // Playwright's separate browser bundle, but a developer bundle also works.
        let browser: Browser;
        try {
          browser = await chromium.launch({ channel: "msedge", headless: true });
        } catch {
          try {
            browser = await chromium.launch({ channel: "chrome", headless: true });
          } catch {
            try {
              browser = await chromium.launch({ headless: true });
            } catch (cause) {
              throw new Error(
                "No host browser runtime is available. Install Chrome or Edge on the host, or run `npx playwright install chromium` there.",
                { cause },
              );
            }
          }
        }
        browser.on("disconnected", () => {
          if (this.browser === browser) this.browser = null;
          for (const tab of this.tabs.values()) {
            if (tab.page) {
              tab.page = null;
              tab.context = null;
              tab.state = "crashed";
              tab.error = "The host browser stopped. Reload this tab to recover.";
              tab.cachedFrame = null;
            }
          }
        });
        this.browser = browser;
        return browser;
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
    tab.error = null;
    try {
      const browser = await this.getBrowser();
      const context = await browser.newContext({
        viewport: { width: tab.viewport.width, height: tab.viewport.height },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      tab.context = context;
      tab.page = page;
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
        tab.cachedFrame = null;
        void this.suspend(tab, tab.state);
      });
      page.on("framenavigated", (frame) => {
        if (frame !== page.mainFrame()) return;
        tab.url = page.url();
        tab.title = "";
        this.snapshotEngine.clearBrowser(tab.browserId);
        tab.cachedFrame = null;
      });
      await page.goto(tab.url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      tab.title = await page.title();
      tab.state = "ready";
    } catch (cause) {
      await this.suspend(tab, "crashed");
      tab.error = cause instanceof Error ? cause.message : String(cause);
      throw new Error(tab.error, { cause });
    }
  }

  private async suspend(tab: Tab, state: Tab["state"] = "suspended"): Promise<void> {
    const context = tab.context;
    tab.page = null;
    tab.context = null;
    tab.state = state;
    tab.cachedFrame = null;
    tab.frameInFlight = null;
    tab.responses.clear();
    tab.requestIds = new WeakMap();
    tab.requestStartedAt = new WeakMap();
    this.snapshotEngine.clearBrowser(tab.browserId);
    if (context) await context.close().catch(() => undefined);
  }

  private get(workspaceId: string, browserId: string): Tab {
    const tab = this.tabs.get(browserId);
    if (!tab || tab.workspaceId !== workspaceId)
      throw new Error("Browser tab not found in this workspace.");
    tab.lastUsed = Date.now();
    return tab;
  }

  private observePage(tab: Tab, page: Page): void {
    page.on("console", (message) => {
      appendBounded(tab.consoleLog, {
        level: message.type(),
        message: message.text().slice(0, 4_000),
        timestamp: Date.now(),
      });
    });
    page.on("request", (request) => {
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
    page.on("requestfailed", (request) =>
      finish(request, request.failure()?.errorText ?? "Request failed"),
    );
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

  private async captureFrame(tab: Tab, page: Page): Promise<Buffer> {
    if (Date.now() - tab.lastHeapCheckAt > 30_000) {
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
    for (const quality of [55, 35, 20, 10]) {
      const buffer = await page.screenshot({
        type: "jpeg",
        quality,
        animations: "disabled",
        timeout: 10_000,
      });
      if (buffer.length <= MAX_FRAME_BYTES) {
        tab.cachedFrame = buffer;
        tab.frameRevision++;
        tab.lastFrameAt = Date.now();
        return buffer;
      }
    }
    throw new Error("Page frame exceeds the mobile transfer limit. Try a smaller viewport.");
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
  }> {
    if (command.kind === "list")
      return {
        tabs: [...this.tabs.values()].filter((tab) => tab.workspaceId === workspaceId).map(asTab),
      };
    if (command.kind === "open") {
      if (this.closedTabs.has(command.browserId))
        throw new Error("This browser tab was closed on the host. Open a new tab instead.");
      let tab = this.tabs.get(command.browserId);
      if (tab && tab.workspaceId !== workspaceId)
        throw new Error("Browser tab belongs to another workspace.");
      if (!tab) {
        tab = {
          browserId: command.browserId,
          workspaceId,
          url: normalUrl(command.url),
          title: "",
          viewport: command.viewport ?? DEFAULT_VIEWPORT,
          context: null,
          page: null,
          state: "suspended",
          error: null,
          lastUsed: Date.now(),
          lastFrameAt: 0,
          lastScrollAt: 0,
          lastHeapCheckAt: 0,
          frameRevision: 0,
          cachedFrame: null,
          frameInFlight: null,
          crashCount: 0,
          consoleLog: [],
          networkLog: [],
          networkRequests: [],
          requestIds: new WeakMap(),
          requestStartedAt: new WeakMap(),
          responses: new Map(),
        };
        this.tabs.set(tab.browserId, tab);
      }
      // Reattachment is idempotent. The daemon's current page wins over stale
      // local tab metadata after a transient disconnect.
      await this.start(tab);
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
    if (command.kind === "viewport") {
      tab.viewport = command.viewport;
      if (tab.page)
        await tab.page.setViewportSize({
          width: command.viewport.width,
          height: command.viewport.height,
        });
      tab.cachedFrame = null;
      return { tab: asTab(tab) };
    }
    await this.start(tab);
    const page = tab.page!;
    switch (command.kind) {
      case "frame": {
        const frameInterval =
          Date.now() - tab.lastScrollAt < ACTIVE_SCROLL_WINDOW_MS
            ? ACTIVE_SCROLL_FRAME_INTERVAL_MS
            : FRAME_INTERVAL_MS;
        if (Date.now() - tab.lastFrameAt >= frameInterval || !tab.cachedFrame) {
          if (!tab.frameInFlight) {
            tab.frameInFlight = this.captureFrame(tab, page).finally(() => {
              tab.frameInFlight = null;
            });
          }
          await tab.frameInFlight;
        }
        return {
          tab: asTab(tab),
          ...(command.knownRevision === tab.frameRevision
            ? {}
            : {
                frame: {
                  mimeType: "image/jpeg" as const,
                  dataBase64: tab.cachedFrame!.toString("base64"),
                  width: tab.viewport.width,
                  height: tab.viewport.height,
                  revision: tab.frameRevision,
                },
              }),
        };
      }
      case "navigate":
        await page.goto(normalUrl(command.url), { waitUntil: "domcontentloaded", timeout: 20_000 });
        break;
      case "back":
        await page.goBack({ waitUntil: "domcontentloaded", timeout: 20_000 });
        break;
      case "forward":
        await page.goForward({ waitUntil: "domcontentloaded", timeout: 20_000 });
        break;
      case "reload":
        await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
        break;
      case "tap":
        await page.mouse.click(command.x, command.y);
        break;
      case "scroll":
        await page.mouse.move(command.x, command.y);
        await page.mouse.wheel(command.deltaX, command.deltaY);
        tab.lastScrollAt = Date.now();
        break;
      case "type":
        await page.keyboard.insertText(command.text);
        break;
      case "key":
        await page.keyboard.press(command.key);
        break;
    }
    tab.url = page.url();
    tab.title = await page.title().catch(() => tab.title);
    tab.cachedFrame = null;
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
          const data = await page.screenshot({
            type: "png",
            fullPage: command.args.fullPage,
            timeout: 10_000,
          });
          result = {
            command: "screenshot",
            browserId,
            mimeType: "image/png",
            dataBase64: data.toString("base64"),
            width: data.readUInt32BE(16),
            height: data.readUInt32BE(20),
          } as typeof result;
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
          const value = await page.evaluate(command.args.function, element);
          await element?.dispose();
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
          throw new Error(`The hosted browser does not support ${command.command} yet.`);
      }
      tab.url = page.url();
      tab.title = await page.title().catch(() => tab.title);
      tab.cachedFrame = null;
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
          message: cause instanceof Error ? cause.message : String(cause),
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
      if (!tab.page && now - tab.lastUsed > METADATA_REAP_MS) this.tabs.delete(tab.browserId);
    }
    if (this.browser && ![...this.tabs.values()].some((tab) => tab.page)) {
      const browser = this.browser;
      this.browser = null;
      await browser.close().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    clearInterval(this.reapTimer);
    await this.startQueue;
    await Promise.all([...this.tabs.values()].map((tab) => this.suspend(tab)));
    this.tabs.clear();
    this.closedTabs.clear();
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
  }
}
