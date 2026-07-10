/**
 * GitHub-style task lists (`- [ ]`, `- [x]`) for the shared markdown renderer.
 *
 * Rewrites at the token level — after block+inline parsing — so the `[ ]`
 * marker is only recognized at the start of a real list item; task syntax
 * inside code fences or mid-sentence is untouched. Rendering is a glyph
 * substitution (read-only checkboxes), which keeps the renderer's text
 * pipeline unchanged; upgrading to icon checkboxes is tracked in
 * projects/file-rendering.
 */

interface TaskListToken {
  type: string;
  content: string;
  children?: TaskListToken[] | null;
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
const UNCHECKED_GLYPH = "☐"; // ☐
const CHECKED_GLYPH = "☑"; // ☑

export function rewriteTaskListTokens(tokens: TaskListToken[]): void {
  for (let index = 2; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (
      token.type !== "inline" ||
      tokens[index - 1]?.type !== "paragraph_open" ||
      tokens[index - 2]?.type !== "list_item_open"
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
    const glyph = match[1] === " " ? UNCHECKED_GLYPH : CHECKED_GLYPH;
    first.content = `${glyph} ${first.content.slice(match[0].length)}`;
  }
}

/** Registers the task-list rewrite on a markdown-it parser and returns it. */
export function applyTaskListMarkers<T extends MarkdownItWithCoreRuler>(parser: T): T {
  parser.core.ruler.push("otto_task_lists", (state) => {
    rewriteTaskListTokens(state.tokens);
  });
  return parser;
}
