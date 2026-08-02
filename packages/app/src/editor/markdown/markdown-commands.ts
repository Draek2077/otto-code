import { markdownLanguage } from "@codemirror/lang-markdown";
import type { EditorState, StateCommand } from "@codemirror/state";
import type { MarkdownCommandName } from "../editor-contract";
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
