import type { EditorWebViewInbound, EditorWebViewOutbound } from "@/editor/editor-contract";
import { createEditorCore, type EditorCore } from "@/editor/editor-core";

// Runs inside the native react-native-webview. One editor per webview; the
// host drives it with EditorWebViewInbound messages and receives
// EditorWebViewOutbound. Bundled by scripts/build-editor-webview-html.mjs.

const DOC_SYNC_DEBOUNCE_MS = 750;

declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage?: (data: string) => void;
    };
    __OTTO_EDITOR_WEBVIEW_RECEIVE__?: (message: EditorWebViewInbound) => void;
  }
}

const sendToNative = (message: EditorWebViewOutbound): void => {
  window.ReactNativeWebView?.postMessage?.(JSON.stringify(message));
};

const installStyles = (): void => {
  const style = document.createElement("style");
  style.textContent = `
html,
body,
#editor-root {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
  overscroll-behavior: none;
  background: transparent;
}
#editor-root .cm-editor {
  height: 100%;
}
`;
  document.head.appendChild(style);
};

let core: EditorCore | null = null;
let docSyncTimer: ReturnType<typeof setTimeout> | null = null;

const scheduleDocSync = (): void => {
  if (docSyncTimer !== null) {
    clearTimeout(docSyncTimer);
  }
  docSyncTimer = setTimeout(() => {
    docSyncTimer = null;
    if (core) {
      sendToNative({ type: "docSync", doc: core.getDoc() });
    }
  }, DOC_SYNC_DEBOUNCE_MS);
};

const mount = (message: Extract<EditorWebViewInbound, { type: "mount" }>): void => {
  core?.destroy();
  const root = document.getElementById("editor-root");
  if (!root) {
    return;
  }
  core = createEditorCore({
    parent: root,
    path: message.path,
    doc: message.doc,
    theme: message.theme,
    wordWrap: message.wordWrap,
    onDirtyChanged: (dirty) => sendToNative({ type: "dirtyChanged", dirty }),
    onMatchInfo: (info) => sendToNative({ type: "matchInfo", info }),
    onSaveShortcut: () => sendToNative({ type: "saveShortcut" }),
    onFindShortcut: () => sendToNative({ type: "findShortcut" }),
    onGoToLineShortcut: () => sendToNative({ type: "goToLineShortcut" }),
    onDocChanged: scheduleDocSync,
  });
};

type EditorCommand = Exclude<EditorWebViewInbound, { type: "mount" } | { type: "getDoc" }>;

const applyCommand = (target: EditorCore, message: EditorCommand): void => {
  switch (message.type) {
    case "setDoc":
      target.setDoc(message.doc);
      break;
    case "markClean":
      target.markClean();
      break;
    case "setTheme":
      target.setTheme(message.theme);
      break;
    case "setWordWrap":
      target.setWordWrap(message.enabled);
      break;
    case "setFind":
      target.setFind(message.find);
      break;
    case "findNext":
      target.findNext();
      break;
    case "findPrevious":
      target.findPrevious();
      break;
    case "replaceNext":
      target.replaceNext();
      break;
    case "replaceAll":
      target.replaceAll();
      break;
    case "focus":
      target.focus();
      break;
    case "goToLine":
      target.goToLine(message.line);
      break;
    case "selectLines":
      target.selectLines(message.startLine, message.endLine);
      break;
  }
};

const receive = (message: EditorWebViewInbound): void => {
  if (message.type === "mount") {
    mount(message);
    return;
  }
  if (message.type === "getDoc") {
    sendToNative({ type: "doc", requestId: message.requestId, doc: core?.getDoc() ?? "" });
    return;
  }
  if (message.type === "getSelection") {
    const selection = core?.getSelection() ?? {
      text: "",
      lineStart: 1,
      lineEnd: 1,
      isEmpty: true,
    };
    sendToNative({ type: "selection", requestId: message.requestId, selection });
    return;
  }
  if (!core) {
    return;
  }
  applyCommand(core, message);
};

const bootstrap = (): void => {
  installStyles();
  const root = document.createElement("div");
  root.id = "editor-root";
  document.body.appendChild(root);
  window.__OTTO_EDITOR_WEBVIEW_RECEIVE__ = receive;
  sendToNative({ type: "bridgeReady" });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
