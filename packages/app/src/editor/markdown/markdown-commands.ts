import { markdownLanguage } from "@codemirror/lang-markdown";
import type { EditorState, Extension, StateCommand } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { EditorDroppedImage, MarkdownCommandName } from "../editor-contract";
import {
  insertHorizontalRule,
  insertImage,
  insertLink,
  insertTable,
  toggleBlockquote,
  toggleCode,
  toggleCodeFence,
  toggleHeading,
  toggleInlineMarker,
  toggleList,
  toggleTaskChecked,
  type DocRange,
  type MarkdownEdit,
} from "./markdown-format";
import { htmlIsWorthConverting, htmlToMarkdown } from "./markdown-paste";
import {
  cycleColumnAlignment,
  deleteColumn,
  deleteRow,
  formatTableAtCursor,
  insertColumnRight,
  insertRowBelow,
} from "./markdown-table";

// CodeMirror wrappers over the pure transforms in markdown-format.ts. Nothing
// here decides anything: it reads the selection, calls a transform, and
// dispatches. The logic worth testing lives on the other side of that call.

type Transform = (doc: string, range: DocRange) => MarkdownEdit | null;

/**
 * Whether markdown markup is what the given position actually is.
 *
 * `isActiveAt` walks the parse tree, so this is false inside a fenced code
 * block even in a `.md` file — bold in the middle of a ```ts fence would be
 * corrupting code, not formatting prose. It is also what makes every command
 * here decline in a `.ts` file, letting the shared keymap fall through to the
 * File Editor binding for the same key.
 */
function inMarkdownContext(state: EditorState): boolean {
  return markdownLanguage.isActiveAt(state, state.selection.main.head);
}

function markdownEditCommand(transform: Transform): StateCommand {
  return ({ state, dispatch }) => {
    if (!inMarkdownContext(state)) {
      return false;
    }
    const { from, to } = state.selection.main;
    // The transforms take a string. That is a full-document read per invocation,
    // which is fine here and would not be in an update listener: these run on an
    // explicit keystroke or button press, never per keypress.
    const edit = transform(state.doc.toString(), { from, to });
    if (!edit) {
      return false;
    }
    dispatch(
      state.update({
        changes: { from: edit.from, to: edit.to, insert: edit.insert },
        selection: { anchor: edit.selection.from, head: edit.selection.to },
        scrollIntoView: true,
        userEvent: "input.markdown",
      }),
    );
    return true;
  };
}

const MARKDOWN_TRANSFORMS: Record<MarkdownCommandName, Transform> = {
  markdownBold: (doc, range) => toggleInlineMarker(doc, range, "**"),
  markdownItalic: (doc, range) => toggleInlineMarker(doc, range, "*"),
  markdownCode: toggleCode,
  markdownStrikethrough: (doc, range) => toggleInlineMarker(doc, range, "~~"),
  markdownLink: (doc, range) => insertLink(doc, range),
  markdownImage: (doc, range) => insertImage(doc, range),
  markdownBulletList: (doc, range) => toggleList(doc, range, "bullet"),
  markdownOrderedList: (doc, range) => toggleList(doc, range, "ordered"),
  markdownTaskList: (doc, range) => toggleList(doc, range, "task"),
  markdownToggleTask: toggleTaskChecked,
  markdownBlockquote: toggleBlockquote,
  markdownCodeFence: (doc, range) => toggleCodeFence(doc, range),
  markdownHorizontalRule: insertHorizontalRule,
  markdownTable: (doc, range) => insertTable(doc, range),
  markdownTableFormat: formatTableAtCursor,
  markdownTableRowBelow: insertRowBelow,
  markdownTableRowDelete: deleteRow,
  markdownTableColumnRight: insertColumnRight,
  markdownTableColumnDelete: deleteColumn,
  markdownTableAlign: cycleColumnAlignment,
  markdownHeading1: (doc, range) => toggleHeading(doc, range, 1),
  markdownHeading2: (doc, range) => toggleHeading(doc, range, 2),
  markdownHeading3: (doc, range) => toggleHeading(doc, range, 3),
  markdownHeading4: (doc, range) => toggleHeading(doc, range, 4),
  markdownHeading5: (doc, range) => toggleHeading(doc, range, 5),
  markdownHeading6: (doc, range) => toggleHeading(doc, range, 6),
};

export const MARKDOWN_COMMAND_NAMES = Object.keys(MARKDOWN_TRANSFORMS) as MarkdownCommandName[];

const MARKDOWN_COMMANDS: Record<MarkdownCommandName, StateCommand> = Object.fromEntries(
  MARKDOWN_COMMAND_NAMES.map((name) => [name, markdownEditCommand(MARKDOWN_TRANSFORMS[name])]),
) as Record<MarkdownCommandName, StateCommand>;

export function isMarkdownCommandName(value: string): value is MarkdownCommandName {
  return value in MARKDOWN_TRANSFORMS;
}

export function getMarkdownCommand(name: MarkdownCommandName): StateCommand {
  return MARKDOWN_COMMANDS[name];
}

/**
 * Paste HTML as markdown, in markdown files only.
 *
 * Registered as a `paste` DOM handler rather than a keymap entry because paste
 * is not only a keystroke: the context menu and a middle-click both reach the
 * same event. Returning false leaves CodeMirror's own paste to run, which is
 * what handles plain text, and what handles every non-markdown file.
 *
 * The conversion is deliberately skipped for HTML that carries no structure —
 * copying out of a plain-text editor still puts a `<span>` on the clipboard, and
 * round-tripping that through a converter can only lose whitespace.
 */
export const markdownPasteHandler = EditorView.domEventHandlers({
  paste(event, view) {
    if (!inMarkdownContext(view.state)) {
      return false;
    }
    const html = event.clipboardData?.getData("text/html");
    if (!html || !htmlIsWorthConverting(html)) {
      return false;
    }
    const markdown = htmlToMarkdown(html);
    if (markdown === null) {
      return false;
    }
    const { from, to } = view.state.selection.main;
    view.dispatch(
      view.state.update({
        changes: { from, to, insert: markdown },
        selection: { anchor: from + markdown.length },
        scrollIntoView: true,
        userEvent: "input.paste",
      }),
    );
    event.preventDefault();
    return true;
  },
});

/**
 * Paste or drop an image into a markdown file: the core hands the bytes to the
 * host, which writes them into the workspace and inserts the link.
 *
 * The split is forced by the architecture rather than chosen. On native the
 * editor runs inside a webview and cannot reach the daemon, and on web the
 * client never touches a workspace file either — so the only thing the core can
 * do with a dropped image is recognise it and pass it on. That is also why the
 * bytes are base64: this crosses a JSON bridge.
 *
 * Passing no handler registers nothing at all, which is the capability gate. A
 * host on a daemon without `features.binaryFileWrite` leaves the drop to the
 * platform instead of swallowing it into a feature that cannot complete.
 */
export type MarkdownImageDropHandler = (images: readonly EditorDroppedImage[]) => void;

export function markdownImageDropHandler(
  onImageDrop: MarkdownImageDropHandler | undefined,
): Extension {
  if (!onImageDrop) {
    return [];
  }

  /**
   * Claim the event only when there is an image on it. Returning false for
   * everything else is what leaves ordinary text paste, the HTML-to-markdown
   * conversion above, and CodeMirror's own drop handling untouched.
   */
  const claimImages = (files: FileList | null | undefined, view: EditorView): boolean => {
    if (!inMarkdownContext(view.state)) {
      return false;
    }
    const images = Array.from(files ?? []).filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) {
      return false;
    }
    // The reads are asynchronous, so this hands the host a batch once every
    // image has resolved rather than one message per file — several images in
    // one gesture must insert in the order they were dropped, and independent
    // reads finish in whatever order they please.
    void Promise.all(images.map(readImageAsBase64)).then((results) => {
      const resolved = results.filter((image): image is EditorDroppedImage => image !== null);
      if (resolved.length > 0) {
        onImageDrop(resolved);
      }
      return undefined;
    });
    return true;
  };

  return EditorView.domEventHandlers({
    paste(event, view) {
      if (!claimImages(event.clipboardData?.files, view)) {
        return false;
      }
      event.preventDefault();
      return true;
    },
    drop(event, view) {
      if (!claimImages(event.dataTransfer?.files, view)) {
        return false;
      }
      event.preventDefault();
      // Put the caret where the image was actually dropped. Without this the
      // link lands wherever the caret happened to be, which is rarely the place
      // the user aimed at — and by the time the read resolves there is no
      // pointer position left to consult.
      const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (position !== null) {
        view.dispatch({ selection: { anchor: position } });
      }
      view.focus();
      return true;
    },
  });
}

/**
 * A dropped `File` as base64, or null when it could not be read.
 *
 * `readAsDataURL` rather than `arrayBuffer()` plus a hand-rolled encoder: the
 * platform already has a correct base64 implementation on this path, and
 * chunking a multi-megabyte screenshot through `String.fromCharCode` to reach
 * `btoa` is exactly the kind of code that works until someone pastes a big
 * enough image.
 */
function readImageAsBase64(file: File): Promise<EditorDroppedImage | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(
        comma < 0
          ? null
          : { name: file.name, mimeType: file.type, dataBase64: result.slice(comma + 1) },
      );
    });
    reader.addEventListener("error", () => resolve(null));
    reader.readAsDataURL(file);
  });
}
