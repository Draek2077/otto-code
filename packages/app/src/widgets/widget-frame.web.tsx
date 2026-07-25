import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactElement,
} from "react";
import { parseWidgetGuestMessage } from "@otto-code/protocol/widgets/bridge";
import { WIDGET_PORT_HANDSHAKE } from "@otto-code/protocol/widgets/document";
import type { WidgetFrameProps } from "./widget-frame-types";

/**
 * Web widget renderer.
 *
 * `allow-same-origin` is deliberately absent, exactly as for artifacts — the
 * guest must not reach the parent document. That makes the frame's origin the
 * opaque string `"null"`, so `event.origin` on a plain `window.postMessage`
 * proves nothing and cannot be used to authenticate the guest.
 *
 * So the transport is a MessageChannel instead: the host mints a channel on
 * load, transfers one port into the guest, and listens on the other. Anything
 * arriving on that port came from the frame we handed it to. Identity is the
 * port, not the origin.
 */
export function WidgetFrame({
  html,
  widgetId,
  height,
  onGuestMessage,
}: WidgetFrameProps): ReactElement {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const portRef = useRef<MessagePort | null>(null);
  const onGuestMessageRef = useRef(onGuestMessage);
  onGuestMessageRef.current = onGuestMessage;

  const style = useMemo<CSSProperties>(
    () => ({ width: "100%", height, border: "none", background: "transparent", display: "block" }),
    [height],
  );

  const handshake = useCallback(() => {
    const frame = frameRef.current;
    const target = frame?.contentWindow;
    if (!target) {
      return;
    }
    portRef.current?.close();
    const channel = new MessageChannel();
    channel.port1.addEventListener("message", (event: MessageEvent) => {
      const message = parseWidgetGuestMessage(event.data);
      if (message && message.widgetId === widgetId) {
        onGuestMessageRef.current(message);
      }
    });
    // Required with addEventListener: unlike assigning `onmessage`, adding a
    // listener does not implicitly start the port, and frames would queue
    // forever.
    channel.port1.start();
    portRef.current = channel.port1;
    // "*" is correct here and not a weakening: the frame's origin is opaque, so
    // there is no origin to target. The capability is in the transferred port,
    // and it goes only to this frame's contentWindow.
    target.postMessage(WIDGET_PORT_HANDSHAKE, "*", [channel.port2]);
  }, [widgetId]);

  useEffect(() => {
    return () => {
      portRef.current?.close();
      portRef.current = null;
    };
  }, []);

  // A new document means the old port is talking to a frame that no longer
  // exists; `onLoad` fires again and re-hands a fresh one.
  return (
    <iframe
      ref={frameRef}
      title="widget"
      srcDoc={html}
      sandbox="allow-scripts allow-forms allow-modals"
      style={style}
      onLoad={handshake}
    />
  );
}
