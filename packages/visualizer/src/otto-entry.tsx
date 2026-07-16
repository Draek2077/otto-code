import { createRoot } from "react-dom/client";
import { AgentVisualizer } from "@/components/agent-visualizer";
import { vscodeBridge } from "@/lib/vscode-bridge";
import "@/app/globals.css";

// Otto embed entry — replaces vendor/agent-flow/web/webview-entry.tsx (which binds
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
    __ottoVisualizerPost?: (message: Record<string, unknown>) => void;
  }
}

function postToHost(message: Record<string, unknown>): void {
  if (window.__ottoVisualizerPost) {
    window.__ottoVisualizerPost(message);
    return;
  }
  if (window.ReactNativeWebView) {
    // react-native-webview's bridge takes a single string argument — this is not Window.postMessage.
    // eslint-disable-next-line unicorn/require-post-message-target-origin
    window.ReactNativeWebView.postMessage(JSON.stringify(message));
    return;
  }
  window.parent.postMessage(message, "*");
}

if (vscodeBridge) {
  vscodeBridge.configureWebviewApi(postToHost);
  postToHost({ type: "ready" });
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element #root not found");
createRoot(rootElement).render(<AgentVisualizer />);
