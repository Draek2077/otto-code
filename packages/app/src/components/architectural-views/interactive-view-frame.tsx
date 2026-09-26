import { useCallback, useEffect, useMemo, useRef, type ReactElement } from "react";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import {
  parseInteractiveViewGuestEvent,
  serializeInteractiveViewCommand,
} from "@/architectural-views/view-bridge";
import {
  INTERACTIVE_VIEW_NOT_READY,
  InteractiveViewRequests,
  interactiveViewCommandTimeoutMs,
  type InteractiveViewFrameProps,
} from "@/components/architectural-views/interactive-view-frame-types";

// Same lockdown as native Artifacts: the View renders itself but cannot
// navigate anywhere, and the daemon CSP blocks every network request.
const ORIGIN_WHITELIST: string[] = [];

/** Native renderer for an Interactive View, bridged through the WebView. */
export function InteractiveViewFrame({
  html,
  background,
  handleRef,
  onEvent,
}: InteractiveViewFrameProps): ReactElement {
  const webviewRef = useRef<WebView | null>(null);
  const readyRef = useRef(false);
  const requestsRef = useRef(new InteractiveViewRequests());
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const source = useMemo(() => ({ html }), [html]);
  const style = useMemo(() => ({ flex: 1, backgroundColor: background }), [background]);

  useEffect(() => {
    const requests = requestsRef.current;
    handleRef.current = {
      run: (command) => {
        const webview = webviewRef.current;
        if (!webview || !readyRef.current) return Promise.resolve(INTERACTIVE_VIEW_NOT_READY);
        const { id, promise } = requests.begin(interactiveViewCommandTimeoutMs(command));
        webview.injectJavaScript(
          `window.__OTTO_VIEW__ && window.__OTTO_VIEW__.handle(${id}, ${serializeInteractiveViewCommand(command)}); true;`,
        );
        return promise;
      },
    };
    return () => {
      handleRef.current = null;
      requests.cancelAll();
    };
  }, [handleRef]);

  useEffect(() => {
    readyRef.current = false;
    requestsRef.current.cancelAll();
  }, [html]);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    const message = parseInteractiveViewGuestEvent(event.nativeEvent.data);
    if (!message) return;
    if (message.type === "result") {
      requestsRef.current.settle(message.id, message.result);
      return;
    }
    if (message.type === "ready") readyRef.current = true;
    onEventRef.current(message);
  }, []);

  return (
    <WebView
      ref={webviewRef}
      originWhitelist={ORIGIN_WHITELIST}
      source={source}
      style={style}
      javaScriptEnabled
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      onMessage={handleMessage}
    />
  );
}
