import { syntaxTree } from "@codemirror/language";
import { type Extension, type Range, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

/**
 * Live preview: markdown markers hide themselves until the caret is on their
 * line.
 *
 * This is the MarkText/Obsidian feel, reached WITHOUT a second editor engine.
 * Everything here is a decoration, so the document is never rewritten: find and
 * replace, the dirty comparison, the overview ruler, the LSP mirror and undo
 * all keep working on exactly the text that is on disk. That property is the
 * whole reason the charter chose this over a rendered document model, and it is
 * the thing not to trade away later.
 *
 * Two rules hold the behaviour together:
 *
 *  1. **Reveal is per line, decided from the selection.** Any line a selection
 *     range touches shows its raw source. Per-line rather than per-node because
 *     a node-level reveal makes the text jump sideways as the caret crosses a
 *     marker, and per-line is what every editor that does this well settled on.
 *  2. **Only markers hide, never content.** A hidden marker is zero-width, so
 *     arrow keys still traverse it and a selection over it still copies it.
 *     Nothing here replaces text with a widget except the horizontal rule,
 *     which has no content to lose.
 */

/** Marker nodes that vanish when the line is not being edited. */
const HIDDEN_MARKS = new Set([
  "EmphasisMark",
  "StrikethroughMark",
  "CodeMark",
  "HeaderMark",
  "QuoteMark",
  "LinkMark",
]);

/**
 * Nodes whose whole range collapses. A link's target is not markup around
 * content, it IS the part a reader should not see, so it hides as a unit.
 */
const HIDDEN_NODES = new Set(["URL", "LinkTitle"]);

const hiddenMark = Decoration.replace({});

/**
 * Which lines are showing their source right now.
 *
 * A line is revealed when a selection range touches it. `to`'s line is included
 * because a selection ending at a line's start still means the user is working
 * there.
 */
function revealedLines(view: EditorView): Set<number> {
  const lines = new Set<number>();
  for (const range of view.state.selection.ranges) {
    const first = view.state.doc.lineAt(range.from).number;
    const last = view.state.doc.lineAt(range.to).number;
    for (let line = first; line <= last; line += 1) {
      lines.add(line);
    }
  }
  return lines;
}

/**
 * Block markers own the whitespace that separates them from their content.
 *
 * `# Title` parses as a `HeaderMark` covering only the `#`, so hiding just the
 * node leaves the heading indented by one space — visible, wrong, and exactly
 * the kind of thing only a real browser test catches. Inline marks are NOT
 * extended: the space after `**bold**` belongs to the sentence.
 */
const MARKS_OWNING_TRAILING_SPACE = new Set(["HeaderMark", "QuoteMark"]);

function hiddenEnd(view: EditorView, name: string, to: number): number {
  if (!MARKS_OWNING_TRAILING_SPACE.has(name)) {
    return to;
  }
  const lineEnd = view.state.doc.lineAt(to).to;
  let end = to;
  while (end < lineEnd) {
    const char = view.state.doc.sliceString(end, end + 1);
    if (char !== " " && char !== "\t") {
      break;
    }
    end += 1;
  }
  return end;
}

function buildDecorations(view: EditorView): DecorationSet {
  const revealed = revealedLines(view);
  const ranges: Range<Decoration>[] = [];
  const tree = syntaxTree(view.state);

  for (const visible of view.visibleRanges) {
    tree.iterate({
      from: visible.from,
      to: visible.to,
      enter: (node) => {
        const isMark = HIDDEN_MARKS.has(node.name);
        const isNode = HIDDEN_NODES.has(node.name);
        if (!isMark && !isNode) {
          return;
        }
        // An empty range would be a no-op decoration CM6 rejects.
        if (node.to <= node.from) {
          return;
        }
        // A fenced block's CodeMark spans its own line; hiding it would collapse
        // the fence into the code and make the block unreadable. Only inline
        // code marks hide.
        if (node.name === "CodeMark" && node.node.parent?.name === "FencedCode") {
          return;
        }
        if (revealed.has(view.state.doc.lineAt(node.from).number)) {
          return;
        }
        ranges.push(hiddenMark.range(node.from, hiddenEnd(view, node.name, node.to)));
      },
    });
  }

  // Sorted on the way in: tree iteration is in document order, but a nested
  // node can still emit out of order relative to a sibling's mark.
  return Decoration.set(ranges, true);
}

/** Turn live preview on or off without remounting the editor. */
export const setMarkdownLivePreview = StateEffect.define<boolean>();

let initialEnabled = false;

export const markdownLivePreviewEnabled = StateField.define<boolean>({
  create: () => initialEnabled,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setMarkdownLivePreview)) {
        return effect.value;
      }
    }
    return value;
  },
});

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = view.state.field(markdownLivePreviewEnabled)
        ? buildDecorations(view)
        : Decoration.none;
    }

    update(update: ViewUpdate) {
      const enabled = update.state.field(markdownLivePreviewEnabled);
      if (!enabled) {
        this.decorations = Decoration.none;
        return;
      }
      // Selection changes matter as much as edits here: moving the caret onto a
      // line is what reveals it, and that is a selection-only update.
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.startState.field(markdownLivePreviewEnabled) !== enabled
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

/**
 * `enabled` seeds the field's initial value, so an editor that mounts with live
 * preview already on never renders one frame of raw markers. The module-level
 * seed is read synchronously by `create` during `EditorState.create`, which is
 * the only point it is used; a second editor mounting later re-seeds it first.
 */
export function markdownLivePreviewExtension(enabled: boolean): Extension {
  initialEnabled = enabled;
  return [markdownLivePreviewEnabled, livePreviewPlugin];
}
