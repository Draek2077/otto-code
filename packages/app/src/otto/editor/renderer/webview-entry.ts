import { Annotation, Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { search, searchKeymap } from "@codemirror/search";
import { keymap } from "@codemirror/view";
import { getCM, vim } from "@replit/codemirror-vim";
import { getLanguageForFile, darkHighlightColors } from "@getpaseo/highlight";
import { editorBaseExtensions, editorTheme } from "../../../file-pane/editor/extensions.web";
import type { CodePort, CodeCommand } from "../code/port";
import { codeExtensions } from "../code/extensions";
import { NativeEditorInput, type NativeEditorMessage, type NativeEditorConfig } from "./bridge";
import type { z } from "zod";
import type { EditorQueryResult } from "@getpaseo/plugin/otto/editor";
import { defaultRenderingPreferences } from "../preferences";
import { editorLocationSelection } from "../code/navigation";

declare global {
  interface Window {
    __OTTO_EDITOR_RECEIVE__?: (input: unknown) => void;
  }
}
interface PendingQuery {
  resolve(result: EditorQueryResult | null): void;
  timer: ReturnType<typeof setTimeout>;
}
const pending = new Map<number, PendingQuery>();
const imageWrites = new Map<
  number,
  {
    resolve(insert: string | null): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
const listeners = new Set<() => void>();
const commandListeners = new Set<(command: CodeCommand) => boolean>();
const scrollListeners = new Set<(fraction: number) => void>();
const remote = Annotation.define<boolean>();
const appearance = new Compartment(),
  language = new Compartment(),
  vimMode = new Compartment();
const codeFeatures = new Compartment();
let view: EditorView | null = null;
let current: z.infer<typeof NativeEditorConfig> | null = null;
let nextQuery = 0;
let navigationRevision = -1;
let localSequence = 0;

function post(message: z.infer<typeof NativeEditorMessage>) {
  window.ReactNativeWebView?.postMessage?.(JSON.stringify(message));
}
function activeSession() {
  return current?.active ? current.session : null;
}
const port: CodePort = {
  scroll: {
    enabled: () => Boolean(current?.scrollLinked),
    report(fraction) {
      const session = activeSession();
      if (session && current?.scrollLinked) post({ type: "scroll", session, fraction });
    },
    subscribe(listener) {
      scrollListeners.add(listener);
      return () => scrollListeners.delete(listener);
    },
  },
  active: () => Boolean(activeSession()),
  activation: () => current?.activation ?? 0,
  rendering: () => current?.preferences ?? defaultRenderingPreferences,
  markdown: () => current?.markdown ?? { livePreview: true, targets: [] },
  keyBindings: () => current?.keyBindings ?? [],
  reportError(message) {
    const session = activeSession();
    if (session) post({ type: "error", session, message });
  },
  writeImage(image) {
    const session = activeSession();
    if (!session) return Promise.resolve(null);
    const id = ++nextQuery;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        imageWrites.delete(id);
        reject(
          new Error(
            "The image write did not return. Check the host's assets directory before pasting it again.",
          ),
        );
      }, 60000);
      imageWrites.set(id, { resolve, reject, timer });
      post({ type: "image", session, id, image });
    });
  },
  vimAction(action) {
    const session = activeSession();
    if (session) post({ type: "vim-action", session, action });
  },
  leaderPending(sequence) {
    const session = activeSession();
    if (session) post({ type: "leader", session, sequence });
  },
  request(action, position) {
    const session = activeSession();
    if (!session) return Promise.resolve(null);
    const id = ++nextQuery;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve(null);
      }, 20000);
      pending.set(id, { resolve, timer });
      post({ type: "query", session, id, action, position });
    });
  },
  position(position) {
    const session = activeSession();
    if (session) post({ type: "cursor", session, position });
  },
  selection(characters, lines, range) {
    const session = activeSession();
    if (session) post({ type: "selection", session, characters, lines, range });
  },
  action(action) {
    const session = activeSession();
    if (session) post({ type: "action", session, action });
  },
  diagnostics: () => current?.diagnostics ?? [],
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  onCommand(listener) {
    commandListeners.add(listener);
    return () => commandListeners.delete(listener);
  },
};
function clearPending() {
  for (const operation of imageWrites.values()) {
    clearTimeout(operation.timer);
    operation.resolve(null);
  }
  imageWrites.clear();
  for (const item of pending.values()) {
    clearTimeout(item.timer);
    item.resolve(null);
  }
  pending.clear();
}
function makeEditor(config: z.infer<typeof NativeEditorConfig>) {
  const host = document.createElement("div");
  host.id = "editor";
  document.body.append(host);
  view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: config.text,
      extensions: [
        ...editorBaseExtensions(() => {
          const session = activeSession();
          if (session) post({ type: "save", session });
        }, false),
        search(),
        keymap.of(
          searchKeymap.filter((binding) => binding.key !== "Mod-f" && binding.key !== "Alt-g"),
        ),
        codeFeatures.of(
          codeExtensions(
            port,
            { ...config.theme, syntax: { ...darkHighlightColors, ...config.theme.syntax } },
            config.filename,
          ),
        ),
        appearance.of([]),
        language.of([]),
        vimMode.of(config.vimEnabled ? vim() : []),
        EditorView.updateListener.of((update) => {
          const session = activeSession();
          if (
            session &&
            update.docChanged &&
            !update.transactions.some((transaction) => transaction.annotation(remote))
          )
            post({
              type: "change",
              session,
              text: update.state.doc.toString(),
              sequence: ++localSequence,
            });
        }),
      ],
    }),
  });
}
function configure(config: z.infer<typeof NativeEditorConfig>) {
  const previous = current;
  const newSession = previous?.session !== config.session;
  if (newSession) localSequence = 0;
  if (current?.session !== config.session || !config.active) clearPending();
  current = config;
  if (!view) makeEditor(config);
  const editor = view;
  if (!editor) return;
  const text = editor.state.toText(config.text);
  // A delayed host echo must not erase keystrokes still crossing the native
  // bridge. Only an acknowledgment of the latest local edit may replace text.
  if ((newSession || config.acknowledgedSequence >= localSequence) && !editor.state.doc.eq(text))
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: text },
      selection: { anchor: Math.min(editor.state.selection.main.head, text.length) },
      annotations: [remote.of(true), Transaction.addToHistory.of(false)],
    });
  configureExtensions(editor, config, previous);
  const cm = getCM(editor);
  if (cm) {
    cm.off("vim-mode-change", changedVimMode);
    cm.on("vim-mode-change", changedVimMode);
  }
  editor.dom.style.pointerEvents = config.active ? "auto" : "none";
  if (!config.active) editor.contentDOM.blur();
  revealLocation(editor, config);
  for (const listener of listeners) listener();
}
function configureExtensions(
  editor: EditorView,
  config: z.infer<typeof NativeEditorConfig>,
  previous: z.infer<typeof NativeEditorConfig> | null,
) {
  const effects = [];
  const changedTheme = !previous || JSON.stringify(previous.theme) !== JSON.stringify(config.theme);
  if (changedTheme)
    effects.push(
      appearance.reconfigure(
        editorTheme({
          ...config.theme,
          syntax: { ...darkHighlightColors, ...config.theme.syntax },
        }),
      ),
    );
  if (
    changedTheme ||
    previous?.filename !== config.filename ||
    JSON.stringify(previous?.keyBindings) !== JSON.stringify(config.keyBindings)
  )
    effects.push(
      codeFeatures.reconfigure(
        codeExtensions(
          port,
          { ...config.theme, syntax: { ...darkHighlightColors, ...config.theme.syntax } },
          config.filename,
        ),
      ),
    );
  if (previous?.filename !== config.filename)
    effects.push(language.reconfigure(getLanguageForFile(config.filename)?.extension ?? []));
  if (previous?.vimEnabled !== config.vimEnabled)
    effects.push(vimMode.reconfigure(config.vimEnabled ? vim() : []));
  if (effects.length) editor.dispatch({ effects });
}
function revealLocation(editor: EditorView, config: z.infer<typeof NativeEditorConfig>) {
  if (!config.active) return;
  if (config.lineStart && navigationRevision !== config.navigationRevision) {
    navigationRevision = config.navigationRevision;
    const selection = editorLocationSelection(editor.state.doc, config);
    editor.dispatch({
      selection,
      effects: EditorView.scrollIntoView(selection.anchor, { y: "center" }),
    });
  }
}
function changedVimMode(event: { mode?: string }) {
  const session = activeSession();
  if (session) post({ type: "vim", session, mode: (event.mode ?? "normal").toUpperCase() });
}
window.__OTTO_EDITOR_RECEIVE__ = (input) => {
  const parsed = NativeEditorInput.safeParse(input);
  if (!parsed.success) return;
  const message = parsed.data;
  if (message.type === "config") {
    configure(message);
    return;
  }
  if (message.session !== current?.session) return;
  if (message.type === "scroll") {
    if (current.active && current.scrollLinked)
      for (const listener of scrollListeners) listener(message.fraction);
    return;
  }
  if (message.type === "command") {
    if (current.active) for (const listener of commandListeners) listener(message.command);
    return;
  }
  if (message.type === "image-result") {
    const operation = imageWrites.get(message.id);
    imageWrites.delete(message.id);
    if (operation) clearTimeout(operation.timer);
    if (message.error) operation?.reject(new Error(message.error));
    else operation?.resolve(message.insert);
    return;
  }
  const request = pending.get(message.id);
  if (!request) return;
  clearTimeout(request.timer);
  pending.delete(message.id);
  request.resolve(message.result);
};
window.addEventListener("pagehide", () => {
  clearPending();
  view?.destroy();
  view = null;
});
post({ type: "ready" });
