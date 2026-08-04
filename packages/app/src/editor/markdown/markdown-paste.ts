import TurndownService from "turndown";

/**
 * Paste HTML as markdown.
 *
 * Copying a table, a list or a heading out of a browser and into a markdown
 * file should paste structure, not a wall of tags and not a flattened blob of
 * prose. This is the one conversion that goes HTML → markdown; `html-ish.ts`
 * runs the other direction, for HTML embedded in a document being rendered.
 *
 * The rules below exist because Turndown's defaults do not match the markdown
 * this repo writes, and because real-world clipboard HTML is far dirtier than
 * the hand-authored kind.
 */

let service: TurndownService | null = null;

/** Elements that carry no content a markdown document can use. */
const DROPPED_TAGS = ["script", "style", "meta", "link", "head", "noscript", "iframe", "object"];

function createService(): TurndownService {
  const turndown = new TurndownService({
    // ATX headings, `-` bullets and fenced code: what the formatting commands
    // produce, so pasted content and typed content look the same afterwards.
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    fence: "```",
    emDelimiter: "*",
    strongDelimiter: "**",
    linkStyle: "inlined",
  });

  turndown.remove(DROPPED_TAGS as unknown as TurndownService.Filter);

  // GFM tables. Turndown ships no table rule, and a table is the single most
  // common thing worth pasting that markdown can actually represent - without
  // this it collapses into a run of unseparated cell text.
  turndown.addRule("gfmTable", {
    filter: "table",
    replacement: (_content, node) => {
      const rows = Array.from((node as HTMLTableElement).rows);
      if (rows.length === 0) {
        return "";
      }
      const cellsOf = (row: HTMLTableRowElement) =>
        Array.from(row.cells).map((cell) =>
          // A newline inside a cell would break the row; markdown tables are
          // single-line by construction.
          (cell.textContent ?? "").replace(/\s+/g, " ").replace(/\|/g, "\\|").trim(),
        );
      const header = cellsOf(rows[0]);
      const divider = header.map(() => "---");
      const body = rows.slice(1).map(cellsOf);
      const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
      return `\n\n${[line(header), line(divider), ...body.map(line)].join("\n")}\n\n`;
    },
  });

  // A bare <br> is a line break, not a paragraph. Turndown's default emits two
  // trailing spaces, which every formatter in this repo then strips.
  turndown.addRule("lineBreak", {
    filter: "br",
    replacement: () => "\n",
  });

  return turndown;
}

/**
 * Convert clipboard HTML to markdown, or return null when there is nothing
 * worth converting.
 *
 * Null rather than an empty string so the caller can fall through to the
 * clipboard's plain-text flavour, which is the right paste for HTML that
 * carried no structure at all.
 */
export function htmlToMarkdown(html: string): string | null {
  const trimmed = html.trim();
  if (trimmed.length === 0) {
    return null;
  }
  service ??= createService();
  let markdown: string;
  try {
    markdown = service.turndown(trimmed);
  } catch {
    // Turndown parses with the platform DOM; malformed clipboard HTML is a
    // normal thing to receive, and plain text is a perfectly good answer.
    return null;
  }
  const cleaned = normalizeBlankLines(markdown);
  return cleaned.length === 0 ? null : cleaned;
}

/**
 * Collapse the runs of blank lines Turndown leaves between blocks.
 *
 * Browsers wrap almost everything in nested block elements, so a plain
 * two-sentence paste routinely arrives with four blank lines in it.
 */
export function normalizeBlankLines(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

/**
 * Whether pasted HTML is worth converting at all.
 *
 * Copying from a plain-text editor still puts an HTML flavour on the clipboard,
 * usually a single `<span>` or a `<pre>` wrapping the same text. Converting
 * those adds nothing and can lose the exact whitespace the user copied, so the
 * plain-text flavour wins unless the HTML carries real structure.
 */
export function htmlIsWorthConverting(html: string): boolean {
  return /<(?:h[1-6]|table|thead|tbody|tr|td|th|ul|ol|li|blockquote|pre|code|a|img|strong|b|em|i|del|s)\b/i.test(
    html,
  );
}
