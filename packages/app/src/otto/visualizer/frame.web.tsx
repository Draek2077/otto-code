import { useCallback, useEffect, useMemo, useRef } from "react";
import { visualizerFrameDocument } from "./frame-document";
import type { VisualizerFrameProps } from "./frame-types";
const style = { flex: 1, width: "100%", height: "100%", border: 0, background: "transparent" };
export function VisualizerFrame({ html, onMessage, onTransport, onFailure }: VisualizerFrameProps) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const document = useMemo(() => visualizerFrameDocument(html), [html]);
  const failed = useCallback(() => onFailure("The Visualizer could not be loaded."), [onFailure]);
  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source === frame.current?.contentWindow) onMessage(event.data);
    };
    window.addEventListener("message", receive);
    onTransport((message) => frame.current?.contentWindow?.postMessage(message, "*"));
    return () => {
      window.removeEventListener("message", receive);
      onTransport(null);
    };
  }, [onMessage, onTransport]);
  return (
    <iframe
      ref={frame}
      title="Visualizer"
      srcDoc={document}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
      onError={failed}
      style={style}
    />
  );
}
