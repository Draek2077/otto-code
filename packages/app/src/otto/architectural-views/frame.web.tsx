import { useEffect, useMemo, useRef } from "react";
import { architecturalFrameDocument } from "./frame-document";
import { INTERACTIVE_VIEW_MESSAGE_PREFIX } from "./view-bridge";
import type { ViewFrameProps } from "./frame-types";
const frameStyle = { width: "100%", height: "100%", border: 0, background: "transparent" };
export function ViewFrame({ html, channel, onMessage, onTransport }: ViewFrameProps) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const document = useMemo(() => architecturalFrameDocument(html, channel), [html, channel]);
  useEffect(() => {
    let active = true;
    const receive = (event: MessageEvent<unknown>) => {
      if (!active || event.source !== frame.current?.contentWindow) return;
      const data = event.data;
      if (
        !data ||
        typeof data !== "object" ||
        !("channel" in data) ||
        data.channel !== channel ||
        !("payload" in data)
      )
        return;
      onMessage(data.payload);
    };
    window.addEventListener("message", receive);
    onTransport((message) =>
      frame.current?.contentWindow?.postMessage(
        { channel, payload: INTERACTIVE_VIEW_MESSAGE_PREFIX + JSON.stringify(message) },
        "*",
      ),
    );
    return () => {
      active = false;
      window.removeEventListener("message", receive);
      onTransport(null);
    };
  }, [channel, onMessage, onTransport]);
  return (
    <iframe
      ref={frame}
      title="Architectural View"
      srcDoc={document}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
      style={frameStyle}
    />
  );
}
