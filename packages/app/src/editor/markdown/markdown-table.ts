import type { DocRange, MarkdownEdit } from "./markdown-format";

/**
 * GFM table editing as pure text transforms.
 *
 * A markdown table is the one construct where the source and the rendering are
 * the same artifact: people align the pipes by hand because a ragged table is
 * genuinely hard to read in the editor. Doing that by hand is also the most
 * tedious thing about writing markdown, which is why every operation here
 * reformats the whole table on its way out.
 *
 * Nothing here imports CodeMirror; the commands in `markdown-commands.ts` wrap
 * these the same way they wrap `markdown-format.ts`.
 */

export type ColumnAlignment = "left" | "center" | "right" | null;

export interface ParsedTable {
  /** Document offsets of the table's first and last character. */
  from: number;
  to: number;
  /** Cells by row, header first. The divider row is not included. */
  rows: string[][];
  alignments: ColumnAlignment[];
  /** Row index of the caret, in `rows` coordinates; header is 0. */
  cursorRow: number;
  /** Column index of the caret. */
  cursorColumn: number;
}

/** A divider cell: `---`, `:--`, `--:`, `:-:`, with optional spaces. */
const DIVIDER_CELL = /^:?-{1,}:?$/;

function lineStartAt(doc: string, pos: number): number {
  const index = doc.lastIndexOf("\n", Math.max(0, pos - 1));
  return index === -1 ? 0 : index + 1;
}

function lineEndAt(doc: string, pos: number): number {
  const index = doc.indexOf("\n", pos);
  return index === -1 ? doc.length : index;
}

/**
 * Split a row into cells on unescaped pipes.
 *
 * GFM makes the outer pipes optional, so a leading and trailing empty cell are
 * dropped — but only when the row actually started or ended with one, or a
 * genuinely empty first cell would disappear.
 */
export function splitRow(line: string): string[] {
  const trimmed = line.trim();
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "\\" && trimmed[index + 1] === "|") {
      current += "\\|";
      index += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  if (trimmed.startsWith("|")) {
    cells.shift();
  }
  if (trimmed.endsWith("|") && !trimmed.endsWith("\\|")) {
    cells.pop();
  }
  return cells.map((cell) => cell.trim());
}

function isTableRow(line: string): boolean {
  return line.includes("|") && line.trim().length > 0;
}

function isDividerRow(line: string): boolean {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => DIVIDER_CELL.test(cell.trim()));
}

function alignmentOf(cell: string): ColumnAlignment {
  const trimmed = cell.trim();
  const left = trimmed.startsWith(":");
  const right = trimmed.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

/**
 * A table line index (which counts the divider) as a `rows` index (which does
 * not). Line 1 is the divider, and a caret there acts as the header's.
 */
function rowIndexForLine(lineIndex: number): number {
  if (lineIndex <= 1) {
    return 0;
  }
  return lineIndex - 1;
}

/**
 * The table the position sits in, or null.
 *
 * A table is recognised by its divider row, not by pipe count: a line of prose
 * containing a pipe is not a table, and treating it as one would reformat the
 * user's sentence into cells.
 */
export function findTableAt(doc: string, pos: number): ParsedTable | null {
  let first = lineStartAt(doc, pos);
  while (first > 0) {
    const previousStart = lineStartAt(doc, first - 1);
    if (!isTableRow(doc.slice(previousStart, first - 1))) {
      break;
    }
    first = previousStart;
  }

  let last = lineEndAt(doc, pos);
  while (last < doc.length) {
    const nextEnd = lineEndAt(doc, last + 1);
    if (!isTableRow(doc.slice(last + 1, nextEnd))) {
      break;
    }
    last = nextEnd;
  }

  const lines = doc.slice(first, last).split("\n");
  if (lines.length < 2 || !isDividerRow(lines[1])) {
    return null;
  }

  const alignments = splitRow(lines[1]).map(alignmentOf);
  const rows = lines.filter((_line, index) => index !== 1).map(splitRow);

  // Where the caret is, in table coordinates. The divider row has no cells to
  // edit, so a caret parked on it is treated as being in the header.
  const caretLineIndex = doc.slice(first, lineStartAt(doc, pos)).split("\n").length - 1;
  const cursorRow = rowIndexForLine(caretLineIndex);
  const beforeCaret = doc.slice(lineStartAt(doc, pos), pos);
  const cursorColumn = Math.max(0, splitRow(`${beforeCaret}|`).length - 1);

  return { from: first, to: last, rows, alignments, cursorRow, cursorColumn };
}

function dividerCell(width: number, alignment: ColumnAlignment): string {
  const inner = "-".repeat(Math.max(1, width));
  if (alignment === "center") return `:${inner.slice(0, Math.max(1, width - 2))}:`;
  if (alignment === "right") return `${inner.slice(0, Math.max(1, width - 1))}:`;
  if (alignment === "left") return `:${inner.slice(0, Math.max(1, width - 1))}`;
  return inner;
}

/**
 * Rebuild a table with its pipes aligned.
 *
 * Width is measured in code units rather than rendered width: a CJK or emoji
 * cell will not line up in a proportional font anyway, and pretending otherwise
 * would need font metrics the transform layer has no business knowing about.
 */
export function formatTable(table: ParsedTable): string {
  const columnCount = Math.max(table.alignments.length, ...table.rows.map((row) => row.length));
  const widths: number[] = [];
  for (let column = 0; column < columnCount; column += 1) {
    const cellWidth = Math.max(3, ...table.rows.map((row) => (row[column] ?? "").length));
    widths.push(cellWidth);
  }

  const pad = (cell: string, width: number, alignment: ColumnAlignment) => {
    const text = cell ?? "";
    const slack = Math.max(0, width - text.length);
    if (alignment === "right") return " ".repeat(slack) + text;
    if (alignment === "center") {
      const left = Math.floor(slack / 2);
      return " ".repeat(left) + text + " ".repeat(slack - left);
    }
    return text + " ".repeat(slack);
  };

  const renderRow = (row: string[]) =>
    `| ${widths.map((width, column) => pad(row[column] ?? "", width, table.alignments[column] ?? null)).join(" | ")} |`;

  const divider = `| ${widths
    .map((width, column) => dividerCell(width, table.alignments[column] ?? null))
    .join(" | ")} |`;

  const [header, ...body] = table.rows;
  return [renderRow(header ?? []), divider, ...body.map(renderRow)].join("\n");
}

function edit(table: ParsedTable, next: ParsedTable): MarkdownEdit {
  const insert = formatTable(next);
  return {
    from: table.from,
    to: table.to,
    insert,
    selection: { from: table.from, to: table.from + insert.length },
  };
}

type TableOperation = (table: ParsedTable) => ParsedTable | null;

function withTable(operation: TableOperation) {
  return (doc: string, range: DocRange): MarkdownEdit | null => {
    const table = findTableAt(doc, range.from);
    if (!table) {
      return null;
    }
    const next = operation(table);
    return next === null ? null : edit(table, next);
  };
}

/** Realign the pipes of the table under the caret. */
export const formatTableAtCursor = withTable((table) => table);

export const insertRowBelow = withTable((table) => {
  const width = table.alignments.length;
  const rows = [...table.rows];
  // Never above the header: a row inserted there would become the header and
  // silently demote the real one.
  const at = Math.max(1, table.cursorRow + 1);
  rows.splice(
    at,
    0,
    Array.from({ length: width }, () => ""),
  );
  return { ...table, rows };
});

export const deleteRow = withTable((table) => {
  // The header is structural — a table without one is not a table — and the
  // last body row leaves a header with nothing under it, which is still valid.
  if (table.cursorRow === 0 || table.rows.length <= 1) {
    return null;
  }
  const rows = table.rows.filter((_row, index) => index !== table.cursorRow);
  return { ...table, rows };
});

export const insertColumnRight = withTable((table) => {
  const at = table.cursorColumn + 1;
  const rows = table.rows.map((row) => {
    const next = [...row];
    next.splice(at, 0, "");
    return next;
  });
  const alignments = [...table.alignments];
  alignments.splice(at, 0, null);
  return { ...table, rows, alignments };
});

export const deleteColumn = withTable((table) => {
  if (table.alignments.length <= 1) {
    return null;
  }
  const at = table.cursorColumn;
  const rows = table.rows.map((row) => row.filter((_cell, index) => index !== at));
  const alignments = table.alignments.filter((_alignment, index) => index !== at);
  return { ...table, rows, alignments };
});

const ALIGNMENT_CYCLE: ColumnAlignment[] = [null, "left", "center", "right"];

/** Cycle the caret column's alignment: default → left → center → right. */
export const cycleColumnAlignment = withTable((table) => {
  const at = table.cursorColumn;
  const current = table.alignments[at] ?? null;
  const next = ALIGNMENT_CYCLE[(ALIGNMENT_CYCLE.indexOf(current) + 1) % ALIGNMENT_CYCLE.length];
  const alignments = [...table.alignments];
  alignments[at] = next;
  return { ...table, alignments };
});
