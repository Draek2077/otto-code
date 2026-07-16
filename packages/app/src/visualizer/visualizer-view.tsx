import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { StyleSheet } from "react-native-unistyles";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import {
  applyVisualizerRenderScale,
  applyVisualizerTheme,
  loadVisualizerHtml,
} from "@/visualizer/load-visualizer-html";
import type {
  VisualizerHostMessage,
  VisualizerViewHandle,
  VisualizerViewProps,
} from "@/visualizer/visualizer-view-types";

// react-native-webview always allows "about:blank" (the origin of the initial
// source={{ html }} document) regardless of this list — see
// artifact-html-view.tsx for the same note.
const ORIGIN_WHITELIST: string[] = [];

/** Native renderer for the Visualizer. Runs in an isolated WebView; the bundle
 * needs its own JS to render the graph, so script execution stays enabled. */
export const VisualizerView = forwardRef<VisualizerViewHandle, VisualizerViewProps>(
  function VisualizerView(
    { onMessage, renderScale = 1, themeJson, themeBackground },
    ref,
  ): ReactElement | null {
    const webviewRef = useRef<WebView | null>(null);
    const [rawHtml, setRawHtml] = useState<string | null>(null);

    useEffect(() => {
      let cancelled = false;
      const load = async () => {
        const loaded = await loadVisualizerHtml();
        if (!cancelled) {
          setRawHtml(loaded);
        }
      };
      void load();
      return () => {
        cancelled = true;
      };
    }, []);

    // A scale or theme change produces a new source html, reloading the guest.
    const html = useMemo(() => {
      if (rawHtml === null) {
        return null;
      }
      const scaled = applyVisualizerRenderScale(rawHtml, renderScale);
      return themeJson ? applyVisualizerTheme(scaled, themeJson) : scaled;
    }, [rawHtml, renderScale, themeJson]);

    useImperativeHandle(
      ref,
      () => ({
        postMessage(message) {
          // Escape "</" so a stray closing-script-tag sequence inside the
          // JSON payload can't terminate the injected <script> early.
          const payload = JSON.stringify(message).replace(/</g, "\\u003c");
          webviewRef.current?.injectJavaScript(
            `window.dispatchEvent(new MessageEvent("message", { data: ${payload} })); true;`,
          );
        },
      }),
      [],
    );

    const handleMessage = useCallback(
      (event: WebViewMessageEvent) => {
        if (!onMessage) {
          return;
        }
        try {
          const data = JSON.parse(event.nativeEvent.data);
          if (data && typeof data.type === "string") {
            onMessage(data as VisualizerHostMessage);
          }
        } catch {
          // Malformed payload from the guest — drop it.
        }
      },
      [onMessage],
    );

    const source = useMemo(() => (html ? { html } : undefined), [html]);
    const webviewStyle = useMemo(
      () => [styles.webview, themeBackground ? { backgroundColor: themeBackground } : null],
      [themeBackground],
    );

    if (!source) {
      return null;
    }

    return (
      <WebView
        ref={webviewRef}
        originWhitelist={ORIGIN_WHITELIST}
        source={source}
        style={webviewStyle}
        javaScriptEnabled
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        onMessage={handleMessage}
      />
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  webview: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
}));
