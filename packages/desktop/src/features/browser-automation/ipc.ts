import type { Rectangle } from "electron";
import { ipcMain } from "electron";
import { BrowserAutomationExecuteRequestSchema } from "@otto-code/protocol/browser-automation/rpc-schemas";
import type {
  BrowserAutomationConsoleLogEntry,
  BrowserAutomationDialogEvent,
} from "@otto-code/protocol/browser-automation/rpc-schemas";
import type { TabContents, BrowserRegistry, TabImage, CapturedNetworkRequest } from "./service.js";
import { CdpSessionQueue } from "./cdp-session-queue.js";
import {
  dialogAcceptValue,
  handledDialogEvent,
  MAX_DIALOGS_PER_COMMAND,
  promptShimDrainScript,
  promptShimInstallScript,
  promptShimRestoreScript,
} from "./dialog-handling.js";
import { executeAutomationCommand } from "./service.js";
import { BrowserSnapshotEngine } from "./snapshot-engine.js";
import type { IsolatedKeyboardInputEvent } from "./trusted-input.js";
import {
  listRegisteredOttoBrowserIds,
  listRegisteredOttoBrowserIdsForWorkspace,
  getOttoBrowserWebContentsForHostWindow,
  getWorkspaceActiveOttoBrowserIdForHostWindow,
  getOttoBrowserWorkspaceId,
} from "../browser-webviews/index.js";

const MAX_CONSOLE_MESSAGES_PER_TAB = 200;
/**
 * Per-message length cap. The tab retains up to 200 entries, but a single
 * console line (a serialized object, a stack trace, a data URL) can be huge and
 * enters an agent's transcript verbatim via browser_logs. Truncate with a
 * marker so the head is kept and nothing is silently dropped.
 */
const MAX_CONSOLE_MESSAGE_CHARS = 2_000;
const consoleMessagesByContentsId = new Map<number, BrowserAutomationConsoleLogEntry[]>();
const cdpQueuesByContentsId = new Map<number, CdpSessionQueue>();
const dialogMonitorsByContentsId = new Map<number, DialogMonitor>();
const observedContentsIds = new Set<number>();

interface IpcHandlerRegistry {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

interface HostWebContents {
  readonly id: number;
  once(event: "destroyed", listener: () => void): void;
}

/**
 * One snapshot engine per host window. Snapshot refs are small integers handed
 * back to the model ("ref3"), so a single shared engine would let two windows
 * mint the same ref for different elements and act on each other's page. The
 * entry is dropped when the host window is destroyed so refs do not outlive it.
 */
export class HostSnapshotEngineRegistry {
  private readonly entries = new Map<
    number,
    { hostContents: HostWebContents; snapshotEngine: BrowserSnapshotEngine }
  >();

  public get(hostContents: HostWebContents): BrowserSnapshotEngine {
    const existing = this.entries.get(hostContents.id);
    if (existing) {
      return existing.snapshotEngine;
    }
    const snapshotEngine = new BrowserSnapshotEngine();
    const entry = { hostContents, snapshotEngine };
    this.entries.set(hostContents.id, entry);
    hostContents.once("destroyed", () => {
      if (this.entries.get(hostContents.id) === entry) {
        this.entries.delete(hostContents.id);
      }
    });
    return snapshotEngine;
  }
}

const hostSnapshotEngines = new HostSnapshotEngineRegistry();

interface WebContentsDebugger {
  isAttached(): boolean;
  attach(protocolVersion?: string): void;
  sendCommand(command: string, params?: Record<string, unknown>): Promise<unknown>;
  on?(
    event: "message",
    listener: (event: unknown, method: string, params?: Record<string, unknown>) => void,
  ): void;
  on?(event: "detach", listener: () => void): void;
}

// Electron 32+ delivers the message details on the event object itself; the
// old positional (level, message, line, sourceId) args are deprecated and log
// a warning when the listener declares them.
interface ConsoleMessageEvent {
  level: unknown;
  message: unknown;
  lineNumber: unknown;
  sourceId: unknown;
}

interface ConsoleMessageEmitter {
  on(event: "console-message", listener: (event: ConsoleMessageEvent) => void): void;
  once(event: "destroyed", listener: () => void): void;
}

interface BrowserAutomationWebContents extends ConsoleMessageEmitter {
  readonly id: number;
  readonly debugger: WebContentsDebugger;
  getURL(): string;
  getTitle(): string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  isLoading(): boolean;
  isDestroyed(): boolean;
  executeJavaScript(code: string): Promise<unknown>;
  loadURL(url: string): Promise<void>;
  goBack(): void;
  goForward(): void;
  reload(): void;
  capturePage(rect?: Rectangle, options?: { stayHidden?: boolean }): Promise<TabImage>;
  sendInputEvent(event: IsolatedKeyboardInputEvent): void;
  invalidate(): void;
}

export function adaptWebContents(contents: BrowserAutomationWebContents): TabContents {
  // Read once: webContents.id throws after the guest is destroyed, and the
  // closures below outlive it.
  const contentsId = contents.id;
  observeConsoleMessages(contents, contentsId);
  const cdpQueue = getCdpQueue(contentsId);
  const dialogMonitor = getDialogMonitor(contents, cdpQueue);
  return {
    id: contentsId,
    getURL: () => contents.getURL(),
    getTitle: () => contents.getTitle(),
    canGoBack: () => contents.canGoBack(),
    canGoForward: () => contents.canGoForward(),
    isLoading: () => contents.isLoading(),
    isDestroyed: () => contents.isDestroyed(),
    executeJavaScript: (code: string) => contents.executeJavaScript(code),
    loadURL: (url: string) => contents.loadURL(url),
    goBack: () => contents.goBack(),
    goForward: () => contents.goForward(),
    reload: () => contents.reload(),
    capturePage: (captureOptions) => contents.capturePage(undefined, captureOptions),
    invalidate: () => contents.invalidate(),
    sendInputEvent: (event) => contents.sendInputEvent(event),
    getConsoleMessages: () => consoleMessagesByContentsId.get(contentsId) ?? [],
    captureDialogs: (task) => dialogMonitor.capture(task),
    sendDebugCommand: (command: string, params?: Record<string, unknown>) =>
      cdpQueue.run(async () => {
        if (!contents.debugger.isAttached()) {
          contents.debugger.attach("1.3");
        }
        return contents.debugger.sendCommand(command, params ?? {});
      }),
    startNetworkCapture: async () => {
      observeNetworkEvents(contents);
      if (networkCaptureEnabledContentsIds.has(contentsId)) {
        return;
      }
      await cdpQueue.run(async () => {
        if (!contents.debugger.isAttached()) {
          contents.debugger.attach("1.3");
        }
        await contents.debugger.sendCommand("Network.enable", {});
      });
      networkCaptureEnabledContentsIds.add(contentsId);
    },
    getNetworkRequests: () => [...getNetworkLog(contentsId).values()],
    getNetworkResponseBody: async (requestId: string) => {
      if (!getNetworkLog(contentsId).has(requestId)) {
        return null;
      }
      const raw = (await cdpQueue.run(async () => {
        if (!contents.debugger.isAttached()) {
          contents.debugger.attach("1.3");
        }
        return contents.debugger.sendCommand("Network.getResponseBody", { requestId });
      })) as { body?: unknown; base64Encoded?: unknown } | null;
      if (!raw || typeof raw.body !== "string") {
        return null;
      }
      return { body: raw.body, base64Encoded: raw.base64Encoded === true };
    },
  };
}

const MAX_NETWORK_ENTRIES_PER_TAB = 500;
const networkLogByContentsId = new Map<number, Map<string, CapturedNetworkRequest>>();
const networkCaptureEnabledContentsIds = new Set<number>();
const networkObservedContentsIds = new Set<number>();

function getNetworkLog(contentsId: number): Map<string, CapturedNetworkRequest> {
  const existing = networkLogByContentsId.get(contentsId);
  if (existing) {
    return existing;
  }
  const log = new Map<string, CapturedNetworkRequest>();
  networkLogByContentsId.set(contentsId, log);
  return log;
}

function observeNetworkEvents(contents: BrowserAutomationWebContents): void {
  if (networkObservedContentsIds.has(contents.id)) {
    return;
  }
  networkObservedContentsIds.add(contents.id);
  contents.debugger.on?.("message", (_event, method, params) => {
    if (!method.startsWith("Network.")) {
      return;
    }
    applyNetworkEvent(getNetworkLog(contents.id), method, params ?? {});
  });
}

function applyNetworkEvent(
  log: Map<string, CapturedNetworkRequest>,
  method: string,
  params: Record<string, unknown>,
): void {
  const requestId = typeof params.requestId === "string" ? params.requestId : null;
  if (!requestId) {
    return;
  }
  if (method === "Network.requestWillBeSent") {
    recordRequestStart(log, requestId, params);
    return;
  }
  const entry = log.get(requestId);
  if (!entry) {
    return;
  }
  if (method === "Network.responseReceived") {
    recordResponse(entry, params);
    return;
  }
  if (method === "Network.loadingFinished") {
    entry.finished = true;
    if (typeof params.encodedDataLength === "number") {
      entry.encodedDataLength = params.encodedDataLength;
    }
    return;
  }
  if (method === "Network.loadingFailed") {
    entry.finished = true;
    entry.failed = typeof params.errorText === "string" ? params.errorText : "failed";
  }
}

function recordRequestStart(
  log: Map<string, CapturedNetworkRequest>,
  requestId: string,
  params: Record<string, unknown>,
): void {
  const request =
    params.request && typeof params.request === "object"
      ? (params.request as Record<string, unknown>)
      : {};
  log.set(requestId, {
    requestId,
    url: typeof request.url === "string" ? request.url : "",
    method: typeof request.method === "string" ? request.method : "GET",
    ...(typeof params.type === "string" ? { resourceType: params.type } : {}),
    finished: false,
  });
  while (log.size > MAX_NETWORK_ENTRIES_PER_TAB) {
    const oldestKey = log.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }
    log.delete(oldestKey);
  }
}

function recordResponse(entry: CapturedNetworkRequest, params: Record<string, unknown>): void {
  const response =
    params.response && typeof params.response === "object"
      ? (params.response as Record<string, unknown>)
      : {};
  if (typeof response.status === "number") {
    entry.status = response.status;
  }
  if (typeof response.statusText === "string") {
    entry.statusText = response.statusText;
  }
  if (typeof response.mimeType === "string") {
    entry.mimeType = response.mimeType;
  }
}

function getCdpQueue(contentsId: number): CdpSessionQueue {
  const existing = cdpQueuesByContentsId.get(contentsId);
  if (existing) {
    return existing;
  }
  const queue = new CdpSessionQueue();
  cdpQueuesByContentsId.set(contentsId, queue);
  return queue;
}

// contentsId is captured up front rather than read off `contents` inside the
// listeners: Electron's webContents.id throws "Object has been destroyed" once
// the guest is gone, which is exactly when the destroyed handler runs. Reading
// it there throws out of the handler and leaks every map below.
function observeConsoleMessages(contents: BrowserAutomationWebContents, contentsId: number): void {
  if (observedContentsIds.has(contentsId)) {
    return;
  }
  observedContentsIds.add(contentsId);
  contents.on("console-message", (event) => {
    const entry = normalizeConsoleMessage(event);
    const messages = consoleMessagesByContentsId.get(contentsId) ?? [];
    messages.push(entry);
    consoleMessagesByContentsId.set(contentsId, messages.slice(-MAX_CONSOLE_MESSAGES_PER_TAB));
  });
  contents.once("destroyed", () => {
    observedContentsIds.delete(contentsId);
    consoleMessagesByContentsId.delete(contentsId);
    cdpQueuesByContentsId.delete(contentsId);
    dialogMonitorsByContentsId.delete(contentsId);
    networkLogByContentsId.delete(contentsId);
    networkCaptureEnabledContentsIds.delete(contentsId);
    networkObservedContentsIds.delete(contentsId);
  });
}

function getDialogMonitor(
  contents: BrowserAutomationWebContents,
  cdpQueue: CdpSessionQueue,
): DialogMonitor {
  const existing = dialogMonitorsByContentsId.get(contents.id);
  if (existing) {
    return existing;
  }
  const monitor = new DialogMonitor(contents, cdpQueue);
  dialogMonitorsByContentsId.set(contents.id, monitor);
  return monitor;
}

class DialogMonitor {
  private enabled = false;
  private listenerRegistered = false;
  private detachGeneration = 0;
  private readonly activeCollectors: DialogCollector[] = [];

  public constructor(
    private readonly contents: BrowserAutomationWebContents,
    private readonly cdpQueue: CdpSessionQueue,
  ) {}

  public async capture<T>(
    task: () => Promise<T>,
  ): Promise<{ result: T; dialogs: BrowserAutomationDialogEvent[] }> {
    const collector: DialogCollector = { dialogs: [] };
    const setupDetachGeneration = this.detachGeneration;
    try {
      await this.enable();
      await this.installPromptShim();
    } catch (error) {
      if (this.contents.isDestroyed() || this.detachGeneration !== setupDetachGeneration) {
        throw error;
      }
      console.warn("[browser-automation] Dialog capture unavailable; running command without it", {
        contentsId: this.contents.id,
        error,
      });
      return { result: await task(), dialogs: [] };
    }
    this.activeCollectors.push(collector);
    try {
      const result = await task();
      this.recordPromptShimDialogs(await this.drainPromptShim());
      return { result, dialogs: collector.dialogs };
    } finally {
      const index = this.activeCollectors.indexOf(collector);
      if (index >= 0) {
        this.activeCollectors.splice(index, 1);
      }
      if (this.activeCollectors.length === 0) {
        await this.restorePromptShim();
      }
    }
  }

  private async enable(): Promise<void> {
    if (this.enabled) {
      return;
    }
    if (!this.contents.debugger.on) {
      return;
    }
    if (!this.listenerRegistered) {
      this.listenerRegistered = true;
      this.contents.debugger.on("message", (_event, method, params) => {
        if (method !== "Page.javascriptDialogOpening") {
          return;
        }
        if (this.activeCollectors.length === 0) {
          return;
        }
        void this.handleOpening(params ?? {});
      });
      this.contents.debugger.on("detach", () => {
        this.enabled = false;
        this.detachGeneration += 1;
      });
    }
    await this.sendDebugCommand("Page.enable");
    this.enabled = true;
  }

  private async handleOpening(params: Record<string, unknown>): Promise<void> {
    const event = handledDialogEvent(params);
    for (const collector of this.activeCollectors) {
      this.recordDialogs(collector, [event]);
    }
    await this.sendDialogResponseCommand("Page.handleJavaScriptDialog", {
      accept: dialogAcceptValue(event.type),
    });
  }

  private async installPromptShim(): Promise<void> {
    await this.sendDebugCommand("Runtime.evaluate", {
      expression: promptShimInstallScript(),
      returnByValue: true,
    });
  }

  private async drainPromptShim(): Promise<BrowserAutomationDialogEvent[]> {
    try {
      const result = (await this.sendDebugCommand("Runtime.evaluate", {
        expression: promptShimDrainScript(),
        returnByValue: true,
      })) as { result?: { value?: unknown } };
      return parsePromptShimDialogs(result.result?.value);
    } catch {
      return [];
    }
  }

  private async restorePromptShim(): Promise<void> {
    try {
      await this.sendDebugCommand("Runtime.evaluate", {
        expression: promptShimRestoreScript(),
        returnByValue: true,
      });
    } catch {
      // Navigation can destroy the execution context before cleanup runs; the next page has no shim.
    }
  }

  private recordDialogs(collector: DialogCollector, dialogs: BrowserAutomationDialogEvent[]): void {
    for (const dialog of dialogs) {
      if (collector.dialogs.length >= MAX_DIALOGS_PER_COMMAND) {
        return;
      }
      collector.dialogs.push(dialog);
    }
  }

  private recordPromptShimDialogs(dialogs: BrowserAutomationDialogEvent[]): void {
    for (const collector of this.activeCollectors) {
      this.recordDialogs(collector, dialogs);
    }
  }

  private async sendDebugCommand(
    command: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    return this.cdpQueue.run(async () => {
      if (!this.contents.debugger.isAttached()) {
        this.contents.debugger.attach("1.3");
      }
      return this.contents.debugger.sendCommand(command, params ?? {});
    });
  }

  private async sendDialogResponseCommand(
    command: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    // Dialogs can block the CDP command that opened them, so the unblocker must not wait behind
    // the per-tab command queue.
    if (!this.contents.debugger.isAttached()) {
      this.contents.debugger.attach("1.3");
    }
    return this.contents.debugger.sendCommand(command, params ?? {});
  }
}

interface DialogCollector {
  dialogs: BrowserAutomationDialogEvent[];
}

function parsePromptShimDialogs(value: unknown): BrowserAutomationDialogEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry): BrowserAutomationDialogEvent[] => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const record = entry as Record<string, unknown>;
    if (record.type !== "prompt" || record.action !== "dismissed") {
      return [];
    }
    return [
      {
        type: "prompt",
        message: typeof record.message === "string" ? record.message : "",
        ...(typeof record.defaultValue === "string" ? { defaultValue: record.defaultValue } : {}),
        action: "dismissed",
        timestamp: typeof record.timestamp === "number" ? record.timestamp : Date.now(),
      },
    ];
  });
}

function capConsoleMessage(message: string): string {
  if (message.length <= MAX_CONSOLE_MESSAGE_CHARS) {
    return message;
  }
  const removed = message.length - MAX_CONSOLE_MESSAGE_CHARS;
  return `${message.slice(0, MAX_CONSOLE_MESSAGE_CHARS)} [... ${removed} characters truncated ...]`;
}

function normalizeConsoleMessage(input: ConsoleMessageEvent): BrowserAutomationConsoleLogEntry {
  return {
    level: typeof input.level === "string" ? input.level : String(input.level ?? "log"),
    message: capConsoleMessage(
      typeof input.message === "string" ? input.message : String(input.message ?? ""),
    ),
    ...(typeof input.sourceId === "string" && input.sourceId.length > 0
      ? { source: input.sourceId }
      : {}),
    ...(typeof input.lineNumber === "number" ? { line: input.lineNumber } : {}),
    timestamp: Date.now(),
  };
}

function createRegistry(hostWebContentsId: number): BrowserRegistry {
  return {
    listRegisteredBrowserIds: listRegisteredOttoBrowserIds,
    listRegisteredBrowserIdsForWorkspace: listRegisteredOttoBrowserIdsForWorkspace,
    getTabContents(browserId: string): TabContents | null {
      const contents = getOttoBrowserWebContentsForHostWindow(browserId, hostWebContentsId);
      return contents ? adaptWebContents(contents) : null;
    },
    getBrowserWorkspaceId: getOttoBrowserWorkspaceId,
    getWorkspaceActiveBrowserId(workspaceId: string): string | null {
      return getWorkspaceActiveOttoBrowserIdForHostWindow(workspaceId, hostWebContentsId);
    },
  };
}

export function registerBrowserAutomationIpc(options?: { ipc?: IpcHandlerRegistry }): void {
  const ipc = options?.ipc ?? ipcMain;
  ipc.handle("otto:browser:execute-automation-command", async (event, rawRequest: unknown) => {
    // Automation is answered by the window that asked: a browser id only
    // resolves inside its own host window now.
    const hostContents = (event as { sender?: HostWebContents }).sender;
    const hostWebContentsId = hostContents?.id;
    if (!hostContents || typeof hostWebContentsId !== "number") {
      return {
        requestId: readRequestId(rawRequest),
        ok: false as const,
        error: {
          code: "browser_unsupported" as const,
          message: "Browser automation requires a host window.",
          retryable: false,
        },
      };
    }
    const registry = createRegistry(hostWebContentsId);
    const parsed = BrowserAutomationExecuteRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      return {
        requestId: readRequestId(rawRequest),
        ok: false as const,
        error: {
          code: "browser_unsupported" as const,
          message: `Invalid automation request: ${parsed.error.message}`,
          retryable: false,
        },
      };
    }
    return executeAutomationCommand(parsed.data, registry, {
      snapshotEngine: hostSnapshotEngines.get(hostContents),
    });
  });
}

function readRequestId(rawRequest: unknown): string {
  if (typeof rawRequest !== "object" || rawRequest === null || Array.isArray(rawRequest)) {
    return "unknown";
  }
  const requestId = (rawRequest as Record<string, unknown>).requestId;
  return typeof requestId === "string" && requestId.length > 0 ? requestId : "unknown";
}
