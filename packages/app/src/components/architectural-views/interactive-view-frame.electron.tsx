import { createElement, useEffect, useRef, type CSSProperties, type ReactElement } from "react";
import { getDesktopHost, isElectronRuntime } from "@/desktop/host";
import {
  INTERACTIVE_VIEW_MESSAGE_PREFIX,
  parseInteractiveViewCommandResult,
  parseInteractiveViewGuestEvent,
  serializeInteractiveViewCommand,
  type InteractiveViewCommandResult,
} from "@/architectural-views/view-bridge";
import {
  INTERACTIVE_VIEW_NOT_READY,
  interactiveViewCommandTimeoutMs,
  type InteractiveViewFrameProps,
} from "@/components/architectural-views/interactive-view-frame-types";

type ViewWebview = HTMLElement & {
  src: string;
  isConnected: boolean;
  executeJavaScript?: (code: string) => Promise<unknown>;
  getWebContentsId?: () => number;
};

interface WebviewConsoleMessageEvent extends Event {
  message?: string;
}

const HOST_STYLE: CSSProperties = {
  display: "flex",
  flex: 1,
  width: "100%",
  height: "100%",
};

// Same isolated session as Artifacts: its own partition escapes the app
// shell's `script-src 'self'` policy so the View's inline viewer can run.
const VIEW_WEBVIEW_PARTITION = "otto-artifact-preview";

// Mirrors the daemon's artifact CSP (packages/server/src/server/artifact/
// html-validator.ts). The bootstrap's policy stays in force after the real
// document is written, so it must allow exactly what a View needs and no more.
const VIEW_BOOTSTRAP_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; " +
  "object-src 'none'; base-uri 'none'; form-action 'none'";

// A delivered View plus its embedded fonts can exceed what Electron accepts in
// a data: URL (the guest silently stays on about:blank). Load this small
// bootstrap and write the real document in, the pattern the Mermaid runtime uses.
const VIEW_BOOTSTRAP_HTML = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${VIEW_BOOTSTRAP_CSP}"><script>window.__OTTO_VIEW_LOAD__ = function (html) { document.open(); document.write(html); document.close(); };</script>`;

function toDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/**
 * Electron renderer for an Interactive View. Host commands run through
 * `executeJavaScript` and resolve with the guest's result; unsolicited guest
 * events arrive as prefixed console messages.
 */
export function InteractiveViewFrame({
  html,
  background,
  handleRef,
  onEvent,
  browserAutomation,
}: InteractiveViewFrameProps): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const webviewRef = useRef<ViewWebview | null>(null);
  const htmlRef = useRef(html);
  const awaitingBootstrapRef = useRef(false);
  const readyRef = useRef(false);
  const onEventRef = useRef(onEvent);
  const browserAutomationRef = useRef(browserAutomation);
  htmlRef.current = html;
  onEventRef.current = onEvent;
  browserAutomationRef.current = browserAutomation;

  useEffect(() => {
    handleRef.current = {
      run: async (command) => {
        const webview = webviewRef.current;
        if (!webview?.isConnected || !readyRef.current || !webview.executeJavaScript) {
          return INTERACTIVE_VIEW_NOT_READY;
        }
        let timer: ReturnType<typeof setTimeout> | null = null;
        const timeout = new Promise<InteractiveViewCommandResult>((resolve) => {
          timer = setTimeout(
            () => resolve({ ok: false, error: "The View did not respond." }),
            interactiveViewCommandTimeoutMs(command),
          );
        });
        const execution = webview
          .executeJavaScript(
            `window.__OTTO_VIEW__ ? window.__OTTO_VIEW__.run(${serializeInteractiveViewCommand(command)}) : null`,
          )
          .then(
            (raw): InteractiveViewCommandResult =>
              parseInteractiveViewCommandResult(raw) ?? INTERACTIVE_VIEW_NOT_READY,
            (error: unknown): InteractiveViewCommandResult => ({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        try {
          return await Promise.race([execution, timeout]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      },
    };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef]);

  useEffect(() => {
    if (!isElectronRuntime() || typeof document === "undefined") return;
    const host = hostRef.current;
    if (!host) return;

    const webview = document.createElement("webview") as ViewWebview;
    webview.setAttribute("partition", VIEW_WEBVIEW_PARTITION);
    webview.style.flex = "1";
    webview.style.width = "100%";
    webview.style.height = "100%";
    webview.style.border = "0";

    const handleDomReady = () => {
      // Writing the View triggers a second dom-ready; only the bootstrap pass
      // delivers the document.
      if (!awaitingBootstrapRef.current) return;
      awaitingBootstrapRef.current = false;
      void webview
        .executeJavaScript?.(`window.__OTTO_VIEW_LOAD__(${JSON.stringify(htmlRef.current)}); true;`)
        .catch(() => undefined);
    };
    const handleConsoleMessage = (event: Event) => {
      const raw = (event as WebviewConsoleMessageEvent).message;
      if (!raw?.startsWith(INTERACTIVE_VIEW_MESSAGE_PREFIX)) return;
      const message = parseInteractiveViewGuestEvent(raw);
      if (!message) return;
      if (message.type === "ready") readyRef.current = true;
      onEventRef.current(message);
    };
    const handleAttached = () => {
      const automation = browserAutomationRef.current;
      const register = getDesktopHost()?.browser?.registerAttachedBrowser;
      const webContentsId = webview.getWebContentsId?.();
      if (!automation || !register || !webContentsId) return;
      void register({ ...automation, webContentsId }).catch((error: unknown) => {
        console.error("[interactive-view] browser registration failed", error);
      });
    };

    webview.addEventListener("dom-ready", handleDomReady);
    webview.addEventListener("console-message", handleConsoleMessage);
    webview.addEventListener("did-attach", handleAttached);
    webviewRef.current = webview;
    host.appendChild(webview);

    return () => {
      webview.removeEventListener("dom-ready", handleDomReady);
      webview.removeEventListener("console-message", handleConsoleMessage);
      webview.removeEventListener("did-attach", handleAttached);
      const automation = browserAutomationRef.current;
      if (automation) {
        void getDesktopHost()?.browser?.unregisterWorkspaceBrowser?.(automation.browserId);
      }
      webview.remove();
      webviewRef.current = null;
      readyRef.current = false;
    };
  }, []);

  // Each new document (first load, draft refresh) reloads through the bootstrap.
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;
    readyRef.current = false;
    awaitingBootstrapRef.current = true;
    webview.src = toDataUrl(VIEW_BOOTSTRAP_HTML);
  }, [html]);

  useEffect(() => {
    if (webviewRef.current) webviewRef.current.style.background = background;
    if (hostRef.current) hostRef.current.style.background = background;
  }, [background]);

  return createElement("div", { ref: hostRef, style: { ...HOST_STYLE, background } });
}
