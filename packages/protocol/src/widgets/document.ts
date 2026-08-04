import { WIDGET_BRIDGE_CHANNEL } from "./bridge.js";
import { buildWidgetIconRules } from "./icons.js";
import { buildWidgetThemeVariables, type WidgetThemeInput } from "./theme.js";
import type { WidgetPayload } from "./types.js";

/**
 * Assembles the document a widget guest actually loads.
 *
 * Shared by all three renderers (native WebView, web iframe, Electron
 * <webview>) so the CSP, the host stylesheet and the bridge bootstrap cannot
 * drift apart per platform - a widget that works in one has to work in all of
 * them.
 */

/**
 * No network. At all.
 *
 * Claude's widget host permits five public CDNs plus Google Fonts, which is
 * what makes its `chart` module's Chart.js/D3 vocabulary work. Otto does not
 * follow it, for three reasons that all point the same way:
 *
 *   1. A widget rendered on a phone over the relay cannot reach a daemon-local
 *      asset origin, so any "serve it ourselves" scheme degrades in exactly the
 *      case Otto exists for.
 *   2. Inlining a library per widget puts 200-400KB into the timeline on every
 *      call, re-sent on every backfill.
 *   3. A model-authored fragment may be reflecting content the model read from
 *      a hostile file or page, and an outbound URL is a payload.
 *
 * The fragment therefore gets inline script/style and data: assets, and nothing
 * else. Charts are hand-rolled SVG - the contract document says so plainly, and
 * a blocked resource surfaces as a visible error rather than a blank box.
 */
const WIDGET_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; " +
  "object-src 'none'; base-uri 'none'; form-action 'none'";

/** Host→guest handshake that hands over the web transport's MessagePort. */
export const WIDGET_PORT_HANDSHAKE = "otto.widget.port.v1";

const BASE_RULES = `
*, *::before, *::after { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: transparent;
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.5;
  /* The chat scrolls; the widget never does. Height is content-driven and
     reported to the host, so an inner scroller would hide content behind a
     frame that is already exactly as tall as it needs to be. */
  overflow: hidden;
}
body { display: block; width: 100%; }
h1, h2, h3, h4 { margin: 0 0 var(--gap-sm); line-height: 1.25; font-weight: 600; }
h1 { font-size: 20px; }
h2 { font-size: 17px; }
h3 { font-size: 15px; }
p { margin: 0 0 var(--gap-sm); }
p:last-child { margin-bottom: 0; }
code, pre, kbd, samp { font-family: var(--font-mono); font-size: 0.92em; }
pre { margin: 0; overflow-x: auto; }
a { color: var(--text-accent); text-decoration: none; cursor: pointer; }
a:hover { text-decoration: underline; }
button { font: inherit; color: inherit; cursor: pointer; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: var(--pad-sm); border-bottom: 1px solid var(--border); }
th { color: var(--text-secondary); font-weight: 600; }
img, svg, canvas, video { max-width: 100%; }
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}
/* SVG palette. \`c-\` fills, \`s-\` strokes; \`t\`/\`ts\`/\`th\` are the three text
   weights, matching the HTML \`--text-*\` ladder so a diagram and a paragraph
   agree about emphasis. */
.t { fill: var(--text-primary); }
.ts { fill: var(--text-secondary); }
.th { fill: var(--text-muted); }
svg text { font-family: var(--font-sans); }
`;

function buildPaletteRules(): string {
  const names = ["blue", "teal", "amber", "red", "green", "purple", "pink", "gray"];
  return names
    .map((name) => `.c-${name}{fill:var(--c-${name});}\n.s-${name}{stroke:var(--c-${name});}`)
    .join("\n");
}

/**
 * The guest-side bridge.
 *
 * Defines the two host globals the contract promises, reports content height,
 * and routes link clicks. Written as a plain string rather than a bundled
 * module because it has to run inside a `data:`/`srcDoc` document with no
 * loader, and because keeping it readable here is the only way it stays
 * reviewable.
 */
function buildBootstrap(widgetId: string): string {
  return `
(function () {
  var CHANNEL = ${JSON.stringify(WIDGET_BRIDGE_CHANNEL)};
  var WIDGET_ID = ${JSON.stringify(widgetId)};
  var HANDSHAKE = ${JSON.stringify(WIDGET_PORT_HANDSHAKE)};
  var port = null;
  var queued = [];

  function deliver(payload) {
    var text = JSON.stringify(payload);
    // Electron: a preload on the guest's own session exposes exactly this one
    // function and nothing else (no ipcRenderer, no node).
    if (window.__ottoWidgetHost && typeof window.__ottoWidgetHost.post === "function") {
      window.__ottoWidgetHost.post(text);
      return true;
    }
    // Native: react-native-webview's injected bridge.
    if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === "function") {
      window.ReactNativeWebView.postMessage(text);
      return true;
    }
    // Web: the MessagePort the host transferred in. Validating on port identity
    // is the point - this iframe has no allow-same-origin, so its origin is
    // "null" and event.origin can prove nothing.
    if (port) {
      port.postMessage(payload);
      return true;
    }
    return false;
  }

  function post(payload) {
    if (!deliver(payload)) {
      if (queued.length < 32) { queued.push(payload); }
    }
  }

  window.addEventListener("message", function (event) {
    if (event.data !== HANDSHAKE || !event.ports || !event.ports[0]) { return; }
    port = event.ports[0];
    var pending = queued;
    queued = [];
    for (var i = 0; i < pending.length; i += 1) { deliver(pending[i]); }
  });

  var lastHeight = -1;
  var frame = 0;
  function measure() {
    var doc = document.documentElement;
    var body = document.body;
    // Take the max rather than documentElement alone: a fragment that puts
    // content in an absolutely-positioned or floated box can leave the root's
    // own height behind what is actually painted.
    var height = Math.max(
      doc ? doc.scrollHeight : 0,
      body ? body.scrollHeight : 0,
      body ? body.offsetHeight : 0
    );
    if (height === lastHeight) { return; }
    lastHeight = height;
    post({ channel: CHANNEL, widgetId: WIDGET_ID, type: "height", px: height });
  }
  function scheduleMeasure() {
    if (frame) { return; }
    frame = requestAnimationFrame(function () { frame = 0; measure(); });
  }

  if (typeof ResizeObserver === "function") {
    var observer = new ResizeObserver(scheduleMeasure);
    observer.observe(document.documentElement);
    if (document.body) { observer.observe(document.body); }
  }
  window.addEventListener("load", scheduleMeasure);
  // Fonts and late layout settle after load; a short poll costs nothing and
  // catches the cases the observer misses (image decode, script-built DOM).
  var polls = 0;
  var poll = setInterval(function () {
    polls += 1;
    measure();
    if (polls > 20) { clearInterval(poll); }
  }, 150);
  scheduleMeasure();

  window.sendPrompt = function (text) {
    if (typeof text !== "string") { return; }
    var trimmed = text.trim();
    if (!trimmed) { return; }
    post({ channel: CHANNEL, widgetId: WIDGET_ID, type: "prompt", text: trimmed });
  };

  window.openLink = function (url) {
    if (typeof url !== "string" || !url) { return; }
    post({ channel: CHANNEL, widgetId: WIDGET_ID, type: "open_link", url: url });
  };

  // Plain <a href> clicks route through the same confirmation path as
  // openLink(). Nothing in a widget navigates the guest itself.
  document.addEventListener("click", function (event) {
    var node = event.target;
    while (node && node !== document.body) {
      if (node.tagName === "A" && node.getAttribute("href")) {
        event.preventDefault();
        window.openLink(node.getAttribute("href"));
        return;
      }
      node = node.parentNode;
    }
  }, true);

  window.addEventListener("error", function (event) {
    post({
      channel: CHANNEL,
      widgetId: WIDGET_ID,
      type: "error",
      message: String((event && event.message) || "Widget script error")
    });
  });
})();
`;
}

export interface BuildWidgetDocumentInput {
  payload: WidgetPayload;
  theme: WidgetThemeInput;
}

/**
 * Wrap a sanitized fragment into the full guest document.
 *
 * The fragment is inserted verbatim - it was already sanitized daemon-side
 * (`packages/server/src/server/widget/widget-fragment.ts`) and the CSP plus the
 * per-platform sandbox are what actually contain it. Re-parsing it here would
 * add a second, weaker sanitizer that only ever disagrees with the first.
 */
export function buildWidgetDocument(input: BuildWidgetDocumentInput): string {
  const { payload, theme } = input;
  const styles = [
    buildWidgetThemeVariables(theme),
    BASE_RULES,
    buildPaletteRules(),
    buildWidgetIconRules(),
  ].join("\n");

  // SVG-mode fragments are centered in the frame; an SVG sized to its viewBox
  // otherwise pins left and reads as a mistake at wide chat widths.
  const bodyAttrs = payload.mode === "svg" ? ' class="widget-svg"' : "";
  const modeRules =
    payload.mode === "svg"
      ? "body.widget-svg{display:flex;justify-content:center;}body.widget-svg>svg{height:auto;}"
      : "";

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="${WIDGET_CSP}">`,
    `<title>${escapeHtml(payload.title)}</title>`,
    `<style>${styles}\n${modeRules}</style>`,
    "</head>",
    `<body${bodyAttrs}>`,
    payload.code,
    `<script>${buildBootstrap(payload.id)}</script>`,
    "</body>",
    "</html>",
  ].join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
