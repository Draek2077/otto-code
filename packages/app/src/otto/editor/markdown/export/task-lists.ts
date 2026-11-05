/**
 * GitHub-style task lists (`- [ ]`, `- [x]`) for the shared markdown renderer.
 *
 * Rewrites at the token level - after block+inline parsing - so the `[ ]`
 * marker is only recognized at the start of a real list item; task syntax
 * inside code fences or mid-sentence is untouched.
 *
 * The marker is removed from the text and re-expressed as attributes on the
 * `list_item_open` token, which `tokensToAST` turns into `node.attributes` for
 * the renderer's `list_item` rule to read. That is what lets the checkbox be a
 * real control: a glyph baked into the text is not something anyone can tap,
 * and the source line it would have to write back to is only knowable here,
 * from the token's `map`.
 *
 * Nothing here decides what a checkbox looks like. This is the parse half, and
 * it is the half worth testing.
 */

/** Whether the item is checked. Absent means the item is not a task at all. */
export const TASK_STATE_ATTRIBUTE = "data-otto-task";
/** 1-based source line of the item, so a tap can write back to it. */
export const TASK_LINE_ATTRIBUTE = "data-otto-task-line";

interface TaskListToken {
  type: string;
  content: string;
  children?: TaskListToken[] | null;
  /** `[startLine, endLine]`, 0-based and half-open. Block tokens only. */
  map?: [number, number] | null;
  /**
   * markdown-it's own setter. Declared instead of the `attrs` array for the
   * same reason `github-alerts.ts` does it: markdown-it types that array as
   * `TokenAttribute[]`, which a hand-rolled tuple array is not assignable to.
   */
  attrSet?: (name: string, value: string) => void;
}

interface TaskListCoreState {
  tokens: TaskListToken[];
}

interface MarkdownItWithCoreRuler {
  core: {
    ruler: {
      push: (name: string, rule: (state: TaskListCoreState) => void) => void;
    };
  };
}

const TASK_MARKER = /^\[([ xX])\] /;

function setAttribute(token: TaskListToken, name: string, value: string): void {
  token.attrSet?.(name, value);
}

export function rewriteTaskListTokens(tokens: TaskListToken[]): void {
  for (let index = 2; index < tokens.length; index += 1) {
    const token = tokens[index];
    const itemOpen = tokens[index - 2];
    if (
      token.type !== "inline" ||
      tokens[index - 1]?.type !== "paragraph_open" ||
      itemOpen?.type !== "list_item_open"
    ) {
      continue;
    }
    const first = token.children?.[0];
    if (!first || first.type !== "text") {
      continue;
    }
    const match = TASK_MARKER.exec(first.content);
    if (!match) {
      continue;
    }

    first.content = first.content.slice(match[0].length);
    setAttribute(itemOpen, TASK_STATE_ATTRIBUTE, match[1] === " " ? "unchecked" : "checked");
    // `map` is absent on tokens the parser synthesised rather than read, and a
    // checkbox with no line to write back to is read-only rather than broken.
    const line = itemOpen.map?.[0];
    if (typeof line === "number") {
      setAttribute(itemOpen, TASK_LINE_ATTRIBUTE, String(line + 1));
    }
  }
}

/** Registers the task-list rewrite on a markdown-it parser and returns it. */
export function applyTaskListMarkers<T extends MarkdownItWithCoreRuler>(parser: T): T {
  parser.core.ruler.push("otto_task_lists", (state) => {
    rewriteTaskListTokens(state.tokens);
  });
  return parser;
}
