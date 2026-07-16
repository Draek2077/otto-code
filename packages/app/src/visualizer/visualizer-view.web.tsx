import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from "react";
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

const IFRAME_STYLE: CSSProperties = {
  flex: 1,
  width: "100%",
  height: "100%",
  border: "none",
  background: "#000",
};

/** Web renderer for the Visualizer. A sandboxed iframe with no `allow-same-origin`
 * isolates the bundle from the host app while still letting its scripts run — the
 * page needs zero cooperation, it falls back to `window.parent.postMessage`. */
export const VisualizerView = forwardRef<VisualizerViewHandle, VisualizerViewProps>(
  function VisualizerView(
    { onMessage, renderScale = 1, themeJson, themeBackground },
    ref,
  ): ReactElement | null {
    const iframeRef = useRef<HTMLIFrameElement | null>(null);
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

    // A scale or theme change produces a new srcDoc, reloading the guest.
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
          iframeRef.current?.contentWindow?.postMessage(message, "*");
        },
      }),
      [],
    );

    const iframeStyle = useMemo(
      () => (themeBackground ? { ...IFRAME_STYLE, background: themeBackground } : IFRAME_STYLE),
      [themeBackground],
    );

    useEffect(() => {
      if (!onMessage) {
        return;
      }
      const handleWindowMessage = (event: MessageEvent) => {
        if (event.source !== iframeRef.current?.contentWindow) {
          return;
        }
        const data = event.data;
        if (!data || typeof data.type !== "string") {
          return;
        }
        onMessage(data as VisualizerHostMessage);
      };
      window.addEventListener("message", handleWindowMessage);
      return () => window.removeEventListener("message", handleWindowMessage);
    }, [onMessage]);

    if (!html) {
      return null;
    }

    return (
      <iframe
        ref={iframeRef}
        title="visualizer"
        srcDoc={html}
        sandbox="allow-scripts"
        style={iframeStyle}
      />
    );
  },
);
