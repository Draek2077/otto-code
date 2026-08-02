import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet as RNStyleSheet, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { MarkdownTextSpan } from "@/components/markdown-text";
import type { MathFormulaProps } from "./math-formula-contract";
import type { MathWebViewInbound, MathWebViewOutbound } from "./math-webview/math-webview-contract";
import { MATH_RENDER_DEBOUNCE_MS } from "./math-webview/math-webview-contract";

// Native host: iOS/Android have no DOM, and KaTeX emits only HTML and MathML, so
// a formula is laid out inside a react-native-webview carrying a bundled KaTeX,
// the pattern mermaid, the CM6 editor and the terminal all use.
// math-formula.web.tsx overrides this file on web, where MathML goes straight
// into the document instead.
//
// The payload module is reached through a dynamic import() and nothing else
// references it, which is what keeps ~700 KB of KaTeX, its stylesheet and its
// fonts out of the startup graph (docs/feature-flags.md: on Metro a dynamic
// boundary is the only lever that works). It is fetched the first time a formula
// appears and then shared by every later formula in the session.
//
// **Block math only.** Inline math stays as its source here, and that is a
// property of React Native's text model rather than of this file: `math_inline`
// reaches the renderer inside a `textgroup`, which is a `<Text>`. On iOS that is
// a `UITextView`, whose non-text children are dropped; on Android an inline
// `View` child becomes a placeholder span. A webview cannot live in either.
// Block math has its own `View` (see the MATH_BLOCK_TOKEN rule in renderer.tsx),
// so it can. Rendering inline math too means letting a paragraph that contains a
// formula opt out of the `UITextView` path the way `containsImage` already does,
// which is a change to paragraph selection semantics: tracked in
// projects/README.md rather than smuggled in here.

const ORIGIN_WHITELIST = ["*"];

let payloadPromise: Promise<string> | null = null;

function loadPayload(): Promise<string> {
  payloadPromise ??= import("./math-webview/math-webview-html").then(
    (module) => module.mathWebViewHtml,
  );
  return payloadPromise;
}

function serializeForInjectedJavaScript(message: MathWebViewInbound): string {
  return JSON.stringify(message).replace(/<\/script/gi, "<\\/script");
}

function parseOutbound(data: string): MathWebViewOutbound | null {
  try {
    const parsed: unknown = JSON.parse(data);
    if (parsed && typeof parsed === "object") {
      const type = (parsed as { type?: unknown }).type;
      if (typeof type === "string") {
        return parsed as MathWebViewOutbound;
      }
    }
  } catch {
    // A malformed bridge message is indistinguishable from no formula at all.
  }
  return null;
}

export function MathFormula({ tex, display, style }: MathFormulaProps) {
  // `themeColorRef` resolves to a real colour on native and only to a CSS
  // `var()` on web, so this is always a string here. The webview's document has
  // no theme to resolve anything against, so without one there is nothing to
  // paint the formula in and the source is the honest answer.
  const color = typeof style.color === "string" ? style.color : null;

  if (!display || color === null) {
    return <MarkdownTextSpan style={style}>{display ? tex : tex.trim()}</MarkdownTextSpan>;
  }
  return <MathBlock tex={tex} color={color} style={style} />;
}

interface MathBlockProps {
  tex: string;
  /** A concrete colour; see the caller. */
  color: string;
  style: MathFormulaProps["style"];
}

function MathBlock({ tex, color, style }: MathBlockProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [request, setRequest] = useState<MathWebViewInbound | null>(null);
  const [height, setHeight] = useState(0);
  const [failed, setFailed] = useState(false);
  const webViewRef = useRef<WebView | null>(null);
  const bridgeReadyRef = useRef(false);
  const requestIdRef = useRef(0);
  // Retained so a webview that reloads (render-process death) can be re-driven.
  const requestRef = useRef<MathWebViewInbound | null>(null);
  const fontSize = typeof style.fontSize === "number" ? style.fontSize : DEFAULT_FONT_SIZE;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const payload = await loadPayload();
        if (!cancelled) setHtml(payload);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      requestIdRef.current += 1;
      setRequest({
        type: "render",
        requestId: requestIdRef.current,
        tex,
        display: true,
        color,
        fontSize,
      });
    }, MATH_RENDER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [color, fontSize, tex]);

  const send = useCallback((message: MathWebViewInbound) => {
    requestRef.current = message;
    if (!bridgeReadyRef.current || !webViewRef.current) {
      return;
    }
    const payload = serializeForInjectedJavaScript(message);
    webViewRef.current.injectJavaScript(
      `window.__OTTO_MATH_WEBVIEW_RECEIVE__ && window.__OTTO_MATH_WEBVIEW_RECEIVE__(${payload}); true;`,
    );
  }, []);

  useEffect(() => {
    if (request) send(request);
  }, [request, send]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const message = parseOutbound(event.nativeEvent.data);
      if (!message) return;

      switch (message.type) {
        case "ready": {
          bridgeReadyRef.current = true;
          // Re-drive whatever the newest request is: the first one, or the one
          // the previous webview generation was showing before it reloaded.
          if (requestRef.current) send(requestRef.current);
          break;
        }
        case "rendered":
          if (message.requestId !== requestIdRef.current) return;
          setFailed(false);
          setHeight(message.height);
          break;
        case "error":
          if (message.requestId !== requestIdRef.current) return;
          setHeight(0);
          setFailed(true);
          break;
        case "resized":
          // Reflow after a width change; never promotes a failed formula.
          setHeight((current) => (current > 0 ? message.height : current));
          break;
      }
    },
    [send],
  );

  const handleLoadStart = useCallback(() => {
    bridgeReadyRef.current = false;
  }, []);

  const drawable = height > 0 && !failed;
  // Before the formula has a measured height, and forever if it failed to parse,
  // the WebView measures off-flow at a provisional height instead of
  // being squeezed to zero: a WebView with no height may never lay its page out,
  // and then it could never report the height that would give it one. Absolute
  // + full width keeps the measurement honest (the formula is fitted to the pane
  // it will actually occupy) while taking up no space in the document.
  const hostStyle = useMemo(
    () => (height > 0 ? [styles.host, { height }] : [styles.host, styles.probe]),
    [height],
  );
  const source = useMemo(() => (html && request ? { html } : null), [html, request]);

  return (
    <>
      {/* Unparseable TeX shows as written, and so does a formula that has not
          been laid out yet. Dropping it would lose content, and an error message
          would be less useful than the formula the author typed. The same
          fallback the web renderer makes. */}
      {drawable ? null : (
        <Text selectable style={style}>
          {tex}
        </Text>
      )}
      {source ? (
        <View style={hostStyle} pointerEvents="none">
          <WebView
            ref={webViewRef}
            source={source}
            style={styles.webView}
            originWhitelist={ORIGIN_WHITELIST}
            onMessage={handleMessage}
            onLoadStart={handleLoadStart}
            scrollEnabled={false}
            nestedScrollEnabled={false}
            bounces={false}
            overScrollMode="never"
            javaScriptEnabled
            automaticallyAdjustContentInsets={false}
            contentInsetAdjustmentBehavior="never"
            allowsLinkPreview={false}
            setBuiltInZoomControls={false}
            androidLayerType="hardware"
          />
        </View>
      ) : null}
    </>
  );
}

// Plain RN styles: the only themed values (the formula's colour and size) are
// painted by the payload from the message it is handed, so nothing here needs
// Unistyles.
// Tall enough that a formula lays out in one pass; the page's own layout height
// is content-driven, so this only bounds the webview viewport.
const PROBE_HEIGHT = 600;
// Only reached if the markdown styles ever stop carrying a size; they always do.
const DEFAULT_FONT_SIZE = 14;

const styles = RNStyleSheet.create({
  host: {
    width: "100%",
    overflow: "hidden",
  },
  probe: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: PROBE_HEIGHT,
    opacity: 0,
  },
  webView: {
    flex: 1,
    backgroundColor: "transparent",
  },
});
