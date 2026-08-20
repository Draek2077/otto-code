// Otto's browser-automation commands (network capture, DOM inspect, page
// text, color scheme) with their script builders and parsers, the
// screenshot scaling cluster, and the shared command plumbing relocated
// from the Paseo service shell (which imports it back for its own
// handlers). Type-only imports from service.ts are erased at runtime, so
// there is no module cycle. The element-screenshot command stays in the
// shell: it rides Paseo's pixel-capture engine and its serialization
// queue, whose golden consumers stay there.
import {
  BrowserAutomationErrorCode,
  BrowserAutomationNetworkRequestEntry,
  BrowserAutomationTabInfo,
} from "@otto-code/protocol/browser-automation/rpc-schemas";
import { BrowserSnapshotEngine } from "./snapshot-engine.js";
import type {
  AutomationCommandPayload,
  BrowserRegistry,
  CapturedNetworkRequest,
  TabContents,
  TabImage,
} from "./service.js";

// Duplicated from service.ts (keep in sync): FailurePayload is a private
// 1-line alias there, and this module must not value-import the Paseo file.
type FailurePayload = Extract<AutomationCommandPayload, { ok: false }>;

export function fail(
  requestId: string,
  code: BrowserAutomationErrorCode,
  message: string,
  retryable = false,
): FailurePayload {
  return { requestId, ok: false, error: { code, message, retryable } };
}

export async function withDialogCapture(
  contents: TabContents,
  task: () => Promise<AutomationCommandPayload>,
): Promise<AutomationCommandPayload> {
  if (!contents.captureDialogs) {
    return task();
  }
  const { result, dialogs } = await contents.captureDialogs(task);
  return dialogs.length > 0 ? { ...result, dialogs } : result;
}

export function staleRefFailure(requestId: string, ref: string): FailurePayload {
  return fail(
    requestId,
    "browser_stale_ref",
    `Browser element reference ${ref} is stale. Take a new snapshot and try again.`,
  );
}

export function evaluateErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return capEvaluateErrorMessage(message);
}

export function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function resolveTabTarget(input: {
  requestId: string;
  workspaceId: string | undefined;
  browserId: string;
  registry: BrowserRegistry;
}): ResolvedTabTarget | FailurePayload {
  const { requestId, workspaceId, browserId, registry } = input;
  if (workspaceId && registry.getBrowserWorkspaceId(browserId) !== workspaceId) {
    return fail(requestId, "browser_tab_not_found", `No browser tab found for ID: ${browserId}`);
  }

  const contents = registry.getTabContents(browserId);
  if (!contents) {
    // Registered but its webview has not attached yet. browser_list_tabs reports
    // this tab as `starting`, so the answer is "wait and use the SAME id", never
    // "open another tab" - hence retryable.
    return fail(
      requestId,
      "browser_tab_not_found",
      `Browser tab ${browserId} is registered but its view is not attached yet. Retry the same browserId shortly.`,
      true,
    );
  }

  if (contents.isDestroyed()) {
    return fail(requestId, "browser_tab_closed", `Browser tab ${browserId} has been closed`);
  }

  return { browserId, contents };
}

interface ResolvedTabTarget {
  browserId: string;
  contents: TabContents;
}

export function capEvaluateErrorMessage(message: string): string {
  return message.length <= MAX_EVALUATE_ERROR_MESSAGE_LENGTH
    ? message
    : message.slice(0, MAX_EVALUATE_ERROR_MESSAGE_LENGTH);
}

const MAX_EVALUATE_ERROR_MESSAGE_LENGTH = 2_000;

export type TabInfo = BrowserAutomationTabInfo;

/**
 * A registered tab whose webview we cannot talk to right now. It still gets a
 * row: dropping it is what makes a tab the user is looking at read as "closed",
 * which is how callers end up opening a duplicate. `url`/`title` are empty
 * because only the live webview knows them; `status` says why.
 */
export function tabInfoWithoutContents(
  browserId: string,
  activeBrowserId: string | null,
  workspaceId: string | null,
  status: "starting" | "detached",
): TabInfo {
  return {
    browserId,
    ...(workspaceId ? { workspaceId } : {}),
    url: "",
    title: "",
    isActive: activeBrowserId === browserId,
    isLoading: false,
    status,
  };
}

/**
 * Vision-model legibility budget. Frontier vision APIs downscale images past
 * ~1568px on the long edge / ~1.15 megapixels before the model sees them, and
 * token cost scales with pixel area - so anything we send beyond this budget
 * costs more AND reads worse. Captures are normalized to CSS pixels (undoing
 * device-pixel-ratio inflation) and then scaled to fit this budget host-side,
 * where we can do it once, deliberately, instead of letting each provider's
 * API crush the image.
 */
export const SCREENSHOT_MAX_LONG_EDGE = 1568;

export const SCREENSHOT_MAX_PIXELS = 1_150_000;

/**
 * Scale factor that fits width×height (CSS px) inside the legibility budget.
 * Always ≤ 1 - callers that want to zoom IN (element captures) invert it.
 */
export function screenshotFitScale(width: number, height: number): number {
  if (width <= 0 || height <= 0) {
    return 1;
  }
  return Math.min(
    1,
    SCREENSHOT_MAX_LONG_EDGE / Math.max(width, height),
    Math.sqrt(SCREENSHOT_MAX_PIXELS / (width * height)),
  );
}

export function roundScale(scale: number): number {
  return Math.round(scale * 1000) / 1000;
}

const VIEWPORT_METRICS_SCRIPT = String.raw`(() => {
  const __OTTO_VIEWPORT_METRICS__ = true;
  return { cssWidth: window.innerWidth || 0, cssHeight: window.innerHeight || 0 };
})()`;

export async function readCssViewportSize(
  contents: TabContents,
): Promise<{ width: number; height: number } | null> {
  let raw: unknown;
  try {
    raw = await contents.executeJavaScript(VIEWPORT_METRICS_SCRIPT);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const width = readNumber(record.cssWidth);
  const height = readNumber(record.cssHeight);
  if (width === null || height === null || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

/**
 * Normalize a captured viewport image to CSS pixels, then fit it to the
 * legibility budget. Undoing device-pixel-ratio inflation is the key move: a
 * 2x display doubles every dimension for zero extra legibility once the
 * vision API downscales, quadrupling token cost while shrinking text.
 */
export function normalizeViewportImage(
  image: TabImage,
  cssViewport: { width: number; height: number } | null,
): { image: TabImage; scale?: number } {
  const size = image.getSize();
  const reference = cssViewport ?? size;
  const fit = screenshotFitScale(reference.width, reference.height);
  const targetWidth = Math.max(1, Math.round(reference.width * fit));
  const targetHeight = Math.max(1, Math.round(reference.height * fit));
  if (targetWidth >= size.width || !image.resize) {
    // Nothing to shrink (or the host image can't resize): report the capture
    // as-is, noting the scale only when the budget actually bound.
    return fit < 1 && cssViewport ? { image, scale: roundScale(fit) } : { image };
  }
  const resized = image.resize({ width: targetWidth, height: targetHeight });
  return fit < 1 ? { image: resized, scale: roundScale(fit) } : { image: resized };
}

/** Computed properties returned by inspect when the caller doesn't ask for specific ones. */
const INSPECT_DEFAULT_STYLE_PROPS = [
  "color",
  "background-color",
  "font-size",
  "font-family",
  "font-weight",
  "line-height",
  "padding",
  "margin",
  "border",
  "border-radius",
  "display",
  "position",
  "width",
  "height",
  "opacity",
  "visibility",
];

interface InspectScriptSuccess {
  status: "ok";
  matchCount: number;
  tagName: string;
  id: string;
  className: string;
  text: string;
  box: { x: number; y: number; width: number; height: number };
  styles: Record<string, string>;
}

type InspectScriptResult =
  | InspectScriptSuccess
  | { status: "not_found"; matchCount: number }
  | { status: "error"; message: string };

function buildInspectScript(
  elementExpression: string,
  matchCountExpression: string,
  styleProps: string[],
): string {
  return String.raw`(() => {
    try {
      const el = ${elementExpression};
      const matchCount = ${matchCountExpression};
      if (!el) {
        return JSON.stringify({ status: "not_found", matchCount: matchCount || 0 });
      }
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const styles = {};
      for (const prop of ${JSON.stringify(styleProps)}) {
        styles[prop] = cs.getPropertyValue(prop);
      }
      return JSON.stringify({
        status: "ok",
        matchCount: matchCount || 1,
        tagName: el.tagName || "",
        id: el.id || "",
        className: typeof el.className === "string" ? el.className : String(el.className || ""),
        text: (el.textContent || "").trim().slice(0, 200),
        box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        styles,
      });
    } catch (error) {
      const message = error && error.message ? String(error.message) : String(error);
      return JSON.stringify({ status: "error", message });
    }
  })()`;
}

function parseInspectScriptResult(raw: unknown): InspectScriptResult | null {
  if (typeof raw !== "string") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (record.status === "error" && typeof record.message === "string") {
    return { status: "error", message: record.message };
  }
  if (record.status === "not_found" && typeof record.matchCount === "number") {
    return { status: "not_found", matchCount: record.matchCount };
  }
  if (record.status !== "ok") {
    return null;
  }
  return parseInspectSuccess(record);
}

function parseInspectSuccess(record: Record<string, unknown>): InspectScriptSuccess | null {
  const box = record.box as Record<string, unknown> | undefined;
  const styles = record.styles as Record<string, unknown> | undefined;
  if (
    typeof record.matchCount !== "number" ||
    typeof record.tagName !== "string" ||
    typeof record.id !== "string" ||
    typeof record.className !== "string" ||
    typeof record.text !== "string" ||
    !box ||
    typeof box.x !== "number" ||
    typeof box.y !== "number" ||
    typeof box.width !== "number" ||
    typeof box.height !== "number" ||
    !styles
  ) {
    return null;
  }
  const styleEntries = Object.entries(styles).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return {
    status: "ok",
    matchCount: record.matchCount,
    tagName: record.tagName,
    id: record.id,
    className: record.className,
    text: record.text,
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
    styles: Object.fromEntries(styleEntries),
  };
}

export async function executeInspect(
  requestId: string,
  workspaceId: string | undefined,
  args: { browserId: string; selector?: string; ref?: string; styles?: string[] },
  registry: BrowserRegistry,
  snapshotEngine: BrowserSnapshotEngine,
): Promise<AutomationCommandPayload> {
  const target = resolveTabTarget({ requestId, workspaceId, browserId: args.browserId, registry });
  if ("ok" in target) {
    return target;
  }
  return withDialogCapture(target.contents, async () => {
    let elementExpression: string;
    let matchCountExpression: string;
    if (args.ref) {
      const expression = snapshotEngine.runtimeElementExpression({
        browserId: target.browserId,
        ref: args.ref,
      });
      if (typeof expression !== "string") {
        return staleRefFailure(requestId, args.ref);
      }
      elementExpression = expression;
      matchCountExpression = "1";
    } else {
      const selectorJson = JSON.stringify(args.selector ?? "");
      elementExpression = `document.querySelector(${selectorJson})`;
      matchCountExpression = `document.querySelectorAll(${selectorJson}).length`;
    }

    let raw: unknown;
    try {
      raw = await target.contents.executeJavaScript(
        buildInspectScript(
          elementExpression,
          matchCountExpression,
          args.styles && args.styles.length > 0 ? args.styles : INSPECT_DEFAULT_STYLE_PROPS,
        ),
      );
    } catch (error) {
      return fail(requestId, "browser_unknown_error", evaluateErrorMessage(error));
    }

    const parsed = parseInspectScriptResult(raw);
    if (!parsed) {
      return fail(requestId, "browser_unknown_error", "inspect returned an unexpected result");
    }
    if (parsed.status === "error") {
      return fail(requestId, "browser_unknown_error", parsed.message);
    }
    if (parsed.status === "not_found") {
      if (args.ref) {
        return staleRefFailure(requestId, args.ref);
      }
      return fail(
        requestId,
        "browser_element_not_found",
        `No element matched selector: ${args.selector}`,
      );
    }
    return {
      requestId,
      ok: true,
      result: {
        command: "inspect",
        browserId: target.browserId,
        ...(args.selector ? { selector: args.selector } : {}),
        ...(args.ref ? { ref: args.ref } : {}),
        matchCount: parsed.matchCount,
        tagName: parsed.tagName,
        id: parsed.id,
        className: parsed.className,
        text: parsed.text,
        box: parsed.box,
        styles: parsed.styles,
      },
    };
  });
}

const MAX_NETWORK_LIST_ENTRIES = 100;

const MAX_NETWORK_BODY_CHARS = 30_000;

function toNetworkRequestEntry(
  entry: CapturedNetworkRequest,
): BrowserAutomationNetworkRequestEntry {
  return {
    requestId: entry.requestId,
    url: entry.url,
    method: entry.method,
    finished: entry.finished,
    ...(entry.resourceType !== undefined ? { resourceType: entry.resourceType } : {}),
    ...(entry.status !== undefined ? { status: entry.status } : {}),
    ...(entry.statusText !== undefined ? { statusText: entry.statusText } : {}),
    ...(entry.mimeType !== undefined ? { mimeType: entry.mimeType } : {}),
    ...(entry.encodedDataLength !== undefined
      ? { encodedDataLength: entry.encodedDataLength }
      : {}),
    ...(entry.failed !== undefined ? { failed: entry.failed } : {}),
  };
}

export async function executeNetwork(
  requestId: string,
  workspaceId: string | undefined,
  args: { browserId: string; filter: "all" | "failed"; requestId?: string },
  registry: BrowserRegistry,
): Promise<AutomationCommandPayload> {
  const target = resolveTabTarget({ requestId, workspaceId, browserId: args.browserId, registry });
  if ("ok" in target) {
    return target;
  }
  const { contents } = target;
  if (
    !contents.startNetworkCapture ||
    !contents.getNetworkRequests ||
    !contents.getNetworkResponseBody
  ) {
    return fail(
      requestId,
      "browser_unsupported",
      "Network capture is not supported by this browser host.",
    );
  }
  return withDialogCapture(contents, async () => {
    try {
      await contents.startNetworkCapture?.();
    } catch (error) {
      return fail(
        requestId,
        "browser_unknown_error",
        `Failed to start network capture: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (args.requestId) {
      let body: { body: string; base64Encoded: boolean } | null = null;
      try {
        body = (await contents.getNetworkResponseBody?.(args.requestId)) ?? null;
      } catch (error) {
        return fail(
          requestId,
          "browser_unknown_error",
          `Failed to fetch response body: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (!body) {
        return fail(
          requestId,
          "browser_unknown_error",
          `No captured request with id ${args.requestId} - call browser_network without requestId to list captured requests.`,
        );
      }
      const truncated = body.body.length > MAX_NETWORK_BODY_CHARS;
      return {
        requestId,
        ok: true,
        result: {
          command: "network",
          browserId: target.browserId,
          body: {
            requestId: args.requestId,
            body: truncated ? body.body.slice(0, MAX_NETWORK_BODY_CHARS) : body.body,
            base64Encoded: body.base64Encoded,
            truncated,
          },
        },
      };
    }

    let requests = contents.getNetworkRequests?.() ?? [];
    if (args.filter === "failed") {
      requests = requests.filter(
        (entry) =>
          entry.failed !== undefined || (entry.status !== undefined && entry.status >= 400),
      );
    }
    return {
      requestId,
      ok: true,
      result: {
        command: "network",
        browserId: target.browserId,
        requests: requests.slice(-MAX_NETWORK_LIST_ENTRIES).map(toNetworkRequestEntry),
      },
    };
  });
}

const PAGE_TEXT_SOURCES = new Set(["article", "main", "body"]);

/**
 * Reader-mode extraction: prefer the page's article/main landmark so the agent
 * pays tokens for the content, not the chrome. Falls back to the full body.
 */
function buildPageTextScript(maxChars: number): string {
  return String.raw`(() => {
    const pick = () => {
      const article = document.querySelector('article');
      if (article && (article.innerText || '').trim().length > 0) {
        return { source: 'article', element: article };
      }
      const main = document.querySelector('main') || document.querySelector('[role="main"]');
      if (main && (main.innerText || '').trim().length > 0) {
        return { source: 'main', element: main };
      }
      return { source: 'body', element: document.body };
    };
    const { source, element } = pick();
    const full = (element && element.innerText) || '';
    const truncated = full.length > ${maxChars};
    return JSON.stringify({
      source,
      text: truncated ? full.slice(0, ${maxChars}) : full,
      truncated,
    });
  })()`;
}

interface PageTextScriptResult {
  source: "article" | "main" | "body";
  text: string;
  truncated: boolean;
}

function parsePageTextScriptResult(raw: unknown): PageTextScriptResult | null {
  if (typeof raw !== "string") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.source !== "string" ||
    !PAGE_TEXT_SOURCES.has(record.source) ||
    typeof record.text !== "string" ||
    typeof record.truncated !== "boolean"
  ) {
    return null;
  }
  return {
    source: record.source as PageTextScriptResult["source"],
    text: record.text,
    truncated: record.truncated,
  };
}

export async function executePageText(
  requestId: string,
  workspaceId: string | undefined,
  browserId: string,
  maxChars: number,
  registry: BrowserRegistry,
): Promise<AutomationCommandPayload> {
  const target = resolveTabTarget({ requestId, workspaceId, browserId, registry });
  if ("ok" in target) {
    return target;
  }
  return withDialogCapture(target.contents, async () => {
    let raw: unknown;
    try {
      raw = await target.contents.executeJavaScript(buildPageTextScript(maxChars));
    } catch (error) {
      return fail(requestId, "browser_unknown_error", evaluateErrorMessage(error));
    }
    const parsed = parsePageTextScriptResult(raw);
    if (!parsed) {
      return fail(requestId, "browser_unknown_error", "page_text returned an unexpected result");
    }
    return {
      requestId,
      ok: true,
      result: {
        command: "page_text",
        browserId: target.browserId,
        url: target.contents.getURL(),
        title: target.contents.getTitle(),
        source: parsed.source,
        text: parsed.text,
        truncated: parsed.truncated,
      },
    };
  });
}

export async function executeSetColorScheme(
  requestId: string,
  workspaceId: string | undefined,
  browserId: string,
  colorScheme: "light" | "dark" | "auto",
  registry: BrowserRegistry,
): Promise<AutomationCommandPayload> {
  const target = resolveTabTarget({ requestId, workspaceId, browserId, registry });
  if ("ok" in target) {
    return target;
  }
  if (!target.contents.sendDebugCommand) {
    return fail(
      requestId,
      "browser_unsupported",
      "Color-scheme emulation requires CDP on this browser host.",
    );
  }
  try {
    // "auto" clears the override so the page follows the real OS preference.
    await target.contents.sendDebugCommand("Emulation.setEmulatedMedia", {
      features: [
        { name: "prefers-color-scheme", value: colorScheme === "auto" ? "" : colorScheme },
      ],
    });
  } catch (error) {
    return fail(
      requestId,
      "browser_unknown_error",
      error instanceof Error ? error.message : String(error),
    );
  }
  return {
    requestId,
    ok: true,
    result: {
      command: "set_color_scheme",
      browserId: target.browserId,
      colorScheme,
    },
  };
}
