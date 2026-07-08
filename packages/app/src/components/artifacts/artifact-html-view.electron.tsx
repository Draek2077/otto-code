import { createElement, useEffect, useRef, type CSSProperties, type ReactElement } from "react";
import { isElectronRuntime } from "@/desktop/host";

export interface ArtifactHtmlViewProps {
  html: string;
}

type ArtifactWebview = HTMLElement & {
  src: string;
  loadURL?: (url: string) => Promise<void>;
};

const HOST_STYLE: CSSProperties = {
  display: "flex",
  flex: 1,
  width: "100%",
  height: "100%",
};

// A dedicated, non-persistent partition puts the artifact guest on its own
// Electron session, separate from the app shell's defaultSession. The shell's
// strict CSP (script-src 'self') is injected only onto defaultSession
// (packages/desktop/src/main.ts) and is inherited by same-document iframes —
// which is why the plain srcDoc iframe in artifact-html-view.web.tsx gets its
// inline <script> tags blocked. A <webview> guest on its own session escapes
// that CSP, exactly like browser tabs do via their persist:otto-browser-*
// partitions, so interactive artifacts can run their own JavaScript.
const ARTIFACT_WEBVIEW_PARTITION = "otto-artifact-preview";

function toDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/** Electron renderer for artifact HTML. Renders into a <webview> guest (its own
 * session, exempt from the app-shell CSP) so artifact inline scripts run. A
 * srcDoc iframe would inherit the host CSP and have its scripts blocked. */
export function ArtifactHtmlView({ html }: ArtifactHtmlViewProps): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const webviewRef = useRef<ArtifactWebview | null>(null);

  // Create the webview once and mount it into the host div.
  useEffect(() => {
    if (!isElectronRuntime() || typeof document === "undefined") {
      return;
    }
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const webview = document.createElement("webview") as ArtifactWebview;
    webview.setAttribute("partition", ARTIFACT_WEBVIEW_PARTITION);
    webview.style.flex = "1";
    webview.style.width = "100%";
    webview.style.height = "100%";
    webview.style.border = "0";
    webview.style.background = "#fff";
    webview.src = toDataUrl(html);
    webviewRef.current = webview;
    host.appendChild(webview);

    return () => {
      webview.remove();
      webviewRef.current = null;
    };
    // Created once; content updates are pushed via the effect below so the guest
    // isn't torn down and recreated on every regenerate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload the guest when the artifact content changes (e.g. Regenerate).
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) {
      return;
    }
    webview.src = toDataUrl(html);
  }, [html]);

  return createElement("div", { ref: hostRef, style: HOST_STYLE });
}
