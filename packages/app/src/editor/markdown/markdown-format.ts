/**
 * Markdown formatting as pure text transforms.
 *
 * Every operation takes the document text plus a selection and returns a single
 * replacement, or null when there is nothing to do. Nothing here imports
 * CodeMirror: the CM6 commands in `markdown-commands.ts` are thin wrappers, so
 * the part that is easy to get wrong (marker matching, list renumbering, what
 * stays selected afterwards) is testable in plain Node.
 *
 * Offsets are UTF-16 code units throughout, the same unit CM6 uses, so a result
 * can be handed straight to a transaction.
 */

export interface DocRange {
  from: number;
  to: number;
}

export interface MarkdownEdit {
  /** Range of the document being replaced. */
  from: number;
  to: number;
  /** Replacement text. */
  insert: string;
  /** Where the selection lands afterwards, in absolute document offsets. */
  selection: DocRange;
}

export type InlineMarker = "**" | "*" | "`" | "~~" | "==";

// --- marker helpers ---

/**
 * Whether `marker` sits immediately before `pos`.
 *
 * A single-character marker additionally must not be part of a longer run of
 * the same character. Without that, toggling italic inside `**bold**` would see
 * the inner `*` of the bold pair and unwrap it into `*bold*`.
 */
function hasMarkerBefore(doc: string, pos: number, marker: InlineMarker): boolean {
  if (pos - marker.length < 0) return false;
  if (doc.slice(pos - marker.length, pos) !== marker) return false;
  if (marker.length === 1 && doc[pos - 2] === marker) return false;
  return true;
}

function hasMarkerAfter(doc: string, pos: number, marker: InlineMarker): boolean {
  if (pos + marker.length > doc.length) return false;
  if (doc.slice(pos, pos + marker.length) !== marker) return false;
  if (marker.length === 1 && doc[pos + marker.length] === marker) return false;
  return true;
}

/**
 * Toggle an inline marker pair around the selection.
 *
 * Three cases, checked in order, because the same keystroke has to mean "undo
 * this" as readily as "apply this":
 *   1. the markers sit just outside the selection (you selected the word inside
 *      `**word**`) — remove them, keeping the word selected
 *   2. the markers sit just inside the selection (you selected `**word**`
 *      whole) — remove them
 *   3. otherwise wrap, leaving the original text selected so a second keystroke
 *      round-trips
 *
 * An empty selection wraps and puts the caret between the markers, which is what
 * makes bold-then-type work.
 */
export function toggleInlineMarker(
  doc: string,
  range: DocRange,
  marker: InlineMarker,
): MarkdownEdit {
  const { from, to } = range;
  const len = marker.length;

  if (hasMarkerBefore(doc, from, marker) && hasMarkerAfter(doc, to, marker)) {
    const inner = doc.slice(from, to);
    return {
      from: from - len,
      to: to + len,
      insert: inner,
      selection: { from: from - len, to: to - len },
    };
  }

  const selected = doc.slice(from, to);
  if (selected.length >= len * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(len, selected.length - len);
    return { from, to, insert: inner, selection: { from, to: from + inner.length } };
  }

  return {
    from,
    to,
    insert: `${marker}${selected}${marker}`,
    selection: { from: from + len, to: from + len + selected.length },
  };
}

// --- line helpers ---

function lineStartAt(doc: string, pos: number): number {
  const index = doc.lastIndexOf("\n", Math.max(0, pos - 1));
  return index === -1 ? 0 : index + 1;
}

function lineEndAt(doc: string, pos: number): number {
  const index = doc.indexOf("\n", pos);
  return index === -1 ? doc.length : index;
}

/**
 * The full-line span covering the selection, and the lines in it.
 *
 * A selection ending exactly at a line start does not drag that line in: placing
 * the caret at the head of line 5 after selecting line 4 should format one line,
 * not two.
 */
export function selectedLineSpan(doc: string, range: DocRange): { from: number; to: number } {
  const from = lineStartAt(doc, range.from);
  const end =
    range.to > range.from && lineStartAt(doc, range.to) === range.to ? range.to - 1 : range.to;
  return { from, to: lineEndAt(doc, Math.max(from, end)) };
}

function applyToLines(
  doc: string,
  range: DocRange,
  transform: (lines: string[]) => string[],
): MarkdownEdit {
  const span = selectedLineSpan(doc, range);
  const lines = doc.slice(span.from, span.to).split("\n");
  const insert = transform(lines).join("\n");
  return {
    from: span.from,
    to: span.to,
    insert,
    selection: { from: span.from, to: span.from + insert.length },
  };
}

const HEADING_PREFIX = /^(\s*)(#{1,6})[ \t]+/;
const BLOCKQUOTE_PREFIX = /^(\s*)>[ \t]?/;
const BULLET_PREFIX = /^(\s*)[-*+][ \t]+/;
const ORDERED_PREFIX = /^(\s*)\d+[.)][ \t]+/;
const TASK_PREFIX = /^(\s*)[-*+][ \t]+\[[ xX]\][ \t]+/;

/** Strip whichever list or quote marker a line carries, leaving its indent. */
function stripLineMarkers(line: string): string {
  return line
    .replace(TASK_PREFIX, "$1")
    .replace(ORDERED_PREFIX, "$1")
    .replace(BULLET_PREFIX, "$1")
    .replace(HEADING_PREFIX, "$1");
}

/**
 * Set every selected line to a heading of `level`, or strip the heading when
 * they are already at that level. Toggling is per-selection, decided by the
 * first non-blank line, so a mixed block converges instead of alternating.
 */
export function toggleHeading(doc: string, range: DocRange, level: number): MarkdownEdit {
  const span = selectedLineSpan(doc, range);
  const lines = doc.slice(span.from, span.to).split("\n");
  const first = lines.find((line) => line.trim().length > 0) ?? "";
  const match = HEADING_PREFIX.exec(first);
  const alreadyAtLevel = match !== null && match[2].length === level;

  return applyToLines(doc, range, (input) =>
    input.map((line) => {
      if (line.trim().length === 0) return line;
      const stripped = stripLineMarkers(line);
      if (alreadyAtLevel) return stripped;
      const indent = /^\s*/.exec(stripped)?.[0] ?? "";
      return `${indent}${"#".repeat(level)} ${stripped.slice(indent.length)}`;
    }),
  );
}

/** Toggle `> ` on the selected lines; blank lines inside the block are quoted too. */
export function toggleBlockquote(doc: string, range: DocRange): MarkdownEdit {
  const span = selectedLineSpan(doc, range);
  const lines = doc.slice(span.from, span.to).split("\n");
  const allQuoted = lines.every((line) => BLOCKQUOTE_PREFIX.test(line) || line.trim().length === 0);

  return applyToLines(doc, range, (input) =>
    input.map((line) => (allQuoted ? line.replace(BLOCKQUOTE_PREFIX, "$1") : `> ${line}`)),
  );
}

export type ListKind = "bullet" | "ordered" | "task";

function hasListKind(line: string, kind: ListKind): boolean {
  if (kind === "task") return TASK_PREFIX.test(line);
  if (kind === "ordered") return ORDERED_PREFIX.test(line);
  // A task item is also a bullet; asking for "bullet" should not consider it one,
  // or toggling bullet on a task list would strip the checkbox and stop there.
  return BULLET_PREFIX.test(line) && !TASK_PREFIX.test(line);
}

/**
 * Toggle a list marker over the selected lines.
 *
 * Ordered lists renumber from 1 across the selection rather than repeating `1.`,
 * because the number is the one part of the markup a reader sees in the source.
 */
export function toggleList(doc: string, range: DocRange, kind: ListKind): MarkdownEdit {
  const span = selectedLineSpan(doc, range);
  const lines = doc.slice(span.from, span.to).split("\n");
  const content = lines.filter((line) => line.trim().length > 0);
  const allOfKind = content.length > 0 && content.every((line) => hasListKind(line, kind));

  let ordinal = 0;
  return applyToLines(doc, range, (input) =>
    input.map((line) => {
      if (line.trim().length === 0) return line;
      const stripped = stripLineMarkers(line);
      if (allOfKind) return stripped;
      const indent = /^\s*/.exec(stripped)?.[0] ?? "";
      const body = stripped.slice(indent.length);
      ordinal += 1;
      if (kind === "ordered") return `${indent}${ordinal}. ${body}`;
      if (kind === "task") return `${indent}- [ ] ${body}`;
      return `${indent}- ${body}`;
    }),
  );
}

/** Flip `- [ ]` and `- [x]` on the selected lines. */
export function toggleTaskChecked(doc: string, range: DocRange): MarkdownEdit | null {
  const span = selectedLineSpan(doc, range);
  const lines = doc.slice(span.from, span.to).split("\n");
  if (!lines.some((line) => TASK_PREFIX.test(line))) {
    return null;
  }
  const allChecked = lines
    .filter((line) => TASK_PREFIX.test(line))
    .every((line) => /\[[xX]\]/.test(line));

  return applyToLines(doc, range, (input) =>
    input.map((line) =>
      TASK_PREFIX.test(line) ? line.replace(/\[[ xX]\]/, allChecked ? "[ ]" : "[x]") : line,
    ),
  );
}

/**
 * Set one line's task checkbox to an explicit state.
 *
 * The toolbar's {@link toggleTaskChecked} works from the caret; this works from
 * a line number, because that is all a tap in the rendered preview knows. It
 * also sets rather than toggles: the preview already shows the user which way
 * the box is going, and re-deriving that from the buffer could disagree with
 * what they just pressed.
 *
 * Returns null when the line is not a task item, so a preview rendered against
 * an older revision cannot rewrite a line that has since become something else.
 */
export function setTaskCheckedAtLine(
  doc: string,
  line: number,
  checked: boolean,
): MarkdownEdit | null {
  const lines = doc.split("\n");
  const index = line - 1;
  const text = lines[index];
  if (text === undefined || !TASK_PREFIX.test(text)) {
    return null;
  }
  const insert = text.replace(/\[[ xX]\]/, checked ? "[x]" : "[ ]");
  if (insert === text) {
    return null;
  }
  let from = 0;
  for (let scan = 0; scan < index; scan += 1) {
    from += lines[scan].length + 1;
  }
  const to = from + text.length;
  return { from, to, insert, selection: { from, to: from + insert.length } };
}

// --- block operations ---

/**
 * Wrap the selected lines in a fence, or unwrap when they already are one.
 *
 * The caret lands on the info string of a new fence, since the language is the
 * next thing you type and almost never the thing you leave blank.
 */
export function toggleCodeFence(doc: string, range: DocRange, info = ""): MarkdownEdit {
  const span = selectedLineSpan(doc, range);
  const lines = doc.slice(span.from, span.to).split("\n");
  const first = lines[0] ?? "";
  const last = lines[lines.length - 1] ?? "";

  if (lines.length >= 2 && first.startsWith("```") && last.startsWith("```")) {
    const inner = lines.slice(1, -1).join("\n");
    return {
      from: span.from,
      to: span.to,
      insert: inner,
      selection: { from: span.from, to: span.from + inner.length },
    };
  }

  const body = lines.join("\n");
  const insert = `\`\`\`${info}\n${body}\n\`\`\``;
  const caret = span.from + 3 + info.length;
  return { from: span.from, to: span.to, insert, selection: { from: caret, to: caret } };
}

/** Wrap the selection in backticks, or in a fence when it spans lines. */
export function toggleCode(doc: string, range: DocRange): MarkdownEdit {
  const selected = doc.slice(range.from, range.to);
  return selected.includes("\n")
    ? toggleCodeFence(doc, range)
    : toggleInlineMarker(doc, range, "`");
}

const URL_LIKE = /^(?:https?:\/\/|mailto:|\/|\.{1,2}\/|#)\S*$/i;

/**
 * Turn the selection into a link.
 *
 * Which half stays selected depends on which half the user already supplied: a
 * selected URL becomes `[](url)` with the caret in the empty label, and selected
 * prose becomes `[prose](url)` with the empty target selected. Either way the
 * next keystroke goes where the missing information belongs.
 */
export function insertLink(doc: string, range: DocRange, url = ""): MarkdownEdit {
  const selected = doc.slice(range.from, range.to);
  const selectionIsUrl = selected.length > 0 && URL_LIKE.test(selected);
  const label = selectionIsUrl ? "" : selected;
  const target = selectionIsUrl ? selected : url;
  const insert = `[${label}](${target})`;

  if (selectionIsUrl) {
    const caret = range.from + 1;
    return { from: range.from, to: range.to, insert, selection: { from: caret, to: caret } };
  }
  const targetFrom = range.from + label.length + 3;
  return {
    from: range.from,
    to: range.to,
    insert,
    selection: { from: targetFrom, to: targetFrom + target.length },
  };
}

/** An image is a link with a bang, and the same selection rules apply. */
export function insertImage(doc: string, range: DocRange, url = ""): MarkdownEdit {
  const link = insertLink(doc, range, url);
  return {
    ...link,
    insert: `!${link.insert}`,
    selection: { from: link.selection.from + 1, to: link.selection.to + 1 },
  };
}

/**
 * A thematic break on its own line.
 *
 * It needs a blank line before it or the preceding text turns into a Setext
 * heading, which is the classic way a horizontal rule silently eats a paragraph.
 */
export function insertHorizontalRule(doc: string, range: DocRange): MarkdownEdit {
  const lineStart = lineStartAt(doc, range.from);
  const lineEnd = lineEndAt(doc, range.to);
  const currentLine = doc.slice(lineStart, lineEnd);
  const prefix = currentLine.trim().length === 0 ? "" : "\n\n";
  const insert = `${prefix}---\n`;
  const at = lineEnd;
  return {
    from: at,
    to: at,
    insert,
    selection: { from: at + insert.length, to: at + insert.length },
  };
}

/**
 * A GFM table skeleton.
 *
 * The header cells are placeholders rather than empty, because an empty table is
 * indistinguishable from a broken one while you are looking at the source, and
 * the first thing anyone does is overwrite them anyway.
 */
export function insertTable(doc: string, range: DocRange, rows = 2, columns = 3): MarkdownEdit {
  const safeColumns = Math.max(1, columns);
  const safeRows = Math.max(1, rows);
  const header = `| ${Array.from({ length: safeColumns }, (_, i) => `Column ${i + 1}`).join(" | ")} |`;
  const divider = `| ${Array.from({ length: safeColumns }, () => "---").join(" | ")} |`;
  const body = Array.from(
    { length: safeRows },
    () => `| ${Array.from({ length: safeColumns }, () => " ").join(" | ")} |`,
  );

  const lineStart = lineStartAt(doc, range.from);
  const lineEnd = lineEndAt(doc, range.to);
  const onBlankLine = doc.slice(lineStart, lineEnd).trim().length === 0;
  const prefix = onBlankLine ? "" : "\n\n";
  const table = [header, divider, ...body].join("\n");
  const insert = `${prefix}${table}\n`;
  const at = onBlankLine ? lineStart : lineEnd;
  // Select the first header cell: it is the first thing to replace.
  const firstCell = at + prefix.length + 2;
  return {
    from: at,
    to: onBlankLine ? lineEnd : at,
    insert,
    selection: { from: firstCell, to: firstCell + "Column 1".length },
  };
}
