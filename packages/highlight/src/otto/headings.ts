import { parser as markdownParser } from "@lezer/markdown";

/**
 * Markdown headings, for the document outline and for link autocompletion
 * against a document's own anchors.
 *
 * **This is deliberately not part of `extractSymbols`.** A heading is not a
 * `SymbolKind`, and adding one would mean adding a value to
 * `CodeSymbolKindSchema` - a `z.enum` on the wire. A six-month-old client
 * parsing a `code.outline.response` carrying `kind: "heading"` would reject the
 * whole message, which the protocol contract forbids. Headings therefore stay
 * **client-side**: the client already holds the document it wants an outline of,
 * so there is nothing to ask the daemon for. That also lets a heading carry its
 * level, which the flat symbol shape cannot express and a real table of contents
 * needs.
 */
export interface MarkdownHeading {
  /** 1 through 6, from the marker count (ATX) or the underline character (Setext). */
  level: number;
  /**
   * The heading text with its markers removed. Inline markup is left exactly as
   * written: an outline row showing `**Setup**` is honest about the source, and
   * stripping emphasis here would mean a second, partial markdown parser.
   */
  text: string;
  /** 1-based line the heading starts on. */
  line: number;
  /** 0-based offset of the heading node, for scrolling straight to it. */
  from: number;
}

const HEADING_NODE = /^(?:ATX|Setext)Heading([1-6])$/;

// `## Title ##` - the leading run, and the optional closing run ATX allows.
// The closing run must be preceded by whitespace, per CommonMark, which is what
// keeps `# C#` from becoming "C".
const ATX_LEADING = /^[ \t]*#{1,6}[ \t]*/;
const ATX_TRAILING = /\s#+[ \t]*$/;

function buildLineStarts(code: string): number[] {
  const starts = [0];
  for (let index = 0; index < code.length; index += 1) {
    if (code.charCodeAt(index) === 10) {
      starts.push(index + 1);
    }
  }
  return starts;
}

// Binary search for the 0-based line index whose start is <= offset.
function lineIndexForOffset(lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (lineStarts[mid] <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
}

/**
 * Extract the headings of a markdown document, in document order.
 *
 * This parses rather than scanning for `#` because only a parse knows that a
 * `#` opening a line inside a fenced code block is a comment, not a heading -
 * the single most common way a regex-based outline goes wrong on a README.
 */
export function extractMarkdownHeadings(code: string): MarkdownHeading[] {
  const tree = markdownParser.parse(code);
  const lineStarts = buildLineStarts(code);
  const headings: MarkdownHeading[] = [];

  const cursor = tree.cursor();
  do {
    const match = HEADING_NODE.exec(cursor.name);
    if (!match) {
      continue;
    }
    const level = Number(match[1]);
    const raw = code.slice(cursor.from, cursor.to);
    // A Setext heading spans its text line and its underline; the underline is
    // the marker, so only the first line is the text.
    const firstLine = raw.split("\n", 1)[0] ?? "";
    const text = firstLine.replace(ATX_LEADING, "").replace(ATX_TRAILING, "").trim();
    headings.push({
      level,
      text,
      line: lineIndexForOffset(lineStarts, cursor.from) + 1,
      from: cursor.from,
    });
  } while (cursor.next());

  return headings;
}
