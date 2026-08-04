import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet as RNStyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { MermaidWebViewInbound, MermaidWebViewOutbound } from "./mermaid-contract";
import type { MermaidDiagramProps } from "./mermaid-diagram-contract";
import { MERMAID_RENDER_DEBOUNCE_MS } from "./mermaid-diagram-contract";

// Native host: iOS/Android have no DOM, so mermaid runs inside a
// react-native-webview carrying a self-contained payload - the CM6 editor's and
// the terminal's proven pattern. mermaid-diagram.tsx overrides this file on web.
//
// The payload module is reached through a dynamic import() and nothing else
// references it, which is what keeps ~3.4 MB of minified mermaid out of the
// startup graph (docs/feature-flags.md: on Metro a dynamic boundary is the only
// lever that works). It is fetched the first time a diagram appears and then
// shared by every later diagram in the session.
//
// The WebView is not mounted until a render is actually due. That matters more
// here than on web: the markdown library remints node keys per parse, so a
// fence streaming into a chat message remounts this component on every flush,
// and mounting eagerly would mean creating and tearing down a WebView each time.
// The debounce timer is cleared by that unmount, so nothing is ever created.

const ORIGIN_WHITELIST = ["*"];

let payloadPromise: Promise<string> | null = null;

function loadPayload(): Promise<string> {
  payloadPromise ??= import("./webview/mermaid-webview-html").then(
    (module) => module.mermaidWebViewHtml,
  );
  return payloadPromise;
}

function serializeForInjectedJavaScript(message: MermaidWebViewInbound): string {
  return JSON.stringify(message).replace(/<\/script/gi, "<\\/script");
}

function parseOutbound(data: string): MermaidWebViewOutbound | null {
  try {
    const parsed: unknown = JSON.parse(data);
    if (parsed && typeof parsed === "object") {
      const type = (parsed as { type?: unknown }).type;
      if (typeof type === "string") {
        return parsed as MermaidWebViewOutbound;
      }
    }
  } catch {
    // A malformed bridge message is indistinguishable from no diagram at all.
  }
  return null;
}

export function MermaidDiagram({ code, theme, renderFallback }: MermaidDiagramProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [request, setRequest] = useState<MermaidWebViewInbound | null>(null);
  const [height, setHeight] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const webViewRef = useRef<WebView | null>(null);
  const bridgeReadyRef = useRef(false);
  const requestIdRef = useRef(0);
  // Retained so a webview that reloads (render-process death) can be re-driven.
  const requestRef = useRef<MermaidWebViewInbound | null>(null);
  const themeKey = useMemo(() => JSON.stringify(theme), [theme]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const payload = await loadPayload();
        if (!cancelled) setHtml(payload);
      } catch {
        if (!cancelled) setError("Diagram renderer failed to load.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      requestIdRef.current += 1;
      setRequest({ type: "render", requestId: requestIdRef.current, code, theme });
    }, MERMAID_RENDER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `theme` is covered by themeKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, themeKey]);

  const send = useCallback((message: MermaidWebViewInbound) => {
    requestRef.current = message;
    if (!bridgeReadyRef.current || !webViewRef.current) {
      return;
    }
    const payload = serializeForInjectedJavaScript(message);
    webViewRef.current.injectJavaScript(
      `window.__OTTO_MERMAID_WEBVIEW_RECEIVE__ && window.__OTTO_MERMAID_WEBVIEW_RECEIVE__(${payload}); true;`,
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
          setError(null);
          setHeight(message.height);
          break;
        case "error":
          if (message.requestId !== requestIdRef.current) return;
          setHeight(0);
          setError(message.message);
          break;
        case "resized":
          // Reflow after a width change; never promotes a failed diagram.
          setHeight((current) => (current > 0 ? message.height : current));
          break;
      }
    },
    [send],
  );

  const handleLoadStart = useCallback(() => {
    bridgeReadyRef.current = false;
  }, []);

  const drawable = height > 0 && !error;
  // Before the diagram has a measured height - and forever, if it failed to
  // parse - the WebView measures off-flow at a provisional height instead of
  // being squeezed to zero: a WebView with no height may never lay its page out,
  // and then it could never report the height that would give it one. Absolute
  // + full width keeps the measurement honest (the diagram scales to the pane it
  // will actually occupy) while taking up no space in the document.
  const hostStyle = useMemo(
    () => (height > 0 ? [styles.host, { height }] : [styles.host, styles.probe]),
    [height],
  );
  const source = useMemo(() => (html && request ? { html } : null), [html, request]);
  const fallback = drawable ? null : renderFallback(error);

  return (
    <>
      {fallback}
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

// Plain RN styles: the only themed value (the diagram background) is painted by
// the payload from the theme it is handed, so nothing here needs Unistyles.
// Tall enough that a typical diagram lays out in one pass; the page's own
// layout height is content-driven, so this only bounds the webview viewport.
const PROBE_HEIGHT = 600;

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
