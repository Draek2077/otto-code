import mermaid from "mermaid";
import {
  parseMermaidRuntimeRenderMessage,
  type MermaidRuntimeMessage,
  type MermaidRuntimeRenderMessage,
} from "./messages";

declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage?: (data: string) => void;
    };
    __OTTO_MERMAID_RUNTIME_RECEIVE__?: (message: unknown) => void;
  }
}

function sendToHost(message: MermaidRuntimeMessage): void {
  window.ReactNativeWebView?.postMessage?.(JSON.stringify(message));
  if (window.parent !== window) {
    window.parent.postMessage(message, "*");
  }
}

function initializeMermaid(
  colorScheme: "light" | "dark",
  themeVariables: Record<string, string>,
): void {
  // `base` is the only built-in theme that honours `themeVariables`, so the app
  // palette rides in as concrete values (mermaid's khroma color math NaNs on
  // anything var()-shaped). Without variables, fall back to the stock scheme
  // theme so an empty payload still renders legibly.
  const hasAppTheme = Object.keys(themeVariables).length > 0;
  const stockTheme = colorScheme === "dark" ? "dark" : "default";
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: hasAppTheme ? "base" : stockTheme,
    ...(hasAppTheme ? { themeVariables } : {}),
    secure: [
      "secure",
      "securityLevel",
      "startOnLoad",
      "maxTextSize",
      "suppressErrorRendering",
      "maxEdges",
      "theme",
      "themeVariables",
      "themeCSS",
    ],
    flowchart: { htmlLabels: false },
    class: { htmlLabels: false },
  });
}

function setViewport(interactive: boolean): void {
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute(
      "content",
      interactive
        ? "width=device-width, initial-scale=1, maximum-scale=8"
        : "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
    );
}

/**
 * Mindmap derives its section fills with fixed HSL lightness offsets from the
 * primary palette. On Otto's warm themes several offsets become almost black,
 * while the label stays foreground-dark. Unlike flowcharts, its generated CSS
 * does not consistently honour the ordinary node/text variables. Override the
 * family once with the concrete app palette so every branch stays readable.
 */
function applyMindmapTheme(host: HTMLElement, themeVariables: Record<string, string>): void {
  const svg = host.querySelector("svg.mindmapDiagram");
  if (!svg) {
    return;
  }
  const surface = themeVariables.primaryColor;
  const border = themeVariables.primaryBorderColor;
  const foreground = themeVariables.primaryTextColor;
  const edge = themeVariables.lineColor;
  if (!surface || !border || !foreground || !edge) {
    return;
  }
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = `
    .mindmap-node rect, .mindmap-node path, .mindmap-node circle, .mindmap-node polygon {
      fill: ${surface} !important;
      stroke: ${border} !important;
    }
    .mindmap-node text, .mindmap-node .label, .mindmap-node .label *,
    .mindmap-node foreignObject, .mindmap-node foreignObject * {
      fill: ${foreground} !important;
      color: ${foreground} !important;
    }
    .edge { stroke: ${edge} !important; }
  `;
  svg.append(style);
}

/**
 * Mermaid occasionally emits `height: 100vh` and `overflow: auto` on its root
 * SVG. In an embedded Electron guest that turns the SVG itself into a tall,
 * scrollable viewport, while the host correctly reserves only the diagram's
 * natural height. Let the viewBox determine the SVG's aspect ratio and leave
 * clipping to Otto's pan/zoom viewport.
 */
function normalizeSvgViewport(host: HTMLElement): void {
  const svg = host.querySelector("svg");
  if (!svg) {
    return;
  }
  svg.style.removeProperty("height");
  svg.style.removeProperty("overflow");
}

/**
 * An Electron webview reports the dimensions of its own viewport, not the
 * rendered SVG, while the host is still measuring it. Derive the height from
 * the fitted viewBox and displayed width instead, so the host can grow the
 * webview to the diagram's full natural size on the first render.
 */
function measureDiagram(host: HTMLElement): { height: number; width: number } {
  const svg = host.querySelector("svg");
  const rect = svg?.getBoundingClientRect();
  const viewBox = svg?.viewBox.baseVal;
  const width = Math.ceil(
    rect?.width || host.clientWidth || host.scrollWidth || viewBox?.width || 1,
  );
  const height =
    viewBox && viewBox.width > 0 && viewBox.height > 0
      ? Math.ceil((width * viewBox.height) / viewBox.width)
      : Math.ceil(rect?.height || host.scrollHeight || 1);
  return { height, width };
}

let latestRevision = 0;
let pendingRender: MermaidRuntimeRenderMessage | null = null;
let isRendering = false;
let isDrainScheduled = false;

async function render(message: MermaidRuntimeRenderMessage): Promise<void> {
  try {
    initializeMermaid(message.colorScheme, message.themeVariables);
    const { svg } = await mermaid.render(`otto-mermaid-${message.revision}`, message.source);
    if (message.revision !== latestRevision) {
      return;
    }
    setViewport(message.interactive);
    const host = document.getElementById("diagram");
    if (!host) {
      return;
    }
    host.innerHTML = svg;
    applyMindmapTheme(host, message.themeVariables);
    normalizeSvgViewport(host);
    const dimensions = measureDiagram(host);
    const renderedSvg = host.querySelector("svg")?.outerHTML;
    sendToHost({
      type: "rendered",
      revision: message.revision,
      source: message.source,
      themeKey: message.themeKey,
      ...dimensions,
      ...(renderedSvg ? { svg: renderedSvg } : {}),
    });
  } catch {
    if (message.revision === latestRevision) {
      sendToHost({ type: "renderError", revision: message.revision });
    }
  }
}

async function drainRenderQueue(): Promise<void> {
  if (isRendering) {
    return;
  }
  isRendering = true;
  try {
    while (pendingRender) {
      const next = pendingRender;
      pendingRender = null;
      await render(next);
    }
  } finally {
    isRendering = false;
  }
}

function receiveRender(value: unknown): void {
  const message = parseMermaidRuntimeRenderMessage(value);
  if (!message) {
    return;
  }
  latestRevision = message.revision;
  pendingRender = message;
  if (isRendering || isDrainScheduled) {
    return;
  }
  isDrainScheduled = true;
  window.setTimeout(() => {
    isDrainScheduled = false;
    void drainRenderQueue();
  }, 0);
}

window.__OTTO_MERMAID_RUNTIME_RECEIVE__ = receiveRender;
window.addEventListener("message", (event) => {
  if (event.source === window.parent) {
    receiveRender(event.data);
  }
});

sendToHost({ type: "bridgeReady" });
