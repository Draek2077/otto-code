import { WebView } from "react-native-webview";
import { useCallback, useMemo } from "react";
/** Native WebView is private and cannot read host files or open an external destination. */
export function ArtifactHtmlView({ html }: { html: string }) {
  const source = useMemo(() => ({ html, baseUrl: "about:blank" }), [html]);
  const allow = useCallback((request: { url: string }) => request.url === "about:blank", []);
  const ignorePopup = useCallback(() => {}, []);
  return (
    <WebView
      source={source}
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
