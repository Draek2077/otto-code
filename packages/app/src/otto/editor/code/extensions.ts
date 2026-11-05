import { EditorView, ViewPlugin, hoverTooltip, keymap, type Tooltip } from "@codemirror/view";
import type { Extension, Text } from "@codemirror/state";
import { autocompletion, completionKeymap, type Completion } from "@codemirror/autocomplete";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import type { EditorQueryResult } from "@getpaseo/plugin/otto/editor";
import type { CodePort, CodePosition } from "./port";
import { gotoLine } from "@codemirror/search";
import { openEditorFind } from "./find-bridge";
import { undo, redo, toggleComment } from "@codemirror/commands";
import type { CodeCommand } from "./port";
import { vimLeader } from "./vim-leader";
import { columnRuler } from "./ruler";
import {
  getMarkdownCommand,
  isMarkdownCommandName,
  markdownPasteHandler,
} from "../markdown/markdown-commands";
import {
  markdownLivePreviewExtension,
  setMarkdownLivePreview,
} from "../markdown/markdown-live-preview";
import {
  markdownCompletionExtension,
  setMarkdownLinkTargetsEffect,
} from "../markdown/markdown-completion";
import { isMarkdownPath } from "../markdown/markdown-path";
import { markdownImageInput } from "../markdown/image-input";
import { overviewRuler, type EditorProblemColors } from "./overview";
import type { EditorVisualTheme } from "@/file-pane/editor/extensions.web";
import { renderEditorHover } from "./hover";
import { synchronizeEditorScroll } from "./scroll";

const commands: Readonly<
  Record<
    Exclude<CodeCommand, import("../markdown/contracts").MarkdownCommandName>,
    (view: EditorView) => boolean
  >
> = {
  find: openEditorFind,
  goToLine: gotoLine,
  undo,
  redo,
  toggleComment,
};

function offset(document: Text, position: CodePosition): number | null {
  if (position.line >= document.lines) return null;
  const line = document.line(position.line + 1);
  return position.character <= line.length ? line.from + position.character : null;
}
function viewPosition(view: EditorView, at: number): CodePosition {
  const line = view.state.doc.lineAt(at);
  return { line: line.number - 1, character: at - line.from };
}
function diagnostics(view: EditorView, port: CodePort) {
  const output: Diagnostic[] = [];
  for (const item of port.diagnostics()) {
    const from = offset(view.state.doc, item.range.start);
    const to = offset(view.state.doc, item.range.end);
    if (from === null || to === null || to < from) continue;
    let severity: Diagnostic["severity"] = "info";
    if (item.severity === 1) severity = "error";
    else if (item.severity === 2) severity = "warning";
    output.push({ from, to, severity, message: item.message, source: item.source });
  }
  view.dispatch(setDiagnostics(view.state, output));
}
function applyCompletion(
  item: EditorQueryResult["completions"][number],
  document: Text,
  fallback: number,
): Completion {
  return {
    label: item.label,
    detail: item.detail,
    info: item.documentation || undefined,
    apply(view, _completion, from, to) {
      if (!view.state.doc.eq(document)) return;
      const edits = item.additionalEdits.map((edit) => ({
        from: offset(document, edit.range.start),
        to: offset(document, edit.range.end),
        insert: edit.text,
      }));
      const start = item.edit ? offset(document, item.edit.range.start) : (from ?? fallback);
      const end = item.edit ? offset(document, item.edit.range.end) : to;
      if (start === null || end === null) return;
      const changes = [{ from: start, to: end, insert: item.edit?.text ?? item.insertText }];
      for (const edit of edits) {
        if (edit.from === null || edit.to === null || edit.to < edit.from) return;
        changes.push({ from: edit.from, to: edit.to, insert: edit.insert });
      }
      changes.sort((a, b) => a.from - b.from);
      for (let i = 1; i < changes.length; i++) if (changes[i].from < changes[i - 1].to) return;
      view.dispatch({ changes, userEvent: "input.complete" });
      view.focus();
    },
  };
}
async function tooltip(
  view: EditorView,
  at: number,
  port: CodePort,
  filename: string,
  theme: EditorVisualTheme,
): Promise<Tooltip | null> {
  const document = view.state.doc;
  const result = await port.request("hover", viewPosition(view, at));
  if (!result?.hover || !view.state.doc.eq(document)) return null;
  const text = result.hover;
  const word = view.state.wordAt(at);
  return {
    pos: word?.from ?? at,
    end: word?.to,
    create() {
      return { dom: renderEditorHover(text, filename, theme) };
    },
  };
}

function runKeyAction(
  action: import("../shortcuts/contracts").EditorKeyAction,
  view: EditorView,
  port: CodePort,
): boolean {
  if (!port.active()) return false;
  if (isMarkdownCommandName(action)) return getMarkdownCommand(action)(view);
  if (action === "find" || action === "goToLine") return commands[action](view);
  if (action === "save") port.vimAction("save");
  else if (action === "goToDefinition") port.action("definition");
  else if (action === "findReferences") port.action("references");
  else if (action === "renameSymbol") port.action("rename");
  else port.action("symbols");
  return true;
}

export function codeExtensions(
  port: CodePort,
  theme: EditorVisualTheme & { problems: EditorProblemColors },
  filename: string,
): Extension {
  const markdown = isMarkdownPath(filename);
  return [
    synchronizeEditorScroll(port),
    vimLeader(port),
    columnRuler(port, theme.border),
    overviewRuler(theme, theme.problems),
    markdown
      ? [
          markdownLivePreviewExtension(port.markdown().livePreview),
          markdownImageInput(port),
          markdownPasteHandler,
          markdownCompletionExtension(filename),
        ]
      : autocompletion({
          override: [
            async (context) => {
              const word = context.matchBefore(/[\p{L}\p{N}_$]+/u);
              if (!word && !context.explicit) return null;
              const line = context.state.doc.lineAt(context.pos);
              const document = context.state.doc;
              const result = await port.request("completion", {
                line: line.number - 1,
                character: context.pos - line.from,
              });
              if (!result || context.aborted || result.state !== "ready") return null;
              const from = word?.from ?? context.pos;
              return {
                from,
                options: result.completions.map((item) => applyCompletion(item, document, from)),
              };
            },
          ],
        }),
    lintGutter(),
    hoverTooltip((view, at) => tooltip(view, at, port, filename, theme).catch(() => null)),
    keymap.of([
      ...port.keyBindings().map((binding) => ({
        key: binding.key,
        run: (view: EditorView) => runKeyAction(binding.action, view, port),
      })),
      ...completionKeymap,
    ]),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!event.ctrlKey && !event.metaKey) return false;
        const at = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (at === null) return false;
        port.position(viewPosition(view, at));
        port.action("definition");
        return true;
      },
    }),
    EditorView.updateListener.of((update) => {
      if (!update.selectionSet && !update.docChanged) return;
      port.position(viewPosition(update.view, update.state.selection.main.head));
      const selection = update.state.selection.main;
      port.selection(
        selection.to - selection.from,
        selection.empty
          ? 0
          : update.state.doc.lineAt(selection.to).number -
              update.state.doc.lineAt(selection.from).number +
              1,
        {
          start: viewPosition(update.view, selection.from),
          end: viewPosition(update.view, selection.to),
        },
      );
    }),
    ViewPlugin.fromClass(
      class {
        private readonly release: () => void;
        private readonly releaseCommands: () => void;
        private alive = true;
        private queued = false;
        constructor(view: EditorView) {
          const schedule = () => {
            if (this.queued) return;
            this.queued = true;
            queueMicrotask(() => {
              this.queued = false;
              if (this.alive) diagnostics(view, port);
            });
          };
          let previous = port.diagnostics();
          let markdownState = port.markdown();
          this.release = port.subscribe(() => {
            const current = port.diagnostics();
            if (current !== previous) {
              previous = current;
              schedule();
            }
            const nextMarkdown = port.markdown();
            if (markdown && nextMarkdown !== markdownState) {
              markdownState = nextMarkdown;
              queueMicrotask(() => {
                if (this.alive)
                  view.dispatch({
                    effects: [
                      setMarkdownLivePreview.of(markdownState.livePreview),
                      setMarkdownLinkTargetsEffect.of(markdownState.targets),
                    ],
                  });
              });
            }
          });
          this.releaseCommands = port.onCommand((command) => {
            const handled = isMarkdownCommandName(command)
              ? getMarkdownCommand(command)(view)
              : commands[command](view);
            if (handled && command !== "find" && command !== "goToLine") view.focus();
            return handled;
          });
          schedule();
          if (markdown)
            queueMicrotask(() => {
              if (this.alive)
                view.dispatch({ effects: setMarkdownLinkTargetsEffect.of(markdownState.targets) });
            });
        }
        destroy() {
          this.alive = false;
          this.release();
          this.releaseCommands();
        }
      },
    ),
    EditorView.theme({
      ".otto-code-hover": {
        maxWidth: "min(560px, 85vw)",
        maxHeight: "320px",
        overflow: "auto",
        padding: "12px",
        whiteSpace: "pre-wrap",
        fontFamily: "inherit",
      },
      ".otto-code-hover-code": {
        margin: "0",
        padding: "4px 0",
        fontFamily: theme.monoFont,
        whiteSpace: "pre-wrap",
      },
      ".otto-code-hover-prose": {
        fontFamily: "system-ui, sans-serif",
        whiteSpace: "pre-wrap",
        padding: "4px 0",
      },
      ".otto-code-hover > * + *": {
        borderTop: `1px solid ${theme.border}`,
        marginTop: "6px",
        paddingTop: "8px",
      },
    }),
  ];
}
