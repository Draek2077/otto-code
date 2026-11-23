import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { StyleSheet } from "react-native-unistyles";
import { v4 as uuid } from "uuid";
import { Alert } from "@/components/ui/alert";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { NativeEditorMessage, type NativeEditorInput } from "./bridge";
import { editorWebViewHtml } from "./webview-html";
import type { EditorRendererProps } from "./props";
import { NativeEditorConfigurationCache } from "./config-cache";

const source = { html: editorWebViewHtml };
const origins = ["about:blank"];
const allowNavigation = ({ url }: { url: string }) => url === "about:blank";
function readNativeMessage(data: string, report: (message: string) => void) {
  if (data.length > 5 * 1024 * 1024) return null;
  try {
    const result = NativeEditorMessage.safeParse(JSON.parse(data));
    return result.success ? result.data : null;
  } catch {
    report("The native editor sent an unreadable message.");
    return null;
  }
}

export function EditorRenderer(props: EditorRendererProps) {
  const webview = useRef<WebView>(null);
  const [session, setSession] = useState<string | null>(null);
  const acceptedSequence = useRef(0);
  const [configurationCache] = useState(() => new NativeEditorConfigurationCache());
  const [error, setError] = useState<string | null>(null);
  const snapshot = useSyncExternalStore(props.model.subscribe, props.model.getSnapshot);
  const retained = useRetainedPanelActive();
  const visible = useAppVisible();
  const active = retained && visible;
  const activity = useRef({ active, revision: 0 });
  if (activity.current.active !== active)
    activity.current = { active, revision: activity.current.revision + 1 };
  const live = useRef({ props, session, active });
  live.current = { props, session, active };
  const send = useCallback((message: NativeEditorInput) => {
    const encoded = JSON.stringify(message).replace(/</gu, "\\u003c");
    webview.current?.injectJavaScript(`window.__OTTO_EDITOR_RECEIVE__?.(${encoded});true;`);
  }, []);
  const configure = useCallback(() => {
    const current = live.current;
    if (!current.session) return;
    const state = current.props.model.getSnapshot();
    const config = {
      type: "config" as const,
      acknowledgedSequence: acceptedSequence.current,
      session: current.session,
      text: state.content,
      filename: current.props.filename,
      vimEnabled: current.props.vimEnabled,
      theme: current.props.theme,
      active: current.active && current.props.code.active(),
      scrollLinked: current.props.code.scroll?.enabled() ?? false,
      activation: activity.current.revision + current.props.code.activation(),
      lineStart: current.props.location.lineStart,
      lineEnd: current.props.location.lineEnd,
      columnStart: current.props.location.columnStart,
      columnEnd: current.props.location.columnEnd,
      navigationRevision: current.props.navigationRevision,
      diagnostics: current.props.code.diagnostics(),
      preferences: current.props.code.rendering(),
      markdown: current.props.code.markdown(),
      keyBindings: current.props.code.keyBindings(),
    };
    if (configurationCache.accept(config))
      send({ ...config, diagnostics: [...config.diagnostics] });
  }, [send, configurationCache]);
  useEffect(() => {
    configure();
  }, [
    configure,
    session,
    snapshot.content,
    props.filename,
    props.vimEnabled,
    props.theme,
    props.location,
    props.navigationRevision,
    active,
    props.code,
  ]);
  useEffect(() => props.code.subscribe(configure), [props.code, configure]);
  useEffect(
    () =>
      props.code.scroll?.subscribe((fraction) => {
        const current = live.current;
        if (current.session && current.active && current.props.code.active())
          send({ type: "scroll", session: current.session, fraction });
      }),
    [props.code, send],
  );
  useEffect(
    () =>
      props.code.onCommand((command) => {
        const current = live.current;
        if (current.session && current.active)
          send({ type: "command", session: current.session, command });
        return Boolean(current.session && current.active);
      }),
    [props.code, send],
  );
  const receive = useCallback(
    (event: WebViewMessageEvent) => {
      const message = readNativeMessage(event.nativeEvent.data, setError);
      if (!message) return;
      if (message.type === "ready") {
        acceptedSequence.current = 0;
        setSession(uuid());
        setError(null);
        return;
      }
      const current = live.current;
      if (!current.active || message.session !== current.session) return;
      switch (message.type) {
        case "scroll":
          current.props.code.scroll?.report(message.fraction);
          break;
        case "change": {
          if (message.sequence <= acceptedSequence.current) return;
          acceptedSequence.current = message.sequence;
          const separator = current.props.model.getSnapshot().lineSeparator;
          current.props.model.edit(message.text.replace(/\n/gu, separator));
          break;
        }
        case "cursor":
          current.props.code.position(message.position);
          current.props.onCursorChange({
            line: message.position.line + 1,
            column: message.position.character + 1,
          });
          break;
        case "selection":
          current.props.code.selection(message.characters, message.lines, message.range);
          break;
        case "vim":
          current.props.onVimModeChange(message.mode);
          break;
        case "leader":
          current.props.code.leaderPending(message.sequence);
          break;
        case "vim-action":
          current.props.code.vimAction(message.action);
          break;
        case "save":
          void current.props.model.save();
          break;
        case "action":
          current.props.code.action(message.action);
          break;
        case "error":
          setError(message.message);
          break;
        case "image": {
          setError(null);
          void current.props.code
            .writeImage(message.image)
            .then((insert) => {
              if (live.current.session === message.session && live.current.active)
                send({
                  type: "image-result",
                  session: message.session,
                  id: message.id,
                  insert,
                  error: null,
                });
              return undefined;
            })
            .catch((failure) => {
              if (live.current.session === message.session && live.current.active)
                send({
                  type: "image-result",
                  session: message.session,
                  id: message.id,
                  insert: null,
                  error: failure instanceof Error ? failure.message : "Image paste failed.",
                });
            });
          break;
        }
        case "query": {
          void current.props.code
            .request(message.action, message.position)
            .then((response) => {
              if (live.current.session === message.session && live.current.active)
                send({
                  type: "query-result",
                  session: message.session,
                  id: message.id,
                  result: response,
                });
              return undefined;
            })
            .catch((failure) => {
              if (live.current.session === message.session && live.current.active) {
                setError(failure instanceof Error ? failure.message : "The editor query failed.");
                send({
                  type: "query-result",
                  session: message.session,
                  id: message.id,
                  result: null,
                });
              }
            });
          break;
        }
      }
    },
    [send],
  );
  const failed = useCallback(() => {
    setSession(null);
    setError(
      "The native editor stopped. Reload the file tab to recover; your draft remains in Otto.",
    );
  }, []);
  const webStyle = useMemo(
    () => ({ flex: 1, backgroundColor: props.theme.background }),
    [props.theme.background],
  );
  return (
    <View style={styles.container} testID="otto-native-source-editor">
      {error ? <Alert variant="error">{error}</Alert> : null}
      <WebView
        ref={webview}
        source={source}
        originWhitelist={origins}
        onShouldStartLoadWithRequest={allowNavigation}
        onMessage={receive}
        onError={failed}
        onContentProcessDidTerminate={failed}
        onRenderProcessGone={failed}
        javaScriptEnabled
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        domStorageEnabled={false}
        mixedContentMode="never"
        setSupportMultipleWindows={false}
        hideKeyboardAccessoryView={false}
        keyboardDisplayRequiresUserAction={false}
        scrollEnabled={false}
        bounces={false}
        style={webStyle}
      />
    </View>
  );
}
const styles = StyleSheet.create({ container: { flex: 1, minWidth: 0, minHeight: 0 } });
