import { useEffect, useRef } from "react";
import type { VisualizerFrameProps } from "./frame-types";
interface VisualizerWebview extends HTMLElement {
  src: string;
  executeJavaScript(code: string): Promise<unknown>;
}
const style = {
  position: "relative" as const,
  flex: 1,
  width: "100%",
  height: "100%",
  overflow: "hidden",
};
const PREFIX = "__OTTO_VISUALIZER_V1__";
const inject = `window.__ottoVisualizerPost=function(message){console.log(${JSON.stringify(PREFIX)}+message)};true;`;
export function VisualizerFrame({ html, onMessage, onTransport, onFailure }: VisualizerFrameProps) {
  const host = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let guest: VisualizerWebview | null = null,
      ready = false,
      active = true;
    const execute = (code: string) => {
      if (!guest || !ready || !active) return;
      void guest.executeJavaScript(code).catch(() => {
        if (active) onFailure("The Visualizer renderer stopped. Reopen it to reconnect.");
      });
    };
    const message = (event: Event) => {
      if (
        !("message" in event) ||
        typeof event.message !== "string" ||
        !event.message.startsWith(PREFIX)
      )
        return;
      onMessage(event.message.slice(PREFIX.length));
    };
    const failed = () => {
      if (active) onFailure("The Visualizer renderer could not be loaded.");
    };
    const loaded = () => {
      ready = true;
      execute(inject);
      // The initial React-ready message precedes the isolated transport injection.
      // Publish a fresh handshake only after all child subscriptions have mounted.
      execute(
        "if(window.__OTTO_VISUALIZER_READY__)window.__ottoVisualizerPost(JSON.stringify({version:1,channel:window.__OTTO_VISUALIZER_CHANNEL__,message:{type:'ready'}}));true;",
      );
    };
    const resize = () => {
      if (!active) return;
      const bounds = node.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      if (!guest) {
        guest = document.createElement("webview") as VisualizerWebview;
        guest.setAttribute("partition", "otto-visualizer");
        guest.setAttribute("autosize", "on");
        guest.setAttribute("minwidth", "0");
        guest.setAttribute("minheight", "0");
        guest.setAttribute("maxwidth", "10000");
        guest.setAttribute("maxheight", "10000");
        guest.style.position = "absolute";
        guest.style.inset = "0";
        guest.style.border = "0";
        guest.src = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
        guest.addEventListener("dom-ready", loaded);
        guest.addEventListener("console-message", message);
        guest.addEventListener("did-fail-load", failed);
        guest.addEventListener("render-process-gone", failed);
        node.append(guest);
      }
      guest.style.width = `${Math.round(bounds.width)}px`;
      guest.style.height = `${Math.round(bounds.height)}px`;
    };
    onTransport((payload) =>
      execute(
        `window.__ottoVisualizerReceive&&window.__ottoVisualizerReceive(${JSON.stringify(payload)});true;`,
      ),
    );
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    resize();
    return () => {
      active = false;
      ready = false;
      observer.disconnect();
      onTransport(null);
      if (guest) {
        guest.removeEventListener("dom-ready", loaded);
        guest.removeEventListener("console-message", message);
        guest.removeEventListener("did-fail-load", failed);
        guest.removeEventListener("render-process-gone", failed);
        guest.remove();
        guest = null;
      }
    };
  }, [html, onMessage, onTransport, onFailure]);
  return <div ref={host} style={style} data-testid="visualizer-electron-guest" />;
}
