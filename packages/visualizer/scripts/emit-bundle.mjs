// Composes the built Visualizer bundle (dist/index.js + dist/index.css) into a
// single self-contained HTML shell and emits it:
//   default : packages/app/src/visualizer/visualizer-bundle.gen.ts (committed)
//   --demo  : packages/visualizer/.demo/index.html (gitignored, open in a browser)
//
// The shell carries the same posture as the artifact CSP (packages/server/src/
// server/artifact/html-validator.ts): no network (connect-src 'none') — every
// byte of data reaches the page via postMessage from the Otto host.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const distDir = resolve(here, "../dist");
const demo = process.argv.includes("--demo");

const js = readFileSync(resolve(distDir, "index.js"), "utf8");
const css = readFileSync(resolve(distDir, "index.css"), "utf8");

// Otto's default fonts, embedded as data: URIs (CSP allows font-src data:;
// the guest document is isolated from the app shell, so webfonts loaded by
// the app never reach it). Only the 400 weight — exactly what the app itself
// registers in app/_layout.tsx; browsers synthesize bolder weights from it,
// so the guest matches app rendering. The family names deliberately equal the
// app's registered names (theme.ts DEFAULT_*_FONT_STACK) so host-sent stacks
// resolve unchanged. Size note: these add ~600 KB of base64; the Electron
// view loads the shell as a data: URL, which Chromium caps at 2 MB — check
// the emitted size stays comfortably below that when adding anything here.
// Deliberately NOT declared in this package's own dependencies: the specifiers
// resolve to the app workspace's @expo-google-fonts copy (hoisted to the root
// node_modules), so the embedded faces are byte-identical to the fonts the
// app itself registers and can never version-skew from them.
function fontDataUri(specifier) {
  return `data:font/ttf;base64,${readFileSync(require.resolve(specifier)).toString("base64")}`;
}
const interFont = fontDataUri("@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf");
const jetbrainsMonoFont = fontDataUri(
  "@expo-google-fonts/jetbrains-mono/400Regular/JetBrainsMono_400Regular.ttf",
);

// Mirror theme.ts DEFAULT_UI_FONT_STACK / DEFAULT_MONO_FONT_STACK (web).
const DEFAULT_UI_STACK =
  "Inter_400Regular, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const DEFAULT_CODE_STACK =
  "JetBrainsMono_400Regular, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";

// Otto appearance overrides. Placed AFTER the bundle CSS so equal-specificity
// selectors win by order — required because the vendor's globals.css uses
// Tailwind v4 `@theme inline`, which bakes the Geist font values directly
// into the emitted utility classes (`.font-mono { font-family: 'Geist Mono',
// ... }`); overriding the `--font-mono`/`--font-sans` variables does nothing.
//
// Font policy (the reason `.font-mono` maps to the INTERFACE font): upstream
// uses `font-mono` as its general interface voice — labels, badges, buttons,
// messages — not as a code marker. Otto renders all of that in the interface
// font; only surfaces the vendor patch marks with `otto-code` (tool diff/
// command blocks, file paths — see vendor/agent-flow/OTTO-PATCHES.md) keep a
// monospaced face, and they use Otto's code font.
//
// Type scale: the vendor's DOM text is authored on a 9/10/11/12px ramp with
// 10px as the main content size (transcript/tool text). --otto-font-scale
// multiplies that ramp so 10px lands exactly on Otto's chat prose size
// (theme fontSize.sm; markdown-styles.ts body). Default 1.4 = the default
// chat size (14) / 10; the host re-seeds it live via the otto-appearance
// message (see the shell script below). .text-xs carries Tailwind's fixed
// 1rem line-height, so it gets a unitless one; the arbitrary-size classes
// have none, leaving the vendor's own leading-* classes in charge.
const appearanceCss = `
@font-face { font-family: "Inter_400Regular"; src: url(${interFont}) format("truetype"); font-display: swap; }
@font-face { font-family: "JetBrainsMono_400Regular"; src: url(${jetbrainsMonoFont}) format("truetype"); font-display: swap; }
:root {
  --otto-ui-font: ${DEFAULT_UI_STACK};
  --otto-code-font: ${DEFAULT_CODE_STACK};
  --otto-font-scale: 1.4;
}
body, .font-sans, .font-mono { font-family: var(--otto-ui-font); }
button, input, textarea, select { font-family: inherit; }
.otto-code { font-family: var(--otto-code-font); }
.text-\\[9px\\]  { font-size: calc(9px * var(--otto-font-scale)); }
.text-\\[10px\\] { font-size: calc(10px * var(--otto-font-scale)); }
.text-\\[11px\\] { font-size: calc(11px * var(--otto-font-scale)); }
.text-xs { font-size: calc(12px * var(--otto-font-scale)); line-height: 1.35; }

/* Theme colors (docs/visualizer.md "Theme colors"). Most of the page themes
   through the vendor COLORS registry (seeded via window.__OTTO_THEME__, see
   the shell script below + vendor OTTO-PATCHES.md); these rules cover the
   remaining STYLESHEET-level chrome in the vendor globals.css — glass cards,
   their inputs, and their scrollbars. Every var falls back to the vendor's
   own value so the unthemed demo shell keeps the upstream look. !important
   mirrors the vendor's own !important on the input rules. */
.glass-card {
  background: var(--otto-vis-glass-bg, rgba(10, 15, 30, 0.7));
  border-color: var(--otto-vis-glass-border, rgba(100, 200, 255, 0.15));
  /* Match the chat message (composer) box corner radius
     (theme.borderRadius.md = 6px; input.tsx inputWrapper style) so every HUD box —
     popups, timeline, live/playback control bar, file-attention/message
     panels — reads as the same family as the chat input. Vendor default is 8px
     (globals.css .glass-card). */
  border-radius: 6px;
}
.glass-card::before {
  background: linear-gradient(90deg, transparent, var(--otto-vis-glass-border, rgba(100, 200, 255, 0.15)), transparent);
  /* Follow the rounded top corners of the card above. */
  border-radius: 6px 6px 0 0;
}
.glass-card input, .glass-card textarea, .glass-card select {
  background: var(--otto-vis-input-bg, rgba(100, 200, 255, 0.05)) !important;
  border-color: var(--otto-vis-input-border, rgba(100, 200, 255, 0.15)) !important;
  color: var(--otto-vis-input-color, #aaeeff) !important;
}
.glass-card input::placeholder, .glass-card textarea::placeholder {
  color: var(--otto-vis-input-placeholder, rgba(102, 204, 255, 0.3));
}
.glass-card input:focus, .glass-card textarea:focus {
  border-color: var(--otto-vis-input-focus-border, rgba(102, 204, 255, 0.3)) !important;
  box-shadow: var(--otto-vis-input-focus-shadow, 0 0 8px rgba(102, 204, 255, 0.1));
}
.glass-card ::-webkit-scrollbar-thumb {
  background: var(--otto-vis-scrollbar-thumb, rgba(100, 200, 255, 0.15));
}
.glass-card ::-webkit-scrollbar-thumb:hover {
  background: var(--otto-vis-scrollbar-thumb-hover, rgba(100, 200, 255, 0.25));
}
`;

// Runs before the bundle script: rewrites canvas font families (the vendor
// hardcodes "<size>px monospace" in every ctx.font assignment — node labels,
// context bars, cost overlays, timeline ticks) onto the interface font, and
// listens for the Otto shell-level `otto-appearance` message ({uiFontFamily,
// codeFontFamily, chatFontSize}) to re-seed the CSS variables above at
// runtime. Not part of the vendor bridge — vscode-bridge.ts ignores unknown
// message types. Canvas font SIZES are left untouched: canvas glyphs are HUD
// elements sized to their boxes, not reading text.
const appearanceScript = `
(function () {
  // Theme colors: the host substitutes the quoted placeholder with a
  // double-encoded palette JSON (applyVisualizerTheme in the app's
  // load-visualizer-html.ts). Unsubstituted (demo shell, upstream look),
  // JSON.parse throws on the raw placeholder and everything below no-ops.
  // Baked per load ON PURPOSE: the vendor page reads COLORS from module init
  // and React renders (no repaint path), so a theme change reloads the guest
  // — same contract as the dpr cap above.
  var theme = null;
  try { theme = JSON.parse("__OTTO_THEME_JSON__"); } catch (_e) {}
  if (theme && theme.colors) {
    window.__OTTO_THEME__ = theme;
    document.documentElement.style.background = theme.colors.void;
    document.body.style.background = theme.colors.void;
    if (theme.css) {
      for (var key in theme.css) {
        if (key.indexOf("--otto-vis-") === 0) {
          document.documentElement.style.setProperty(key, theme.css[key]);
        }
      }
    }
  }

  var uiFont = ${JSON.stringify(DEFAULT_UI_STACK)};
  function patchCanvasFont(proto) {
    if (!proto) return;
    var desc = Object.getOwnPropertyDescriptor(proto, "font");
    if (!desc || !desc.set) return;
    Object.defineProperty(proto, "font", {
      configurable: true,
      get: desc.get,
      set: function (value) {
        try {
          desc.set.call(this, String(value).replace(/monospace$/, uiFont));
        } catch (_e) {
          desc.set.call(this, value);
        }
      },
    });
  }
  patchCanvasFont(window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype);
  patchCanvasFont(window.OffscreenCanvasRenderingContext2D && OffscreenCanvasRenderingContext2D.prototype);
  window.addEventListener("message", function (e) {
    var d = e && e.data;
    if (!d || d.type !== "otto-appearance") return;
    var root = document.documentElement.style;
    if (typeof d.uiFontFamily === "string" && d.uiFontFamily) {
      uiFont = d.uiFontFamily + ", " + ${JSON.stringify(DEFAULT_UI_STACK)};
      root.setProperty("--otto-ui-font", uiFont);
    }
    if (typeof d.codeFontFamily === "string" && d.codeFontFamily) {
      root.setProperty("--otto-code-font", d.codeFontFamily + ", " + ${JSON.stringify(DEFAULT_CODE_STACK)});
    }
    if (typeof d.chatFontSize === "number" && isFinite(d.chatFontSize) && d.chatFontSize > 0) {
      root.setProperty("--otto-font-scale", String(d.chatFontSize / 10));
    }
  });
})();
`;

// Keep inline payloads from terminating their host tags.
const safeJs = js.replace(/<\/script/gi, "<\\/script");
const safeCss = css.replace(/<\/style/gi, "<\\/style");

const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "media-src data: blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

// class="dark" + black background mirror the upstream webview shell
// (vendor/agent-flow/extension/src/webview-provider.ts getHtml()).
const html = `<!DOCTYPE html>
<html lang="en" class="dark" style="height:100%; margin:0; padding:0;">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<style>
html, body { height: 100%; width: 100%; margin: 0; padding: 0; overflow: hidden; background: #030304; }
#root { height: 100%; width: 100%; }
/* Electron <webview> guests freeze vh/vw units at the initial guest viewport
   size — they never recompute on resize (window.innerHeight updates, 100vh
   does not). The vendor root is h-screen/w-screen (100vh/100vw), which left
   the whole UI laid out in a phantom initial-size box. Remap both onto the
   percentage chain above, which does track guest resizes. !important because
   this tag precedes the bundle CSS. */
.h-screen { height: 100% !important; }
.w-screen { width: 100% !important; }
</style>
<style>${safeCss}</style>
<style>${appearanceCss}</style>
</head>
<body>
<div id="root"></div>
<script>${appearanceScript}</script>
<script>
// Cap the devicePixelRatio the vendor page sees. It sizes its canvas backing
// store (and the bloom renderer's blur buffers) by dpr — at native 2x, a
// maximized pane is a ~6M-pixel store redrawn with a 3-pass blur every frame:
// measured 14 FPS vs 52 FPS at cap 1 and 25 FPS at cap 1.5. The cap is a
// host-substituted placeholder (applyVisualizerRenderScale in the app's
// load-visualizer-html.ts) driven by the render-quality setting; unsubstituted
// (e.g. the --demo build opened directly) it parses as NaN and falls back to
// 1. Must run before the bundle script, which reads devicePixelRatio during
// setup.
(function () {
  var native = window.devicePixelRatio || 1;
  var cap = Number("__OTTO_DPR_CAP__") || 1;
  Object.defineProperty(window, "devicePixelRatio", {
    configurable: true,
    get: function () { return Math.min(native, cap); },
  });
})();
</script>
<script>${safeJs}</script>
</body>
</html>`;

if (demo) {
  const outFile = resolve(here, "../.demo/index.html");
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, html);
  console.log(
    `Visualizer demo shell written to ${outFile} (${(html.length / 1024).toFixed(0)} KB)`,
  );
} else {
  const outFile = resolve(here, "../../app/src/visualizer/visualizer-bundle.gen.ts");
  mkdirSync(dirname(outFile), { recursive: true });
  const module = `// AUTO-GENERATED by \`npm run build --workspace=@otto-code/visualizer\`. Do not edit.
// Source: packages/visualizer (Otto entry) + vendor/agent-flow/web (render layer).
// Regenerate after every vendor/agent-flow subtree pull.
export const VISUALIZER_HTML: string = ${JSON.stringify(html)};
`;
  writeFileSync(outFile, module);
  console.log(
    `Visualizer bundle module written to ${outFile} (${(module.length / 1024).toFixed(0)} KB)`,
  );
}
