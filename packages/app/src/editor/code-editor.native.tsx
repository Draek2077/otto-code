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

interface PendingWordRequest {
  resolve: (word: string) => void;
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

interface PendingRequestMaps {
  doc: Map<number, PendingDocRequest>;
  selection: Map<number, PendingSelectionRequest>;
  word: Map<number, PendingWordRequest>;
}

/**
 * The half of the outbound protocol that answers a `requestId`. Split out from
 * the pushed events below so neither switch grows past what one function should
 * be doing — every pull command adds a branch to exactly one of them.
 * Returns whether the message was a reply.
 */
function settlePendingReply(message: EditorWebViewOutbound, pending: PendingRequestMaps): boolean {
  switch (message.type) {
    case "doc":
      settlePendingRequest(pending.doc, message.requestId, message.doc);
      return true;
    case "selection":
      settlePendingRequest(pending.selection, message.requestId, message.selection);
      return true;
    case "wordAtCursor":
      settlePendingRequest(pending.word, message.requestId, message.word);
      return true;
    default:
      return false;
  }
}

/** The half the webview pushes on its own; forwarded straight to the host. */
function forwardPushedEvent(message: EditorWebViewOutbound, props: CodeEditorProps): void {
  switch (message.type) {
    case "dirtyChanged":
      props.onDirtyChanged?.(message.dirty);
      break;
    case "matchInfo":
      props.onMatchInfo?.(message.info);
      break;
    case "cursorMoved":
      props.onCursorMoved?.(message.position);
      break;
    case "saveShortcut":
      props.onSaveShortcut?.();
      break;
    case "findShortcut":
      props.onFindShortcut?.();
      break;
    case "closeFindShortcut":
      props.onCloseFindShortcut?.();
      break;
    case "goToLineShortcut":
      props.onGoToLineShortcut?.();
      break;
    case "goToDefinitionShortcut":
      props.onGoToDefinitionShortcut?.();
      break;
    case "docSync":
      props.onDocSync?.(message.doc);
      break;
  }
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
  const pendingWordRequestsRef = useRef(new Map<number, PendingWordRequest>());
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
      getWordAtCursor: () =>
        new Promise<string>((resolve, reject) => {
          const requestId = nextRequestIdRef.current;
          nextRequestIdRef.current += 1;
          const timer = setTimeout(() => {
            pendingWordRequestsRef.current.delete(requestId);
            reject(new Error("Editor did not respond"));
          }, GET_DOC_TIMEOUT_MS);
          pendingWordRequestsRef.current.set(requestId, { resolve, reject, timer });
          sendToWebView({ type: "getWordAtCursor", requestId });
        }),
      setDoc: (doc) => {
        lastDocRef.current = doc;
        sendToWebView({ type: "setDoc", doc });
      },
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
      selectLines: (startLine, endLine, options) =>
        sendToWebView({ type: "selectLines", startLine, endLine, reveal: options?.reveal }),
      selectAll: () => sendToWebView({ type: "selectAll" }),
      replaceSelection: (text) => sendToWebView({ type: "replaceSelection", text }),
      runMarkdownCommand: (name) => sendToWebView({ type: "runMarkdownCommand", name }),
      setDiagnostics: (diagnostics) => sendToWebView({ type: "setDiagnostics", diagnostics }),
    }),
    [sendToWebView],
  );

  const handleBridgeReady = useCallback(() => {
    bridgeReadyRef.current = true;
    sendToWebView({
      type: "mount",
      path: callbacksRef.current.path,
      doc: lastDocRef.current,
      // The live baseline, not the one this component mounted with: after a
      // render-process death the webview remounts mid-session, and the buffer
      // may have been saved or rebaselined since.
      cleanDoc: callbacksRef.current.cleanDoc,
      theme: callbacksRef.current.theme,
      wordWrap: callbacksRef.current.wordWrap,
    });
    const queued = pendingMessagesRef.current.splice(0);
    for (const queuedMessage of queued) {
      sendToWebView(queuedMessage);
    }
    // `mount` carries no diagnostics — it is the doc-and-theme contract — so a webview
    // that remounts mid-session (render-process death) has to be re-told what is broken,
    // or the file reads as clean until the server next republishes.
    const known = callbacksRef.current.diagnostics;
    if (known !== undefined && known.length > 0) {
      sendToWebView({ type: "setDiagnostics", diagnostics: known });
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
      if (message.type === "bridgeReady") {
        handleBridgeReady();
        return;
      }
      // Both doc-bearing messages refresh the crash-recovery mirror, so it is
      // updated once here rather than in each handler below.
      if (message.type === "doc" || message.type === "docSync") {
        lastDocRef.current = message.doc;
      }
      const settled = settlePendingReply(message, {
        doc: pendingDocRequestsRef.current,
        selection: pendingSelectionRequestsRef.current,
        word: pendingWordRequestsRef.current,
      });
      if (!settled) {
        forwardPushedEvent(message, callbacksRef.current);
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

  const diagnostics = props.diagnostics;
  useEffect(() => {
    if (bridgeReadyRef.current && diagnostics !== undefined) {
      sendToWebView({ type: "setDiagnostics", diagnostics });
    }
  }, [diagnostics, sendToWebView]);

  // The saved text is a prop, not a command (see CodeEditorProps.cleanDoc). The
  // mount message already carries the current value, so only later changes are
  // pushed — and only once the bridge is up, since a queued message would
  // otherwise arrive before the core exists.
  const mountedCleanDocRef = useRef(props.cleanDoc);
  useEffect(() => {
    if (props.cleanDoc === mountedCleanDocRef.current) {
      return;
    }
    mountedCleanDocRef.current = props.cleanDoc;
    if (!bridgeReadyRef.current) {
      return;
    }
    sendToWebView({ type: "setCleanDoc", doc: props.cleanDoc });
  }, [props.cleanDoc, sendToWebView]);

  useEffect(() => {
    const pendingDocRequests = pendingDocRequestsRef.current;
    const pendingSelectionRequests = pendingSelectionRequestsRef.current;
    const pendingWordRequests = pendingWordRequestsRef.current;
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
      for (const pending of pendingWordRequests.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Editor closed"));
      }
      pendingWordRequests.clear();
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
