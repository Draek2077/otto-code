import { useEffect, useMemo, useRef, type CSSProperties, type ReactElement } from "react";
import {
  INTERACTIVE_VIEW_MESSAGE_PREFIX,
  parseInteractiveViewGuestEvent,
} from "@/architectural-views/view-bridge";
import {
  INTERACTIVE_VIEW_NOT_READY,
  InteractiveViewRequests,
  interactiveViewCommandTimeoutMs,
  type InteractiveViewFrameProps,
} from "@/components/architectural-views/interactive-view-frame-types";

const IFRAME_STYLE: CSSProperties = {
  flex: 1,
  width: "100%",
  height: "100%",
  border: "none",
};

/**
 * Browser renderer for an Interactive View. The sandbox omits
 * `allow-same-origin`, so the guest cannot reach the app; commands and results
 * cross only as prefixed `postMessage` strings.
 */
export function InteractiveViewFrame({
  html,
  background,
  handleRef,
  onEvent,
}: InteractiveViewFrameProps): ReactElement {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const readyRef = useRef(false);
  const requestsRef = useRef(new InteractiveViewRequests());
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    const requests = requestsRef.current;
    handleRef.current = {
      run: (command) => {
        const target = iframeRef.current?.contentWindow;
        if (!target || !readyRef.current) return Promise.resolve(INTERACTIVE_VIEW_NOT_READY);
        const { id, promise } = requests.begin(interactiveViewCommandTimeoutMs(command));
        target.postMessage(
          `${INTERACTIVE_VIEW_MESSAGE_PREFIX}${JSON.stringify({ id, command })}`,
          "*",
        );
        return promise;
      },
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const message = parseInteractiveViewGuestEvent(event.data);
      if (!message) return;
      if (message.type === "result") {
        requests.settle(message.id, message.result);
        return;
      }
      if (message.type === "ready") readyRef.current = true;
      onEventRef.current(message);
    };
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      handleRef.current = null;
      requests.cancelAll();
    };
  }, [handleRef]);

  useEffect(() => {
    readyRef.current = false;
    requestsRef.current.cancelAll();
  }, [html]);

  const style = useMemo<CSSProperties>(() => ({ ...IFRAME_STYLE, background }), [background]);

  return (
    <iframe
      ref={iframeRef}
      title="Interactive View"
      srcDoc={html}
      sandbox="allow-scripts"
      style={style}
    />
  );
}
