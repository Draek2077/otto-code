import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { AgentVisualizer } from "@/components/agent-visualizer";
import { vscodeBridge } from "@/lib/vscode-bridge";
import { parseVisualizerFrame, visualizerFrame, VisualizerGuestMessage } from "./contracts";
import "./otto-globals.css";

// Otto embed entry - replaces vendor/agent-flow/web/webview-entry.tsx (which binds
// to acquireVsCodeApi). Binds the vendor bridge to whichever Otto host transport
// this page is running inside. Host -> page is uniform everywhere: a `message`
// event on window, which the vendor bridge already listens to. Page -> host varies:
//
//  - Electron <webview>: the host injects window.__ottoVisualizerPost (preload or
//    executeJavaScript). May arrive after this entry runs, hence lazy re-check.
//  - react-native-webview: window.ReactNativeWebView.postMessage (string payloads).
//  - sandboxed iframe (web): window.parent.postMessage.

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(message: string): void };
    __ottoVisualizerPost?: (message: string) => void;
    __ottoVisualizerReceive?: (message: unknown) => void;
    __OTTO_VISUALIZER_CHANNEL__?: string;
    __OTTO_VISUALIZER_READY__?: boolean;
  }
}

const channel = window.__OTTO_VISUALIZER_CHANNEL__;
if (!channel) throw new Error("Visualizer host channel is missing");
const identity = channel;
function postToHost(input: unknown): void {
  const result = VisualizerGuestMessage.safeParse(input);
  if (!result.success) return;
  const message = JSON.stringify(visualizerFrame(identity, result.data));
  if (window.__ottoVisualizerPost) {
    window.__ottoVisualizerPost(message);
    return;
  }
  const postNative = window.ReactNativeWebView?.postMessage;
  if (postNative) {
    postNative(message);
    return;
  }
  window.parent.postMessage(message, "*");
}

window.__ottoVisualizerReceive = (input) => {
  const command = parseVisualizerFrame(input, identity);
  if (!command) return;
  if (command.type === "otto-appearance") {
    window.dispatchEvent(new CustomEvent("otto-appearance", { detail: command }));
    return;
  }
  vscodeBridge?.receiveHostMessage(command);
};
window.addEventListener("message", (event) => {
  if (event.source === window.parent) window.__ottoVisualizerReceive?.(event.data);
});
vscodeBridge?.configureWebviewApi(postToHost);
function EmbeddedVisualizer() {
  // Child effects install the render subscriptions before this parent effect.
  useEffect(() => {
    window.__OTTO_VISUALIZER_READY__ = true;
    postToHost({ type: "ready" });
  }, []);
  return <AgentVisualizer />;
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element #root not found");
createRoot(rootElement).render(<EmbeddedVisualizer />);
