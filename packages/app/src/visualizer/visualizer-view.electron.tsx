import {
  createElement,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from "react";
import { isDev } from "@/constants/platform";
import { isElectronRuntime } from "@/desktop/host";
import {
  applyVisualizerRenderScale,
  applyVisualizerTheme,
  loadVisualizerHtml,
} from "@/visualizer/load-visualizer-html";
import type {
  VisualizerHostMessage,
  VisualizerViewHandle,
  VisualizerViewProps,
} from "@/visualizer/visualizer-view-types";

type VisualizerWebview = HTMLElement & {
  src: string;
  isConnected: boolean;
  executeJavaScript?: (code: string) => Promise<unknown>;
  openDevTools?: () => void;
  addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
  removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
};

// A dedicated, non-persistent partition (no "persist:" prefix -> in-memory
// session, cleared on app restart) — same rationale as
// artifact-html-view.electron.tsx: the app-shell CSP (script-src 'self') is
// inherited by same-document srcDoc iframes and blocks the inline bundle. A
// <webview> guest on its own session escapes that CSP. This also happens to
// be why the page's sound effects (use-audio-effects.ts) default muted here:
// the page only unmutes when localStorage[agent-viz-sound] === "on", and this
// partition's storage starts empty every app run.
const VISUALIZER_WEBVIEW_PARTITION = "otto-visualizer";

// Page -> host channel for this platform: the guest has no other IPC, so it
// logs a prefixed, JSON-encoded message and the host parses `console-message`.
const HOST_MESSAGE_PREFIX = "__OTTO_VIS__";

const HOST_STYLE: CSSProperties = {
  position: "relative",
  flex: 1,
  width: "100%",
  height: "100%",
  overflow: "hidden",
};

function toDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function executeWebviewJavaScript(webview: VisualizerWebview, code: string): Promise<unknown> {
  if (!webview.isConnected) {
    return Promise.resolve(null);
  }
  try {
    return webview.executeJavaScript?.(code) ?? Promise.resolve(null);
  } catch (error) {
    return Promise.reject(error);
  }
}

// Injected on dom-ready (not before — the guest doesn't exist yet). The page's
// own first `ready` post races this injection and is lost (it falls through
// to the entry's window.parent.postMessage fallback, which goes nowhere useful
// inside a <webview> guest); dom-ready is this platform's substitute readiness
// signal, same as the task calls out ("after ready, or webview load").
const INJECT_POST_BRIDGE_SCRIPT = `
  window.__ottoVisualizerPost = function (message) {
    console.log(${JSON.stringify(HOST_MESSAGE_PREFIX)} + JSON.stringify(message));
  };
  true;
`;

// Dev-only on-screen FPS meter, injected into the guest (the rAF loop must run
// where the canvas renders). Pinned bottom-right, just above the host-side
// debug buttons the panel overlays in that corner. Counts guest rAF ticks —
// the same loop the vendor's draw scheduler rides — so it reflects real
// render throughput, not the host's frame rate.
const INJECT_FPS_METER_SCRIPT = `
  (function () {
    if (window.__ottoVisualizerFpsMeter) return true;
    var el = document.createElement("div");
    el.style.cssText = "position:fixed;bottom:48px;right:12px;z-index:99999;" +
      "font:11px ui-monospace,monospace;color:#7fd4ff;background:rgba(5,10,20,0.7);" +
      "border:1px solid rgba(102,204,255,0.25);border-radius:4px;padding:2px 8px;" +
      "pointer-events:none;";
    el.textContent = "FPS: --";
    document.body.appendChild(el);
    window.__ottoVisualizerFpsMeter = el;
    var frames = 0;
    var last = performance.now();
    function tick(now) {
      frames++;
      if (now - last >= 1000) {
        el.textContent = "FPS: " + Math.round((frames * 1000) / (now - last));
        frames = 0;
        last = now;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    return true;
  })();
`;

/** Electron renderer for the Visualizer. Renders into a <webview> guest (its own
 * session, exempt from the app-shell CSP) so the bundle's inline scripts run. */
export const VisualizerView = forwardRef<VisualizerViewHandle, VisualizerViewProps>(
  function VisualizerView(
    { onMessage, renderScale = 1, themeJson, themeBackground },
    ref,
  ): ReactElement {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const webviewRef = useRef<VisualizerWebview | null>(null);
    const onMessageRef = useRef(onMessage);
    onMessageRef.current = onMessage;
    const [rawHtml, setRawHtml] = useState<string | null>(null);
    // executeJavaScript throws until the guest's dom-ready has fired, even once
    // the <webview> is attached to the DOM (isConnected is not enough — see
    // Electron's WebViewElement.getWebContentsId). Messages sent before that
    // (e.g. the dev-only demo button, or the adapter's first postMessage) queue
    // here and flush in handleDomReady.
    const domReadyRef = useRef(false);
    const pendingMessagesRef = useRef<string[]>([]);

    useEffect(() => {
      let cancelled = false;
      const load = async () => {
        const loaded = await loadVisualizerHtml();
        if (!cancelled) {
          setRawHtml(loaded);
        }
      };
      void load();
      return () => {
        cancelled = true;
      };
    }, []);

    // A scale or theme change produces new html; the create-effect below is
    // keyed on it, so the webview is torn down and recreated (fresh dom-ready).
    const html = useMemo(() => {
      if (rawHtml === null) {
        return null;
      }
      const scaled = applyVisualizerRenderScale(rawHtml, renderScale);
      return themeJson ? applyVisualizerTheme(scaled, themeJson) : scaled;
    }, [rawHtml, renderScale, themeJson]);
    // Read inside the [html]-keyed create effect below without re-triggering
    // it — a themeBackground change always rides an html change anyway.
    const themeBackgroundRef = useRef(themeBackground);
    themeBackgroundRef.current = themeBackground;

    useImperativeHandle(
      ref,
      () => ({
        postMessage(message) {
          const payload = JSON.stringify(message);
          const webview = webviewRef.current;
          if (!webview || !domReadyRef.current) {
            pendingMessagesRef.current.push(payload);
            return;
          }
          void executeWebviewJavaScript(
            webview,
            `window.dispatchEvent(new MessageEvent("message", { data: ${payload} })); true;`,
          );
        },
        openDevTools() {
          webviewRef.current?.openDevTools?.();
        },
      }),
      [],
    );

    // Create the webview once html is loaded and mount it into the host div.
    useEffect(() => {
      if (!isElectronRuntime() || typeof document === "undefined" || !html) {
        return;
      }
      const host = hostRef.current;
      if (!host) {
        return;
      }

      const initialRect = host.getBoundingClientRect();
      const webview = document.createElement("webview") as VisualizerWebview;
      webview.setAttribute("partition", VISUALIZER_WEBVIEW_PARTITION);
      // "autosize" turns on Electron's dynamic guest-resize tracking — without
      // it, a <webview>'s internal viewport can get stuck at whatever size it
      // first rendered at and never re-propagate later CSS box changes (width
      // syncs, height silently doesn't). Same attribute prepareBrowserWebview
      // sets for browser tabs, which resize correctly; min/max just need to be
      // wide open since we're driving the actual size ourselves below.
      webview.setAttribute("autosize", "on");
      webview.setAttribute("minwidth", "0");
      webview.setAttribute("minheight", "0");
      webview.setAttribute("maxwidth", "10000");
      webview.setAttribute("maxheight", "10000");
      // Absolute + explicit px, not flex/percentage — same technique as
      // applyResidentWebviewStyle in browser-webview-resident.ts.
      webview.style.position = "absolute";
      webview.style.left = "0";
      webview.style.top = "0";
      webview.style.width = `${Math.max(1, Math.round(initialRect.width))}px`;
      webview.style.height = `${Math.max(1, Math.round(initialRect.height))}px`;
      webview.style.border = "0";
      webview.style.background = themeBackgroundRef.current ?? "#000";
      webview.src = toDataUrl(html);
      webviewRef.current = webview;
      domReadyRef.current = false;
      pendingMessagesRef.current = [];

      const handleDomReady = () => {
        domReadyRef.current = true;
        void executeWebviewJavaScript(webview, INJECT_POST_BRIDGE_SCRIPT);
        if (isDev) {
          void executeWebviewJavaScript(webview, INJECT_FPS_METER_SCRIPT);
        }
        const pending = pendingMessagesRef.current;
        pendingMessagesRef.current = [];
        for (const payload of pending) {
          void executeWebviewJavaScript(
            webview,
            `window.dispatchEvent(new MessageEvent("message", { data: ${payload} })); true;`,
          );
        }
        onMessageRef.current?.({ type: "ready" });
      };
      const handleConsoleMessage = (event: Event) => {
        const raw = (event as Event & { message?: string }).message;
        if (typeof raw !== "string") {
          return;
        }
        if (!raw.startsWith(HOST_MESSAGE_PREFIX)) {
          // Dev diagnostics: surface guest console lines — including uncaught
          // errors/CSP violations, which Chromium also routes through
          // console-message — in the host's DevTools, since the guest is a
          // separate renderer with no other visible console.
          if (isDev) {
            // eslint-disable-next-line no-console
            console.log("[visualizer:guest]", raw);
          }
          return;
        }
        try {
          const data = JSON.parse(raw.slice(HOST_MESSAGE_PREFIX.length));
          if (data && typeof data.type === "string") {
            onMessageRef.current?.(data as VisualizerHostMessage);
          }
        } catch {
          // Malformed payload from the guest — drop it.
        }
      };
      const handleFailLoad = (event: Event) => {
        const detail = event as Event & {
          errorCode?: number;
          errorDescription?: string;
          isMainFrame?: boolean;
        };
        // -3 (ERR_ABORTED) fires on normal teardown/reload; subframe failures
        // can't happen in this single-document guest but are filtered anyway.
        if (detail.isMainFrame === false || detail.errorCode === -3) {
          return;
        }
        if (isDev) {
          // eslint-disable-next-line no-console
          console.log("[visualizer:did-fail-load]", detail.errorCode, detail.errorDescription);
        }
        // Not dev-gated: a guest that fails to load emits nothing else at all
        // (no dom-ready, no ready) — without this the panel's only symptom is
        // an eternally-opaque load cover. Machines running the Linux
        // software-rendering fallback hit exactly that. The desktop main
        // process logs the same failure durably ([visualizer-webview] in the
        // electron-log); this message drives the panel's visible error state.
        onMessageRef.current?.({
          type: "load-failed",
          reason: `did-fail-load ${detail.errorCode ?? "?"}: ${detail.errorDescription ?? "unknown"}`,
        });
      };

      webview.addEventListener("dom-ready", handleDomReady);
      webview.addEventListener("console-message", handleConsoleMessage);
      webview.addEventListener("did-fail-load", handleFailLoad);
      host.appendChild(webview);

      // Electron's <webview> does not reliably track percentage/flex-driven
      // CSS resizes of its container (unlike a same-process <iframe>) — the
      // guest's internal viewport can get stuck at whatever size it first
      // rendered at. Drive it with explicit pixel dimensions instead, same
      // technique as resizeResidentBrowserWebview in browser-webview-resident.ts.
      const resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) {
          return;
        }
        const { width, height } = entry.contentRect;
        webview.style.width = `${Math.max(1, Math.round(width))}px`;
        webview.style.height = `${Math.max(1, Math.round(height))}px`;
      });
      resizeObserver.observe(host);

      return () => {
        resizeObserver.disconnect();
        webview.removeEventListener("dom-ready", handleDomReady);
        webview.removeEventListener("console-message", handleConsoleMessage);
        webview.removeEventListener("did-fail-load", handleFailLoad);
        webview.remove();
        webviewRef.current = null;
      };
      // Recreated only when html changes — first load, or a render-scale
      // change substituting a new dpr cap (the page reads dpr once at boot,
      // so scale changes require a guest reload anyway).
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [html]);

    return createElement("div", { ref: hostRef, style: HOST_STYLE });
  },
);
