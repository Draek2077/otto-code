/**
 * The host bridge for a rendered Interactive View.
 *
 * Archify produces a self-contained viewer document with its own chrome:
 * theme switch, visual styles, presentation stage, export menu, and a
 * navigation dock. Otto presents a View as a document instead, so the host
 * owns those controls. Rather than patching the vendored viewer, Otto injects
 * one style block and one bootstrap script into the daemon-sanitized HTML:
 *
 * - The style block carries the Otto theme (see `view-theme.ts`) and hides the
 *   viewer chrome Otto replaces.
 * - The script pins the viewer to Otto's light/dark scheme and classic visual
 *   style, routes the viewer's blob downloads and alerts to the host, and
 *   answers host commands through the viewer's public `Archify` object.
 *
 * Everything here is transport-neutral. The Electron frame calls
 * `window.__OTTO_VIEW__.run()` through `executeJavaScript` and reads its
 * promise result; the web iframe and the native WebView post commands and
 * receive results as prefixed messages.
 */

export const INTERACTIVE_VIEW_MESSAGE_PREFIX = "__OTTO_VIEW__";
export const INTERACTIVE_VIEW_THEME_STYLE_ID = "otto-view-theme";

export type InteractiveViewColorScheme = "light" | "dark";

export type InteractiveViewExportFormat = "png" | "jpeg" | "webp" | "svg" | "webm";

export type InteractiveViewCommand =
  | { type: "state" }
  | { type: "theme"; scheme: InteractiveViewColorScheme; css: string }
  | { type: "zoomIn" }
  | { type: "zoomOut" }
  | { type: "fit" }
  | { type: "find" }
  | { type: "lens" }
  | { type: "route" }
  | { type: "map" }
  | { type: "guide" }
  | { type: "motion" }
  | { type: "export"; format: InteractiveViewExportFormat };

export interface InteractiveViewState {
  /** Viewer camera scale, where 1 is the renderer's reading size. */
  scale: number;
  components: number;
  relationships: number;
  /** Present only for trace-enabled Views; `null` when the View has no motion. */
  motion: "live" | "still" | null;
  finderOpen: boolean;
  lensOpen: boolean;
  routeOpen: boolean;
  mapOpen: boolean;
  guideOpen: boolean;
}

export interface InteractiveViewExportFile {
  fileName: string;
  mimeType: string;
  dataUrl: string;
}

export type InteractiveViewCommandResult =
  | { ok: true; state: InteractiveViewState; file?: InteractiveViewExportFile }
  | { ok: false; error: string };

/** Messages the guest sends without being asked. */
export type InteractiveViewGuestEvent =
  | { type: "ready"; state: InteractiveViewState }
  | { type: "state"; state: InteractiveViewState }
  | { type: "notice"; message: string }
  | { type: "result"; id: number; result: InteractiveViewCommandResult };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Guest content is untrusted: every field is re-read into a fresh object with
 * bounded types before the host uses it.
 */
export function parseInteractiveViewState(value: unknown): InteractiveViewState | null {
  if (!isRecord(value)) return null;
  const motion = value.motion === "live" || value.motion === "still" ? value.motion : null;
  return {
    scale: Math.max(0, finiteNumber(value.scale, 1)),
    components: Math.max(0, Math.floor(finiteNumber(value.components, 0))),
    relationships: Math.max(0, Math.floor(finiteNumber(value.relationships, 0))),
    motion,
    finderOpen: value.finderOpen === true,
    lensOpen: value.lensOpen === true,
    routeOpen: value.routeOpen === true,
    mapOpen: value.mapOpen === true,
    guideOpen: value.guideOpen === true,
  };
}

const EXPORT_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "video/webm",
]);

function parseExportFile(value: unknown): InteractiveViewExportFile | null {
  if (!isRecord(value)) return null;
  const { fileName, mimeType, dataUrl } = value;
  if (typeof fileName !== "string" || typeof mimeType !== "string") return null;
  if (typeof dataUrl !== "string") return null;
  const baseMime = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!EXPORT_MIME_TYPES.has(baseMime)) return null;
  if (!dataUrl.startsWith(`data:${baseMime}`)) return null;
  const safeName = Array.from(fileName, (char) =>
    char.charCodeAt(0) < 0x20 || '\\/:*?"<>|'.includes(char) ? "-" : char,
  )
    .join("")
    .replace(/-+/g, "-")
    .slice(0, 160);
  return { fileName: safeName || "interactive-view", mimeType: baseMime, dataUrl };
}

export function parseInteractiveViewCommandResult(
  value: unknown,
): InteractiveViewCommandResult | null {
  if (!isRecord(value)) return null;
  if (value.ok === false) {
    return {
      ok: false,
      error: typeof value.error === "string" ? value.error.slice(0, 500) : "The View failed.",
    };
  }
  if (value.ok !== true) return null;
  const state = parseInteractiveViewState(value.state);
  if (!state) return null;
  if (value.file === undefined) return { ok: true, state };
  const file = parseExportFile(value.file);
  if (!file) return { ok: false, error: "The View returned an unsupported export." };
  return { ok: true, state, file };
}

export function parseInteractiveViewGuestEvent(raw: unknown): InteractiveViewGuestEvent | null {
  if (typeof raw !== "string" || !raw.startsWith(INTERACTIVE_VIEW_MESSAGE_PREFIX)) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw.slice(INTERACTIVE_VIEW_MESSAGE_PREFIX.length));
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (value.type === "ready" || value.type === "state") {
    const state = parseInteractiveViewState(value.state);
    return state ? { type: value.type, state } : null;
  }
  if (value.type === "notice" && typeof value.message === "string") {
    return { type: "notice", message: value.message.slice(0, 500) };
  }
  if (value.type === "result" && typeof value.id === "number") {
    const result = parseInteractiveViewCommandResult(value.result);
    return result ? { type: "result", id: value.id, result } : null;
  }
  return null;
}

export function serializeInteractiveViewCommand(command: InteractiveViewCommand): string {
  // JSON is a JavaScript expression; escaping `<` keeps a `</script>` inside
  // theme CSS from ever closing an inline script it is embedded in.
  return JSON.stringify(command).replace(/</g, "\\u003c");
}

export interface InteractiveViewBootstrap {
  scheme: InteractiveViewColorScheme;
  css: string;
}

function escapeStyleText(css: string): string {
  return css.replace(/<\/style/gi, "<\\/style");
}

/**
 * Inserts the Otto theme and bridge right after the sanitizer's CSP meta tag
 * (or the `<head>` opening tag), ahead of the viewer's own head script, so the
 * viewer reads Otto's color scheme on its first paint.
 */
export function prepareInteractiveViewDocument(
  html: string,
  bootstrap: InteractiveViewBootstrap,
): string {
  const injection =
    `<style id="${INTERACTIVE_VIEW_THEME_STYLE_ID}">${escapeStyleText(bootstrap.css)}</style>` +
    `<script>${buildInteractiveViewGuestScript(bootstrap.scheme)}</script>`;
  const cspMatch = html.match(/<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/i);
  if (cspMatch?.index !== undefined) {
    const at = cspMatch.index + cspMatch[0].length;
    return html.slice(0, at) + injection + html.slice(at);
  }
  const headMatch = html.match(/<head[^>]*>/i);
  if (headMatch?.index !== undefined) {
    const at = headMatch.index + headMatch[0].length;
    return html.slice(0, at) + injection + html.slice(at);
  }
  return injection + html;
}

/**
 * The guest half of the bridge. Plain ES5 so it runs before and alongside the
 * viewer's own scripts without a build step.
 */
export function buildInteractiveViewGuestScript(scheme: InteractiveViewColorScheme): string {
  const prefix = JSON.stringify(INTERACTIVE_VIEW_MESSAGE_PREFIX);
  const styleId = JSON.stringify(INTERACTIVE_VIEW_THEME_STYLE_ID);
  const initialScheme = JSON.stringify(scheme);
  return `(function () {
  if (window.__OTTO_VIEW__) return;
  var PREFIX = ${prefix};
  var STYLE_ID = ${styleId};
  var scheme = ${initialScheme};
  var root = document.documentElement;
  var blobs = {};
  var pendingExport = null;
  var lastState = "";

  function send(message) {
    var payload = PREFIX + JSON.stringify(message);
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(payload);
      } else if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, "*");
      } else {
        console.log(payload);
      }
    } catch (_) {}
  }

  function pinPresentation() {
    root.setAttribute("data-otto-view", "true");
    root.setAttribute("data-theme", scheme);
    root.setAttribute("data-preset", "classic");
  }
  pinPresentation();

  // The viewer resolves its scheme from prefers-color-scheme and follows OS
  // changes. Otto's scheme is the only one that applies.
  var nativeMatchMedia = window.matchMedia ? window.matchMedia.bind(window) : null;
  window.matchMedia = function (query) {
    var text = String(query);
    if (text.indexOf("prefers-color-scheme") >= 0) {
      var wantsLight = text.indexOf("light") >= 0;
      var noop = function () {};
      return {
        matches: wantsLight ? scheme === "light" : scheme === "dark",
        media: text,
        onchange: null,
        addEventListener: noop,
        removeEventListener: noop,
        addListener: noop,
        removeListener: noop,
        dispatchEvent: function () { return false; }
      };
    }
    return nativeMatchMedia ? nativeMatchMedia(query) : { matches: false, media: text };
  };

  // Viewer exports end in an anchor click on a blob URL. Capture the blob and
  // hand it to the host, which saves it through Otto's own download flow.
  var nativeCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = function (object) {
    var url = nativeCreateObjectURL.call(URL, object);
    if (typeof Blob !== "undefined" && object instanceof Blob) blobs[url] = object;
    return url;
  };
  var nativeRevokeObjectURL = URL.revokeObjectURL;
  URL.revokeObjectURL = function (url) {
    delete blobs[url];
    return nativeRevokeObjectURL.call(URL, url);
  };
  var nativeAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    var blob = this.hasAttribute("download") ? blobs[this.href] : null;
    if (!blob) return nativeAnchorClick.call(this);
    var fileName = this.getAttribute("download") || "interactive-view";
    var target = pendingExport;
    if (target) target.capturing = true;
    var reader = new FileReader();
    reader.onload = function () {
      var file = { fileName: fileName, mimeType: blob.type || "application/octet-stream", dataUrl: String(reader.result) };
      if (target && pendingExport === target) {
        pendingExport = null;
        target.resolve(file);
      }
    };
    reader.onerror = function () {
      if (target && pendingExport === target) {
        pendingExport = null;
        target.reject(new Error("The export could not be read."));
      }
    };
    reader.readAsDataURL(blob);
  };

  // Viewer failures surface as alert(). Route them to the pending host command,
  // or to the host as a notice, never as a modal inside the document.
  window.alert = function (message) {
    var text = String(message == null ? "" : message);
    if (pendingExport) {
      var target = pendingExport;
      pendingExport = null;
      target.reject(new Error(text));
      return;
    }
    send({ type: "notice", message: text });
  };

  // Archify's exports serialize the diagram with its own monospace font baked
  // into the SVG. Swap in the font the diagram shows on screen (the user's
  // mono choice), embedding its face when Otto supplied one, so a PNG or SVG
  // matches the View it came from.
  function diagramFont() {
    var svg = document.querySelector(".diagram-container svg");
    var family = svg ? getComputedStyle(svg).fontFamily : "";
    var first = family.split(",")[0].trim().replace(/^['"]|['"]$/g, "");
    var faces = [];
    var style = document.getElementById(STYLE_ID);
    var rules = style && style.sheet ? style.sheet.cssRules : [];
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (rule.type !== 5) continue;
      var name = rule.style.getPropertyValue("font-family").trim().replace(/^['"]|['"]$/g, "");
      if (name === first) faces.push(rule.cssText);
    }
    return { family: family, faces: faces.join("\\n") };
  }
  var nativeSerialize = XMLSerializer.prototype.serializeToString;
  XMLSerializer.prototype.serializeToString = function (node) {
    var out = nativeSerialize.call(this, node);
    if (!node || String(node.nodeName).toLowerCase() !== "svg" || out.indexOf("JetBrains Mono") < 0) return out;
    var font = diagramFont();
    if (!font.family) return out;
    out = out.replace(/@font-face\\s*\\{\\s*font-family:\\s*['"]JetBrains Mono['"][^}]*\\}\\s*/g, "");
    out = out.replace(/svg\\s*\\{\\s*font-family:\\s*['"]JetBrains Mono['"][^}]*\\}/g, function () {
      return "svg { font-family: " + font.family + "; }";
    });
    if (font.faces) {
      out = out.replace(/<style([^>]*)>/, function (tag) { return tag + font.faces + "\\n"; });
    }
    return out;
  };

  function archify() { return window.Archify || null; }
  function isOpen(name, buttonId) {
    var api = archify() && archify()[name];
    if (api && typeof api.isOpen === "function") return !!api.isOpen();
    var button = document.getElementById(buttonId);
    if (!button) return false;
    return button.getAttribute("aria-pressed") === "true" || button.getAttribute("aria-expanded") === "true";
  }
  function uniqueCount(selector, attribute) {
    var seen = {};
    var count = 0;
    var svg = document.querySelector(".diagram-container svg");
    if (!svg) return 0;
    var elements = svg.querySelectorAll(selector);
    for (var i = 0; i < elements.length; i++) {
      var key = elements[i].getAttribute(attribute);
      if (key && !Object.prototype.hasOwnProperty.call(seen, key)) {
        seen[key] = true;
        count++;
      }
    }
    return count;
  }
  function motionState() {
    var button = document.getElementById("btn-motion");
    var governor = archify() && archify().motionGovernor;
    if (!button || button.hidden || !governor || typeof governor.mode !== "function") return null;
    return governor.mode() === "still" ? "still" : "live";
  }
  function readState() {
    var view = archify() && archify().view;
    var camera = view && typeof view.state === "function" ? view.state() : null;
    var guide = archify() && archify().guide;
    var facts = guide && typeof guide.facts === "function" ? guide.facts() : null;
    return {
      scale: camera && typeof camera.scale === "number" ? camera.scale : 1,
      components: facts && typeof facts.nodes === "number" ? facts.nodes : uniqueCount("[data-node-id]", "data-node-id"),
      relationships: facts && typeof facts.relationships === "number" ? facts.relationships : uniqueCount("[data-edge-key]", "data-edge-key"),
      motion: motionState(),
      finderOpen: isOpen("finder", "btn-node-finder"),
      lensOpen: isOpen("semanticLens", "btn-semantic-lens"),
      routeOpen: isOpen("routeProbe", "btn-route-probe"),
      mapOpen: isOpen("radar", "btn-overview-map"),
      guideOpen: isOpen("guide", "btn-diagram-guide")
    };
  }
  function reportState() {
    var state = readState();
    var serialized = JSON.stringify(state);
    if (serialized === lastState) return;
    lastState = serialized;
    send({ type: "state", state: state });
  }
  var reportQueued = false;
  function queueReport() {
    if (reportQueued) return;
    reportQueued = true;
    setTimeout(function () {
      reportQueued = false;
      reportState();
    }, 120);
  }

  function toggle(name, options) {
    var api = archify() && archify()[name];
    if (!api || typeof api.toggle !== "function") throw new Error("This View does not offer that control.");
    api.toggle(options);
  }

  function applyTheme(nextScheme, css) {
    scheme = nextScheme === "light" ? "light" : "dark";
    var style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || root).appendChild(style);
    }
    style.textContent = String(css);
    pinPresentation();
  }

  function exportDiagram(format) {
    var menu = archify() && archify().exportMenu;
    if (!menu || typeof menu.run !== "function") return Promise.reject(new Error("This View cannot be exported."));
    if (pendingExport) return Promise.reject(new Error("An export is already running."));
    return new Promise(function (resolve, reject) {
      var target = { resolve: resolve, reject: reject, capturing: false };
      pendingExport = target;
      Promise.resolve(menu.run(format)).then(function () {
        setTimeout(function () {
          if (pendingExport === target && !target.capturing) {
            pendingExport = null;
            reject(new Error(format === "webm" ? "Motion recording is unavailable for this View." : "The export produced no file."));
          }
        }, 0);
      }, function (error) {
        if (pendingExport === target) {
          pendingExport = null;
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  }

  function execute(command) {
    var api = archify();
    switch (command && command.type) {
      case "state": break;
      case "theme": applyTheme(command.scheme, command.css); break;
      case "zoomIn": api.view.zoomIn(); break;
      case "zoomOut": api.view.zoomOut(); break;
      case "fit": api.view.reset(); break;
      case "find": toggle("finder"); break;
      case "lens": toggle("semanticLens"); break;
      case "route": toggle("routeProbe", { focusNode: true }); break;
      case "map": toggle("radar"); break;
      case "guide": toggle("guide"); break;
      case "motion": toggle("motionGovernor"); break;
      case "export":
        return exportDiagram(command.format).then(function (file) {
          return { ok: true, state: readState(), file: file };
        });
      default: throw new Error("Unknown View command.");
    }
    return new Promise(function (resolve) {
      requestAnimationFrame(function () { resolve({ ok: true, state: readState() }); });
    });
  }

  function run(command) {
    var result;
    try {
      if (!archify() && command && command.type !== "theme" && command.type !== "state") {
        throw new Error("The View is still loading.");
      }
      result = Promise.resolve(execute(command));
    } catch (error) {
      result = Promise.reject(error);
    }
    return result.then(function (value) {
      lastState = JSON.stringify(value.state || readState());
      return value;
    }, function (error) {
      return { ok: false, error: error && error.message ? error.message : String(error) };
    });
  }

  window.__OTTO_VIEW__ = {
    run: run,
    handle: function (id, command) {
      run(command).then(function (result) { send({ type: "result", id: id, result: result }); });
    }
  };

  // The web iframe host posts commands; accept only well-formed ones.
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (typeof data !== "string" || data.indexOf(PREFIX) !== 0) return;
    try {
      var message = JSON.parse(data.slice(PREFIX.length));
      if (message && typeof message.id === "number" && message.command) {
        window.__OTTO_VIEW__.handle(message.id, message.command);
      }
    } catch (_) {}
  });

  // Theme, style, stage, and export are host controls. The viewer's shortcut
  // handler skips prevented events, so claiming those keys here keeps a stray
  // keystroke from forking the presentation Otto pins.
  document.addEventListener("keydown", function (event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    var target = event.target;
    var tag = target && target.tagName ? target.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea" || (target && target.isContentEditable)) return;
    var key = String(event.key || "").toLowerCase();
    if (key === "t" || key === "s" || key === "f" || key === "e") {
      event.preventDefault();
    }
  }, true);

  ["wheel", "pointerup", "keyup", "click", "resize"].forEach(function (name) {
    (name === "resize" ? window : document).addEventListener(name, queueReport, { passive: true, capture: true });
  });

  function announceReady() {
    pinPresentation();
    var state = readState();
    lastState = JSON.stringify(state);
    send({ type: "ready", state: state });
  }
  if (document.readyState === "complete") {
    setTimeout(announceReady, 0);
  } else {
    window.addEventListener("load", function () { setTimeout(announceReady, 0); });
  }
})();`;
}
