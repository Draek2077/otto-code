import { useCallback, useEffect, useMemo, useRef } from "react";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { ViewFrameProps } from "./frame-types";
export function ViewFrame({ html, onMessage, onTransport }: ViewFrameProps) {
  const frame = useRef<WebView | null>(null);
  const source = useMemo(() => ({ html, baseUrl: "about:blank" }), [html]);
  const receive = useCallback(
    (event: WebViewMessageEvent) => onMessage(event.nativeEvent.data),
    [onMessage],
  );
  const allow = useCallback((request: { url: string }) => request.url === "about:blank", []);
  const ignorePopup = useCallback(() => {}, []);
  useEffect(() => {
    onTransport((message) =>
      frame.current?.injectJavaScript(
        `(function(){var m=JSON.parse(${JSON.stringify(JSON.stringify(message))});if(window.__OTTO_VIEW__)window.__OTTO_VIEW__.handle(m.id,m.command);})();true;`,
      ),
    );
    return () => onTransport(null);
  }, [onTransport]);
  return (
    <WebView
      ref={frame}
      source={source}
      onMessage={receive}
      originWhitelist={["about:blank"]}
      onShouldStartLoadWithRequest={allow}
      javaScriptEnabled
      javaScriptCanOpenWindowsAutomatically={false}
      setSupportMultipleWindows={false}
      onOpenWindow={ignorePopup}
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
