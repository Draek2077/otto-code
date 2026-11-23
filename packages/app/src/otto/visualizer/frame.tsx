import { useCallback, useEffect, useMemo, useRef } from "react";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { VisualizerFrameProps } from "./frame-types";
const origins = ["about:blank"];
export function VisualizerFrame({
  html,
  interactive,
  onMessage,
  onTransport,
  onFailure,
}: VisualizerFrameProps) {
  const frame = useRef<WebView | null>(null);
  const source = useMemo(() => ({ html, baseUrl: "about:blank" }), [html]);
  const receive = useCallback(
    (event: WebViewMessageEvent) => onMessage(event.nativeEvent.data),
    [onMessage],
  );
  const allow = useCallback((request: { url: string }) => request.url === "about:blank", []);
  const fail = useCallback(() => onFailure("The Visualizer could not be loaded."), [onFailure]);
  useEffect(() => {
    onTransport((message) =>
      frame.current?.injectJavaScript(
        `window.__ottoVisualizerReceive&&window.__ottoVisualizerReceive(${JSON.stringify(message)});true;`,
      ),
    );
    return () => onTransport(null);
  }, [onTransport]);
  return (
    <WebView
      ref={frame}
      source={source}
      pointerEvents={interactive ? "auto" : "none"}
      onMessage={receive}
      onError={fail}
      onHttpError={fail}
      originWhitelist={origins}
      onShouldStartLoadWithRequest={allow}
      javaScriptEnabled
      javaScriptCanOpenWindowsAutomatically={false}
      setSupportMultipleWindows={false}
      domStorageEnabled={false}
      incognito
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      mixedContentMode="never"
    />
  );
}
