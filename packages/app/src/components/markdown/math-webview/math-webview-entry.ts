import { renderToString } from "katex";
import type { MathWebViewInbound, MathWebViewOutbound } from "./math-webview-contract";

// Runs inside the native react-native-webview. iOS and Android have no DOM and
// KaTeX emits only HTML and MathML, so the formula is laid out here instead,
// the same recipe as mermaid, the CM6 editor and the terminal emulator (see
// scripts/build-math-webview-html.mjs, which esbuilds this entry, KaTeX's
// stylesheet and KaTeX's fonts into one self-contained HTML string).
//
// **This is KaTeX's HTML output, where the web host uses MathML.** That is not a
// drift: the web host renders into a React Native Web bundle with no CSS
// pipeline, which is what rules out `katex.min.css` and its woff2 fonts there.
// A webview *is* a CSS pipeline, and it is a document we generate whole, so the
// payload can carry both and get KaTeX's reference rendering. That also means
// the result does not depend on the platform's MathML support, and Android
// WebViews below Chromium 109 have none at all.
//
// One formula per webview. The host posts `render` and gets back the laid-out
// size so it can size the WebView; nothing in here ever reaches the network.

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage?: (data: string) => void };
    __OTTO_MATH_WEBVIEW_RECEIVE__?: (message: MathWebViewInbound) => void;
  }
}

const sendToNative = (message: MathWebViewOutbound): void => {
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
  background: transparent;
}
/* Full width so a block formula can be centred in it, and the scale target for
   the fit-to-width transform below. */
#math-scale {
  width: 100%;
  text-align: center;
  transform-origin: top center;
}
/* inline-block, so the measured box is the formula's own size rather than the
   viewport's. That measurement is the only thing that gives the host a height. */
#math-root {
  display: inline-block;
  text-align: initial;
}
/* KaTeX's own vertical margin would double the spacing the markdown paragraph
   already provides, and it would be measured as part of the formula. */
#math-root .katex-display {
  margin: 0;
}
`;
  document.head.appendChild(style);
};

const scaleElement = (): HTMLElement | null => document.getElementById("math-scale");
const rootElement = (): HTMLElement | null => document.getElementById("math-root");

interface Measurement {
  width: number;
  height: number;
}

/**
 * Measure the formula at its natural size, then shrink it if it is wider than
 * the pane.
 *
 * A long equation genuinely can be wider than a phone. Clipping it loses the
 * right-hand side silently, which for maths is the difference between two
 * statements; scaling keeps all of it, and is what the mermaid payload does with
 * an oversized diagram.
 */
const measure = (): Measurement => {
  const scale = scaleElement();
  const root = rootElement();
  if (!scale || !root) return { width: 0, height: 0 };

  scale.style.transform = "none";
  const rect = root.getBoundingClientRect();
  const available = document.documentElement.clientWidth;
  const factor = rect.width > available && rect.width > 0 ? available / rect.width : 1;
  scale.style.transform = factor < 1 ? `scale(${factor})` : "none";

  return {
    width: Math.ceil(rect.width * factor),
    height: Math.ceil(rect.height * factor),
  };
};

let lastReported: Measurement = { width: 0, height: 0 };

const reportResize = (): void => {
  // Never promotes a formula that has nothing laid out: a zero measurement is
  // either a failed parse or a page that has not settled, and reporting it would
  // collapse the host to nothing.
  if (lastReported.height <= 0) return;
  const size = measure();
  if (
    size.height > 0 &&
    (size.width !== lastReported.width || size.height !== lastReported.height)
  ) {
    lastReported = size;
    sendToNative({ type: "resized", width: size.width, height: size.height });
  }
};

const render = (message: MathWebViewInbound): void => {
  const root = rootElement();
  if (!root) return;

  document.body.style.color = message.color;
  document.body.style.fontSize = `${message.fontSize}px`;

  let markup: string;
  try {
    markup = renderToString(message.tex, {
      // `displayMode` is KaTeX's own flag, so the payload serves inline and
      // block alike. Only block math reaches it today; see math-formula.tsx for
      // why inline stays as text on native.
      displayMode: message.display,
      // Otto renders documents it did not write, so a malformed formula is a
      // typo in someone else's README. Throwing here reaches the host, which
      // falls back to the source, the same contract as the web renderer.
      throwOnError: true,
      strict: false,
    });
  } catch (error) {
    root.innerHTML = "";
    lastReported = { width: 0, height: 0 };
    sendToNative({
      type: "error",
      requestId: message.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  root.innerHTML = markup;
  // Two frames: one for the browser to lay the formula out (fonts included), one
  // so the measured size is the settled one.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const size = measure();
      lastReported = size;
      sendToNative({
        type: "rendered",
        requestId: message.requestId,
        width: size.width,
        height: size.height,
      });
    });
  });
};

const boot = (): void => {
  installStyles();
  const scale = document.createElement("div");
  scale.id = "math-scale";
  const root = document.createElement("div");
  root.id = "math-root";
  scale.appendChild(root);
  document.body.appendChild(scale);

  window.__OTTO_MATH_WEBVIEW_RECEIVE__ = (message: MathWebViewInbound): void => {
    if (message.type === "render") {
      render(message);
    }
  };

  // The fonts are inlined as data URIs, so they are decoded rather than fetched,
  // but decoding is still async, and a formula measured before it finishes is
  // measured in a fallback font. `document.fonts.ready` is what re-measures it.
  if (document.fonts?.ready) {
    void document.fonts.ready.then(reportResize);
  }

  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(reportResize).observe(document.documentElement);
  } else {
    window.addEventListener("resize", reportResize);
  }

  sendToNative({ type: "ready" });
};

boot();
