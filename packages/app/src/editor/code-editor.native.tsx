import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { ComponentProps } from "react";
import type {
  CodeEditorProps,
  EditorController,
  EditorSelection,
  EditorWebViewInbound,
  EditorWebViewOutbound,
} from "./editor-contract";
import { editorWebViewHtml } from "./webview/editor-webview-html";

// Native host: CM6 runs inside a react-native-webview (the terminal's proven
// pattern — see terminal-emulator.native.tsx). One editor per webview; the
// bridge speaks the typed contract from editor-contract.ts.

const EDITOR_WEBVIEW_SOURCE = { html: editorWebViewHtml };
const EDITOR_WEBVIEW_ORIGIN_WHITELIST = ["*"];
const GET_DOC_TIMEOUT_MS = 5_000;

type WebViewProps = ComponentProps<typeof WebView>;

function serializeForInjectedJavaScript(message: EditorWebViewInbound): string {
  return JSON.stringify(message).replace(/<\/script/gi, "<\\/script");
}

interface PendingDocRequest {
  resolve: (doc: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingSelectionRequest {
  resolve: (selection: EditorSelection) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function settlePendingRequest<T>(
  map: Map<number, { resolve: (value: T) => void; timer: ReturnType<typeof setTimeout> }>,
  requestId: number,
  value: T,
): void {
  const pending = map.get(requestId);
  if (!pending) {
    return;
  }
  map.delete(requestId);
  clearTimeout(pending.timer);
  pending.resolve(value);
}

export function CodeEditor(props: CodeEditorProps) {
  const webViewRef = useRef<WebView | null>(null);
  const bridgeReadyRef = useRef(false);
  const pendingMessagesRef = useRef<EditorWebViewInbound[]>([]);
  // Last content the webview mirrored over the bridge; used only to survive a
  // render-process death, never for saves (those round-trip getDoc).
  const lastDocRef = useRef(props.initialDoc);
  const pendingDocRequestsRef = useRef(new Map<number, PendingDocRequest>());
  const pendingSelectionRequestsRef = useRef(new Map<number, PendingSelectionRequest>());
  const nextRequestIdRef = useRef(1);
  const controllerAnnouncedRef = useRef(false);
  const [webViewEpoch, setWebViewEpoch] = useState(0);

  const callbacksRef = useRef(props);
  callbacksRef.current = props;

  const sendToWebView = useCallback((message: EditorWebViewInbound) => {
    if (!bridgeReadyRef.current || !webViewRef.current) {
      pendingMessagesRef.current.push(message);
      return;
    }
    const payload = serializeForInjectedJavaScript(message);
    webViewRef.current.injectJavaScript(
      `window.__OTTO_EDITOR_WEBVIEW_RECEIVE__ && window.__OTTO_EDITOR_WEBVIEW_RECEIVE__(${payload}); true;`,
    );
  }, []);

  const controller = useMemo<EditorController>(
    () => ({
      getDoc: () =>
        new Promise<string>((resolve, reject) => {
          const requestId = nextRequestIdRef.current;
          nextRequestIdRef.current += 1;
          const timer = setTimeout(() => {
            pendingDocRequestsRef.current.delete(requestId);
            reject(new Error("Editor did not respond"));
          }, GET_DOC_TIMEOUT_MS);
          pendingDocRequestsRef.current.set(requestId, { resolve, reject, timer });
          sendToWebView({ type: "getDoc", requestId });
        }),
      getSelection: () =>
        new Promise<EditorSelection>((resolve, reject) => {
          const requestId = nextRequestIdRef.current;
          nextRequestIdRef.current += 1;
          const timer = setTimeout(() => {
            pendingSelectionRequestsRef.current.delete(requestId);
            reject(new Error("Editor did not respond"));
          }, GET_DOC_TIMEOUT_MS);
          pendingSelectionRequestsRef.current.set(requestId, { resolve, reject, timer });
          sendToWebView({ type: "getSelection", requestId });
        }),
      setDoc: (doc) => {
        lastDocRef.current = doc;
        sendToWebView({ type: "setDoc", doc });
      },
      markClean: () => sendToWebView({ type: "markClean" }),
      setFind: (find) => sendToWebView({ type: "setFind", find }),
      findNext: () => sendToWebView({ type: "findNext" }),
      findPrevious: () => sendToWebView({ type: "findPrevious" }),
      replaceNext: () => sendToWebView({ type: "replaceNext" }),
      replaceAll: () => sendToWebView({ type: "replaceAll" }),
      focus: () => {
        sendToWebView({ type: "focus" });
        webViewRef.current?.requestFocus();
      },
      goToLine: (line) => sendToWebView({ type: "goToLine", line }),
      selectLines: (startLine, endLine) =>
        sendToWebView({ type: "selectLines", startLine, endLine }),
    }),
    [sendToWebView],
  );

  const handleBridgeReady = useCallback(() => {
    bridgeReadyRef.current = true;
    sendToWebView({
      type: "mount",
      path: callbacksRef.current.path,
      doc: lastDocRef.current,
      theme: callbacksRef.current.theme,
      wordWrap: callbacksRef.current.wordWrap,
    });
    const queued = pendingMessagesRef.current.splice(0);
    for (const queuedMessage of queued) {
      sendToWebView(queuedMessage);
    }
    if (!controllerAnnouncedRef.current) {
      controllerAnnouncedRef.current = true;
      callbacksRef.current.onReady?.(controller);
    }
  }, [controller, sendToWebView]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let message: EditorWebViewOutbound;
      try {
        message = JSON.parse(event.nativeEvent.data) as EditorWebViewOutbound;
      } catch {
        return;
      }
      switch (message.type) {
        case "bridgeReady":
          handleBridgeReady();
          break;
        case "dirtyChanged":
          callbacksRef.current.onDirtyChanged?.(message.dirty);
          break;
        case "matchInfo":
          callbacksRef.current.onMatchInfo?.(message.info);
          break;
        case "cursorMoved":
          callbacksRef.current.onCursorMoved?.(message.position);
          break;
        case "saveShortcut":
          callbacksRef.current.onSaveShortcut?.();
          break;
        case "findShortcut":
          callbacksRef.current.onFindShortcut?.();
          break;
        case "goToLineShortcut":
          callbacksRef.current.onGoToLineShortcut?.();
          break;
        case "doc":
          lastDocRef.current = message.doc;
          settlePendingRequest(pendingDocRequestsRef.current, message.requestId, message.doc);
          break;
        case "selection":
          settlePendingRequest(
            pendingSelectionRequestsRef.current,
            message.requestId,
            message.selection,
          );
          break;
        case "docSync":
          lastDocRef.current = message.doc;
          callbacksRef.current.onDocSync?.(message.doc);
          break;
      }
    },
    [handleBridgeReady],
  );

  const resetWebViewDocument = useCallback(() => {
    bridgeReadyRef.current = false;
    pendingMessagesRef.current = [];
    // Remount with the last mirrored buffer; bridgeReady re-mounts the core.
    setWebViewEpoch((value) => value + 1);
  }, []);

  const handleLoadStart = useCallback<NonNullable<WebViewProps["onLoadStart"]>>(() => {
    bridgeReadyRef.current = false;
  }, []);

  const themeKey = useMemo(() => JSON.stringify(props.theme), [props.theme]);
  useEffect(() => {
    if (!bridgeReadyRef.current) {
      return;
    }
    sendToWebView({ type: "setTheme", theme: callbacksRef.current.theme });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendToWebView, themeKey]);

  useEffect(() => {
    if (!bridgeReadyRef.current) {
      return;
    }
    sendToWebView({ type: "setWordWrap", enabled: props.wordWrap });
  }, [props.wordWrap, sendToWebView]);

  useEffect(() => {
    const pendingDocRequests = pendingDocRequestsRef.current;
    const pendingSelectionRequests = pendingSelectionRequestsRef.current;
    return () => {
      for (const pending of pendingDocRequests.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Editor closed"));
      }
      pendingDocRequests.clear();
      for (const pending of pendingSelectionRequests.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Editor closed"));
      }
      pendingSelectionRequests.clear();
    };
  }, []);

  const rootStyle = useMemo<StyleProp<ViewStyle>>(
    () => [styles.root, { backgroundColor: props.theme.background }],
    [props.theme.background],
  );

  return (
    <View style={rootStyle}>
      <WebView
        key={webViewEpoch}
        ref={webViewRef}
        source={EDITOR_WEBVIEW_SOURCE}
        style={styles.webView}
        originWhitelist={EDITOR_WEBVIEW_ORIGIN_WHITELIST}
        scrollEnabled
        nestedScrollEnabled
        bounces={false}
        overScrollMode="never"
        keyboardDisplayRequiresUserAction={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        textInteractionEnabled
        allowsLinkPreview={false}
        setSupportMultipleWindows={false}
        setBuiltInZoomControls={false}
        setDisplayZoomControls={false}
        textZoom={100}
        onMessage={handleMessage}
        onLoadStart={handleLoadStart}
        onContentProcessDidTerminate={resetWebViewDocument}
        onRenderProcessGone={resetWebViewDocument}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden",
  },
  webView: {
    flex: 1,
    backgroundColor: "transparent",
  },
});
