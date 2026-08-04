import type { MermaidWebViewInbound, MermaidWebViewOutbound } from "../mermaid-contract";
import { renderMermaid } from "../mermaid-render";

// Runs inside the native react-native-webview. There is no DOM on iOS/Android,
// so mermaid lives here instead - the same recipe as the CM6 editor and the
// terminal emulator (see scripts/build-mermaid-webview-html.mjs, which esbuilds
// this entry into a self-contained HTML string).
//
// One diagram per webview. The host posts `render` and gets back the laid-out
// height so it can size the WebView; nothing in here ever reaches the network.

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage?: (data: string) => void };
    __OTTO_MERMAID_WEBVIEW_RECEIVE__?: (message: MermaidWebViewInbound) => void;
  }
}

const sendToNative = (message: MermaidWebViewOutbound): void => {
  window.ReactNativeWebView?.postMessage?.(JSON.stringify(message));
};

const installStyles = (): void => {
  const style = document.createElement("style");
  style.textContent = `
html,
body {
  margin: 0;
  padding: 0;
  overflow: hidden;
  overscroll-behavior: none;
  -webkit-text-size-adjust: 100%;
}
#mermaid-root {
  width: 100%;
}
/* The webview has no width to spare, so a diagram scales down to fit rather
   than keeping its natural size the way the web host allows. */
#mermaid-root svg {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0 auto;
}
`;
  document.head.appendChild(style);
};

const root = (): HTMLElement | null => document.getElementById("mermaid-root");

const measureHeight = (): number => {
  const element = root();
  if (!element) return 0;
  return Math.ceil(element.getBoundingClientRect().height);
};

let lastReportedHeight = 0;

const reportResize = (): void => {
  const height = measureHeight();
  if (height > 0 && height !== lastReportedHeight) {
    lastReportedHeight = height;
    sendToNative({ type: "resized", height });
  }
};

const render = async (message: MermaidWebViewInbound) => {
  const element = root();
  if (!element) return;
  document.body.style.background = message.theme.background;

  try {
    const result = await renderMermaid(message.code, message.theme);
    element.innerHTML = result.svg;
    // Two frames: one for the browser to lay the SVG out, one so the measured
    // height is the settled one.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const height = measureHeight();
        lastReportedHeight = height;
        sendToNative({ type: "rendered", requestId: message.requestId, height });
      });
    });
  } catch (error) {
    element.innerHTML = "";
    lastReportedHeight = 0;
    sendToNative({
      type: "error",
      requestId: message.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

const boot = (): void => {
  installStyles();
  const element = document.createElement("div");
  element.id = "mermaid-root";
  document.body.appendChild(element);

  window.__OTTO_MERMAID_WEBVIEW_RECEIVE__ = (message: MermaidWebViewInbound): void => {
    if (message.type === "render") {
      void render(message);
    }
  };

  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(reportResize).observe(element);
  } else {
    window.addEventListener("resize", reportResize);
  }

  sendToNative({ type: "ready" });
};

boot();
