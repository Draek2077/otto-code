import { useCallback, useMemo, type ReactElement } from "react";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { parseWidgetGuestMessage } from "@otto-code/protocol/widgets/bridge";
import type { WidgetFrameProps } from "./widget-frame-types";

// Native guests never navigate: the fragment renders itself and every link is
// intercepted by the bootstrap and routed to the host as an `open_link`
// message. An empty whitelist blocks anything that tries anyway. (RN WebView
// always permits "about:blank" — the origin of the initial `source={{ html }}`
// document — regardless of this list.)
const ORIGIN_WHITELIST: string[] = [];

/**
 * Native widget renderer.
 *
 * Differs from ArtifactHtmlView in the two ways every widget renderer does:
 * the height is content-driven rather than `flex: 1`, and there is a message
 * bridge. `window.ReactNativeWebView.postMessage` is already defined by the
 * library, so the bootstrap in the guest document finds its transport with no
 * injection needed here.
 */
export function WidgetFrame({
  html,
  widgetId,
  height,
  onGuestMessage,
}: WidgetFrameProps): ReactElement {
  const source = useMemo(() => ({ html }), [html]);
  const style = useMemo(() => ({ height, backgroundColor: "transparent" }), [height]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const message = parseWidgetGuestMessage(event.nativeEvent.data);
      if (message && message.widgetId === widgetId) {
        onGuestMessage(message);
      }
    },
    [widgetId, onGuestMessage],
  );

  return (
    <WebView
      originWhitelist={ORIGIN_WHITELIST}
      source={source}
      style={style}
      onMessage={handleMessage}
      // The chat scrolls; the widget is exactly as tall as its content.
      scrollEnabled={false}
      javaScriptEnabled
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      // A widget is a fragment in a conversation, not a page — no zooming,
      // no text-size drift away from the surrounding chat.
      setBuiltInZoomControls={false}
      textZoom={100}
    />
  );
}
