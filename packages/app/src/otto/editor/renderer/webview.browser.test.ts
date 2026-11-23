import { expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { darkHighlightColors } from "@getpaseo/highlight";
import { defaultRenderingPreferences } from "../preferences";
import { editorWebViewHtml } from "./webview-html";
import { NativeEditorMessage, type NativeEditorInput } from "./bridge";
import type { z } from "zod";

/** Runs the actual offline native document. This proves the renderer/bridge,
 * not an Android/iOS keyboard or a physical device. CI owns browser execution. */
it("keeps newer native keystrokes across delayed host echoes and retains Vim mode across acknowledgments", async () => {
  const frame = document.createElement("iframe");
  const messages: z.infer<typeof NativeEditorMessage>[] = [];
  const receive = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || typeof event.data !== "string") return;
    const parsed = NativeEditorMessage.safeParse(JSON.parse(event.data));
    if (parsed.success) messages.push(parsed.data);
  };
  window.addEventListener("message", receive);
  const bridge =
    '<script>window.ReactNativeWebView={postMessage:(data)=>parent.postMessage(data,"*")};</script>';
  frame.srcdoc = editorWebViewHtml.replace("<head>", `<head>${bridge}`);
  frame.style.cssText = "width:700px;height:500px";
  document.body.append(frame);
  const send = (message: NativeEditorInput) =>
    frame.contentWindow?.__OTTO_EDITOR_RECEIVE__?.(message);
  try {
    await expect.poll(() => messages.some((message) => message.type === "ready")).toBe(true);
    const config: Extract<NativeEditorInput, { type: "config" }> = {
      type: "config",
      session: "native-session",
      acknowledgedSequence: 0,
      text: "const answer = 42;",
      filename: "file.ts",
      vimEnabled: true,
      active: true,
      activation: 0,
      navigationRevision: 0,
      diagnostics: [],
      preferences: defaultRenderingPreferences,
      markdown: { livePreview: true, targets: [] },
      keyBindings: [],
      theme: {
        problems: { error: "#ff5555", warning: "#ffaa22", info: "#5588ff" },
        colorScheme: "dark",
        background: "#101010",
        foreground: "#ffffff",
        cursor: "#ffffff",
        foregroundMuted: "#888888",
        border: "#444444",
        selection: "#335577",
        monoFont: "monospace",
        codeFontSize: 14,
        syntax: darkHighlightColors,
      },
    };
    send(config);
    const host = frame.contentDocument?.querySelector<HTMLElement>("#editor");
    if (!host) throw new Error("Native editor did not mount");
    const view = EditorView.findFromDOM(host);
    if (!view) throw new Error("Native CodeMirror view is missing");
    view.focus();
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
    await expect
      .poll(() => messages.some((message) => message.type === "vim" && message.mode === "INSERT"))
      .toBe(true);
    view.dispatch({ changes: { from: 0, insert: "a" } });
    view.dispatch({ changes: { from: 1, insert: "b" } });
    await expect.poll(() => messages.filter((message) => message.type === "change").length).toBe(2);
    send({ ...config, text: "aconst answer = 42;", acknowledgedSequence: 1 });
    expect(view.state.doc.toString()).toBe("abconst answer = 42;");
    send({ ...config, text: "abconst answer = 42;", acknowledgedSequence: 2 });
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    expect(view.state.doc.toString()).toBe("abconst answer = 42;");
    send({ ...config, text: "accepted external change", acknowledgedSequence: 2 });
    expect(view.state.doc.toString()).toBe("accepted external change");
    expect(messages.filter((message) => message.type === "change")).toHaveLength(2);
  } finally {
    window.removeEventListener("message", receive);
    frame.remove();
  }
});
