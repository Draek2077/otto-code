import { useCallback, useEffect, useRef, useState } from "react";
import type { MermaidRenderRequest } from "./render-model";
import { getIsElectron } from "@/constants/platform";
import { ElectronMermaidRuntime } from "./otto/electron-runtime.web";
import {
  parseMermaidRuntimeMessage,
  type MermaidRuntimeMessage,
  type MermaidRuntimeRenderMessage,
} from "./runtime/messages";
import { MermaidRuntimeRequestDriver } from "./runtime/request-driver";

export type MermaidRenderedMessage = Extract<MermaidRuntimeMessage, { type: "rendered" }>;

export interface MermaidIframeRuntimeProps {
  request: MermaidRenderRequest | null;
  onRendered: (message: MermaidRenderedMessage) => void;
  onRenderFailed: (revision: number) => void;
}

export interface LoadedMermaidRuntimeProps extends MermaidIframeRuntimeProps {
  runtimeHtml: string;
}

/** Sandboxed Mermaid renderer. Sizing and gestures belong to the surrounding viewport. */
function BrowserMermaidRuntime({
  request,
  onRendered,
  onRenderFailed,
  runtimeHtml,
}: LoadedMermaidRuntimeProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const driverRef = useRef<MermaidRuntimeRequestDriver | null>(null);
  driverRef.current ??= new MermaidRuntimeRequestDriver();

  const sendRequest = useCallback((current: MermaidRenderRequest | null) => {
    const target = iframeRef.current?.contentWindow;
    if (!current || !target) return;
    const message: MermaidRuntimeRenderMessage = {
      type: "render",
      revision: current.revision,
      source: current.source,
      colorScheme: current.colorScheme,
      themeKey: current.themeKey,
      themeVariables: current.themeVariables,
      interactive: false,
    };
    target.postMessage(message, "*");
  }, []);

  useEffect(() => {
    sendRequest(driverRef.current?.update(request) ?? null);
  }, [request, sendRequest]);

  useEffect(() => {
    function receiveMessage(event: MessageEvent): void {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const message = parseMermaidRuntimeMessage(event.data);
      if (!message) return;
      if (message.type === "bridgeReady") {
        sendRequest(driverRef.current?.ready() ?? null);
        return;
      }
      if (message.type === "renderError") {
        onRenderFailed(message.revision);
        sendRequest(driverRef.current?.settled(message.revision, false) ?? null);
        return;
      }
      onRendered(message);
      sendRequest(driverRef.current?.settled(message.revision, true) ?? null);
    }
    window.addEventListener("message", receiveMessage);
    return () => window.removeEventListener("message", receiveMessage);
  }, [onRenderFailed, onRendered, sendRequest]);

  // `inert` (not just tabIndex) because the Modal focus trap focuses descendants
  // programmatically; a focused iframe swallows every keystroke, including Escape.
  return (
    <iframe
      ref={iframeRef}
      title=""
      aria-hidden
      inert
      sandbox="allow-scripts"
      srcDoc={runtimeHtml}
      tabIndex={-1}
      style={iframeStyle}
    />
  );
}

const iframeStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
  border: 0,
  pointerEvents: "none",
  background: "transparent",
};

// The browser and desktop transports share one lazy runtime payload and request contract.
let runtimeHtmlPromise: Promise<string> | null = null;
function loadRuntimeHtml(): Promise<string> {
  runtimeHtmlPromise ??= import("./runtime/html.gen").then((module) => module.mermaidRuntimeHtml);
  return runtimeHtmlPromise;
}

export function MermaidIframeRuntime(props: MermaidIframeRuntimeProps) {
  const [runtimeHtml, setRuntimeHtml] = useState<string | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  useEffect(() => {
    let cancelled = false;
    void loadRuntimeHtml().then(
      (html) => {
        if (!cancelled) setRuntimeHtml(html);
        return html;
      },
      () => {
        const current = propsRef.current;
        if (!cancelled && current.request) current.onRenderFailed(current.request.revision);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);
  if (!runtimeHtml) return null;
  return getIsElectron() ? (
    <ElectronMermaidRuntime {...props} runtimeHtml={runtimeHtml} />
  ) : (
    <BrowserMermaidRuntime {...props} runtimeHtml={runtimeHtml} />
  );
}
