import React, { useCallback, useEffect, useRef, useState } from "react";
import type { LoadedMermaidRuntimeProps } from "../iframe-runtime.web";
import type { MermaidRenderRequest } from "../render-model";
import {
  parseMermaidRuntimeMessage,
  serializeMermaidRuntimeRenderMessage,
  type MermaidRuntimeRenderMessage,
} from "../runtime/messages";
import { MermaidRuntimeRequestDriver } from "../runtime/request-driver";

type MermaidWebview = HTMLElement & {
  src: string;
  isConnected: boolean;
  executeJavaScript?: (code: string) => Promise<unknown>;
};

interface WebviewConsoleMessageEvent extends Event {
  message?: string;
}

// Must match MERMAID_WEBVIEW_PARTITION in
// packages/desktop/src/features/mermaid-webview.ts.
const MERMAID_WEBVIEW_PARTITION = "otto-mermaid-runtime";
const MERMAID_WEBVIEW_MESSAGE_PREFIX = "__OTTO_MERMAID__";

// Electron leaves a guest with an oversized data: URL on about:blank. Mermaid's
// encoded runtime is roughly 9 MB, so load this small, static bootstrap URL and
// deliver the real document through executeJavaScript after the guest is ready.
const MERMAID_WEBVIEW_BOOTSTRAP_HTML = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"><script>window.__OTTO_MERMAID_RUNTIME_LOAD__ = (html) => { document.open(); document.write(html); document.close(); };</script>`;

function toDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/**
 * The Electron shell injects `script-src 'self'` into its default session.
 * A srcDoc iframe inherits that policy, blocking Mermaid's self-contained
 * inline runtime before it can send bridgeReady. An isolated guest session is
 * the established desktop escape hatch for script-owning content.
 */
export function ElectronMermaidRuntime({
  request,
  onRendered,
  onRenderFailed,
  runtimeHtml,
}: LoadedMermaidRuntimeProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const webviewRef = useRef<MermaidWebview | null>(null);
  const driverRef = useRef<MermaidRuntimeRequestDriver | null>(null);
  const onRenderedRef = useRef(onRendered);
  const onRenderFailedRef = useRef(onRenderFailed);
  const requestRef = useRef(request);
  const [artifact, setArtifact] = useState<string | null>(null);
  const [artifactUrl, setArtifactUrl] = useState<string | null>(null);
  onRenderedRef.current = onRendered;
  onRenderFailedRef.current = onRenderFailed;
  requestRef.current = request;
  driverRef.current ??= new MermaidRuntimeRequestDriver();

  const sendRequest = useCallback((current: MermaidRenderRequest | null) => {
    const webview = webviewRef.current;
    if (!current || !webview?.isConnected) {
      return;
    }
    const message: MermaidRuntimeRenderMessage = {
      type: "render",
      revision: current.revision,
      source: current.source,
      colorScheme: current.colorScheme,
      themeVariables: current.themeVariables,
      themeKey: current.themeKey,
      interactive: false,
    };
    const payload = serializeMermaidRuntimeRenderMessage(message);
    void webview.executeJavaScript?.(
      `window.__OTTO_MERMAID_RUNTIME_RECEIVE__ && window.__OTTO_MERMAID_RUNTIME_RECEIVE__(${payload}); true;`,
    );
  }, []);

  useEffect(() => {
    sendRequest(driverRef.current?.update(request) ?? null);
  }, [request, sendRequest]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const webview = document.createElement("webview") as MermaidWebview;
    webview.setAttribute("partition", MERMAID_WEBVIEW_PARTITION);
    webview.style.display = "block";
    webview.style.width = "100%";
    webview.style.height = "100%";
    webview.style.border = "0";
    webview.style.background = "transparent";
    webview.src = toDataUrl(MERMAID_WEBVIEW_BOOTSTRAP_HTML);

    const handleDomReady = () => {
      // The actual runtime writes a replacement document and triggers another
      // dom-ready. Only the bootstrap pass installs the host bridge and loads
      // that document; the runtime's own bridgeReady then drives the queue.
      if (webview.dataset.mermaidRuntimeLoaded === "true") {
        return;
      }
      webview.dataset.mermaidRuntimeLoaded = "true";
      const installBridge = webview.executeJavaScript?.(
        `window.ReactNativeWebView = { postMessage: function (payload) { console.log(${JSON.stringify(MERMAID_WEBVIEW_MESSAGE_PREFIX)} + payload); } }; true;`,
      );
      if (!installBridge) {
        return;
      }
      void installBridge
        .then(() =>
          webview.executeJavaScript?.(
            `window.__OTTO_MERMAID_RUNTIME_LOAD__(${JSON.stringify(runtimeHtml)}); true;`,
          ),
        )
        .catch(() => onRenderFailedRef.current(requestRef.current?.revision ?? 0));
    };
    const handleConsoleMessage = (event: Event) => {
      const raw = (event as WebviewConsoleMessageEvent).message;
      if (!raw?.startsWith(MERMAID_WEBVIEW_MESSAGE_PREFIX)) {
        return;
      }
      let message: ReturnType<typeof parseMermaidRuntimeMessage>;
      try {
        message = parseMermaidRuntimeMessage(
          JSON.parse(raw.slice(MERMAID_WEBVIEW_MESSAGE_PREFIX.length)),
        );
      } catch {
        return;
      }
      if (!message) {
        return;
      }
      if (message.type === "bridgeReady") {
        sendRequest(driverRef.current?.ready() ?? null);
        return;
      }
      if (message.type === "renderError") {
        onRenderFailedRef.current(message.revision);
        sendRequest(driverRef.current?.settled(message.revision, false) ?? null);
        return;
      }
      if (message.svg) {
        setArtifact(message.svg);
      }
      onRenderedRef.current(message);
      sendRequest(driverRef.current?.settled(message.revision, true) ?? null);
    };

    webview.addEventListener("dom-ready", handleDomReady);
    webview.addEventListener("console-message", handleConsoleMessage);
    webviewRef.current = webview;
    host.appendChild(webview);
    return () => {
      webview.removeEventListener("dom-ready", handleDomReady);
      webview.removeEventListener("console-message", handleConsoleMessage);
      webview.remove();
      webviewRef.current = null;
    };
  }, [runtimeHtml, sendRequest]);

  useEffect(() => {
    if (!artifact) {
      setArtifactUrl(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([artifact], { type: "image/svg+xml" }));
    setArtifactUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [artifact]);
  return (
    <>
      <div ref={hostRef} style={electronRuntimeStyle} />
      {artifactUrl ? <img src={artifactUrl} alt="" aria-hidden style={artifactStyle} /> : null}
    </>
  );
}

const artifactStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
  pointerEvents: "none",
};
const electronRuntimeStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  opacity: 0,
  overflow: "hidden",
  pointerEvents: "none",
};
