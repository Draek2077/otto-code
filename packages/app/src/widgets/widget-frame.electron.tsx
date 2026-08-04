import { createElement, useEffect, useRef, type CSSProperties, type ReactElement } from "react";
import { parseWidgetGuestMessage } from "@otto-code/protocol/widgets/bridge";
import { isElectronRuntime } from "@/desktop/host";
import type { WidgetFrameProps } from "./widget-frame-types";

interface WidgetWebview extends HTMLElement {
  src: string;
}

interface WebviewIpcMessageEvent extends Event {
  channel: string;
  args: unknown[];
}

/**
 * Must match WIDGET_WEBVIEW_PARTITION in
 * packages/desktop/src/features/widget-webview.ts. The main process keys off
 * this partition to recognize a widget attach - and, crucially, to install the
 * widget preload itself. The renderer never names a preload path: main.ts
 * deletes whatever the renderer asked for and substitutes its own known-good
 * file, so a compromised renderer cannot point the guest at arbitrary code.
 */
const WIDGET_WEBVIEW_PARTITION = "otto-widget-preview";

/** Channel the preload sends guest frames on. */
const WIDGET_IPC_CHANNEL = "otto-widget";

const HOST_STYLE: CSSProperties = { display: "block", width: "100%" };

/**
 * Electron widget renderer.
 *
 * A `<webview>` guest rather than an iframe, for the reason recorded on
 * artifact-html-view.electron.tsx: the app shell's `script-src 'self'` CSP is
 * injected onto defaultSession and is INHERITED by same-document iframes, so a
 * plain `srcDoc` iframe has its inline scripts blocked here. A guest on its own
 * session escapes that - and a widget without scripts has no bridge and no
 * height reporting, so this is not optional on desktop.
 */
export function WidgetFrame({
  html,
  widgetId,
  height,
  onGuestMessage,
}: WidgetFrameProps): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const webviewRef = useRef<WidgetWebview | null>(null);
  const onGuestMessageRef = useRef(onGuestMessage);
  onGuestMessageRef.current = onGuestMessage;
  const widgetIdRef = useRef(widgetId);
  widgetIdRef.current = widgetId;

  useEffect(() => {
    if (!isElectronRuntime() || typeof document === "undefined") {
      return;
    }
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const webview = document.createElement("webview") as WidgetWebview;
    webview.setAttribute("partition", WIDGET_WEBVIEW_PARTITION);
    webview.style.width = "100%";
    webview.style.border = "0";
    webview.style.background = "transparent";
    webview.src = toDataUrl(html);

    const handleIpc = (event: Event) => {
      const ipcEvent = event as WebviewIpcMessageEvent;
      if (ipcEvent.channel !== WIDGET_IPC_CHANNEL) {
        return;
      }
      const message = parseWidgetGuestMessage(ipcEvent.args?.[0]);
      if (message && message.widgetId === widgetIdRef.current) {
        onGuestMessageRef.current(message);
      }
    };
    webview.addEventListener("ipc-message", handleIpc);

    webviewRef.current = webview;
    host.appendChild(webview);

    return () => {
      webview.removeEventListener("ipc-message", handleIpc);
      webview.remove();
      webviewRef.current = null;
    };
    // Created once. Content updates go through the effect below so a
    // re-rendered widget does not tear down and recreate its guest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const webview = webviewRef.current;
    if (webview) {
      webview.src = toDataUrl(html);
    }
  }, [html]);

  // Height rides on the <webview> element, not the host div, so the guest's
  // own reported height is what sizes the box the chat lays out.
  useEffect(() => {
    const webview = webviewRef.current;
    if (webview) {
      webview.style.height = `${height}px`;
    }
  }, [height]);

  return createElement("div", { ref: hostRef, style: HOST_STYLE });
}

function toDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
