/**
 * AsciiDoc → markdown, for the file viewer's rendered `.adoc` preview.
 *
 * ## Why markdown is the target
 *
 * Every rendered surface in the app (chat, file viewer, pull-request panel) is
 * one pipeline: markdown-it tokens → React Native primitives. Converting
 * AsciiDoc into that pipeline - rather than rendering Asciidoctor's HTML in a
 * webview - is what buys theme tokens, text selection, code highlighting and,
 * above all, **one** mermaid host: a `[mermaid]` block here becomes a
 * ```mermaid fence, which `MarkdownFence` already routes to `MermaidBlock`. A
 * diagram in a `.adoc` therefore looks identical to the same diagram in a `.md`.
 * The alternative - Asciidoctor HTML + mermaid.min.js in a webview - would draw
 * the same diagram through a second engine with its own theming, which is
 * exactly what `mermaid-document.ts` exists to avoid.
 *
 * ## What this is not
 *
 * This is a *preview-fidelity* converter, not a publishing pipeline. It targets
 * the constructs specs actually use - sections, lists, delimited blocks,
 * tables, admonitions, macros, attribute references. It deliberately does not
 * resolve `include::` (no file-system access on this side of the wire; the
 * directive is surfaced rather than silently dropped) and it flattens
 * constructs markdown cannot express (description lists, sidebars, cell spans).
 * Anything it cannot map degrades to visible text - never to an empty box and
 * never to raw markup, the same policy the HTML translation follows
 * (docs/markdown-rendering.md).
 */

/** Labels for the five AsciiDoc admonition types, in the casing we render. */
const ADMONITION_LABELS: Readonly<Record<string, string>> = {
  NOTE: "Note",
  TIP: "Tip",
  IMPORTANT: "Important",
  WARNING: "Warning",
  CAUTION: "Caution",
};

const HEADING = /^(={1,6})\s+(\S.*)$/;
const ATTRIBUTE_ENTRY = /^:(!?)([\w][\w-]*)(!?):\s*(.*)$/;
const BLOCK_ATTRIBUTES = /^\[(.*)\]$/;
const BLOCK_TITLE = /^\.(?![\s.])(.+)$/;
const UNORDERED_ITEM = /^([*-]+)\s+(.*)$/;
const ORDERED_ITEM = /^(\.+)\s+(.*)$/;
const NUMBERED_ITEM = /^\d+\.\s+(.*)$/;
const DESCRIPTION_ITEM = /^(\S.*?)(::{1,3})(?:\s+(.*))?$/;
const CALLOUT_ITEM = /^<(\d+)>\s+(.*)$/;
const BLOCK_IMAGE = /^image::([^[\]]+)\[(.*)\]$/;
const INCLUDE_DIRECTIVE = /^include::([^[\]]+)\[(.*)\]$/;
const CONDITIONAL_DIRECTIVE = /^(?:ifdef|ifndef|ifeval|endif)::/;
const ANCHOR_LINE = /^\[\[[^\]]+\]\]$/;

/** A delimited block: four or more of the same character, alone on a line. */
const DELIMITERS: ReadonlyArray<{ pattern: RegExp; kind: DelimitedKind }> = [
  { pattern: /^-{4,}$/, kind: "listing" },
  { pattern: /^\.{4,}$/, kind: "literal" },
  { pattern: /^={4,}$/, kind: "example" },
  { pattern: /^\*{4,}$/, kind: "sidebar" },
  { pattern: /^_{4,}$/, kind: "quote" },
  { pattern: /^\/{4,}$/, kind: "comment" },
  { pattern: /^\+{4,}$/, kind: "passthrough" },
  { pattern: /^\|={3,}$/, kind: "table" },
  { pattern: /^--$/, kind: "open" },
];

type DelimitedKind =
  | "listing"
  | "literal"
  | "example"
  | "sidebar"
  | "quote"
  | "comment"
  | "passthrough"
  | "table"
  | "open";

export interface AsciiDocDocument {
  /** Header attribute entries, shown in the viewer's metadata block. */
  frontmatter: string | null;
  /** Markdown handed to `MarkdownRenderer`. */
  body: string;
}

/** Parsed `[...]` line attached to the block that follows it. */
interface BlockAttributes {
  /** First positional value: `source`, `NOTE`, `mermaid`, `quote`. */
  style: string;
  /** Remaining positional values: `[source,typescript]` → `["typescript"]`. */
  positional: string[];
  named: Map<string, string>;
}

const EMPTY_ATTRIBUTES: BlockAttributes = {
  style: "",
  positional: [],
  named: new Map(),
};

export function asciiDocToMarkdown(source: string): AsciiDocDocument {
  const lines = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const header = parseDocumentHeader(lines);
  const body = convertBlocks(lines, header.endIndex, header.attributes);

  const out: string[] = [];
  if (header.title) {
    out.push(`# ${convertInline(header.title, header.attributes)}`, "");
  }
  out.push(...body);

  return {
    frontmatter: formatFrontmatter(header.entries),
    body: collapseBlankRuns(out).join("\n").trim(),
  };
}

interface DocumentHeader {
  title: string | null;
  attributes: Map<string, string>;
  /** Attribute entries in source order, for the metadata block. */
  entries: Array<[string, string]>;
  endIndex: number;
}

/**
 * The document header: an optional level-0 title (`= Title`) followed by
 * contiguous attribute entries, ending at the first blank line. Attributes set
 * here are the ones `{name}` references resolve against.
 */
function parseDocumentHeader(lines: string[]): DocumentHeader {
  const attributes = new Map<string, string>();
  const entries: Array<[string, string]> = [];
  let index = 0;
  let title: string | null = null;

  while (index < lines.length && (lines[index].trim() === "" || isComment(lines[index]))) {
    index += 1;
  }

  const titleMatch = lines[index]?.match(/^=\s+(\S.*)$/);
  if (titleMatch) {
    title = titleMatch[1].trim();
    index += 1;
  }

  // Attribute entries (and the optional author/revision lines) run until the
  // first blank line. Without a title there is no header, so nothing is eaten.
  if (title !== null) {
    while (index < lines.length && lines[index].trim() !== "") {
      const line = lines[index];
      const match = line.match(ATTRIBUTE_ENTRY);
      if (match) {
        const [, bangBefore, name, bangAfter, rawValue] = match;
        const unset = bangBefore === "!" || bangAfter === "!";
        const value = rawValue.trim();
        if (unset) {
          attributes.delete(name);
        } else {
          attributes.set(name, value);
          entries.push([name, value]);
        }
      } else if (!isComment(line)) {
        // Author / revision line - metadata, not body content.
        entries.push(["", line.trim()]);
      }
      index += 1;
    }
  }

  return { title, attributes, entries, endIndex: index };
}

function formatFrontmatter(entries: Array<[string, string]>): string | null {
  if (entries.length === 0) {
    return null;
  }
  return entries.map(([name, value]) => (name ? `${name}: ${value}` : value)).join("\n");
}

function isComment(line: string): boolean {
  return line.startsWith("//") && !line.startsWith("///");
}

/** The block-level pass. Walks lines, emitting markdown. */
function convertBlocks(
  lines: string[],
  startIndex: number,
  attributes: Map<string, string>,
): string[] {
  const out: string[] = [];
  let pendingAttributes: BlockAttributes = EMPTY_ATTRIBUTES;
  let pendingTitle: string | null = null;
  let listIndent = 0;
  let index = startIndex;

  const takeAttributes = (): BlockAttributes => {
    const taken = pendingAttributes;
    pendingAttributes = EMPTY_ATTRIBUTES;
    return taken;
  };
  const takeTitle = (): string | null => {
    const taken = pendingTitle;
    pendingTitle = null;
    return taken;
  };
  const emitTitle = () => {
    const title = takeTitle();
    if (title) {
      out.push(`**${convertInline(title, attributes)}**`, "");
    }
  };

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (isSkippableLine(line, trimmed)) {
      index += 1;
      continue;
    }

    // A blank line closes any open list. A lone `+` glues the next block onto
    // the current item, so it breaks the block without closing the list.
    if (trimmed === "" || trimmed === "+") {
      out.push("");
      if (trimmed === "") {
        listIndent = 0;
      }
      index += 1;
      continue;
    }

    const delimiter = DELIMITERS.find((entry) => entry.pattern.test(trimmed));
    if (delimiter) {
      const blockAttributes = takeAttributes();
      const title = takeTitle();
      const end = findClosingDelimiter(lines, index + 1, delimiter.pattern);
      const content = lines.slice(index + 1, end);
      out.push(
        ...renderDelimitedBlock(delimiter.kind, content, blockAttributes, title, attributes),
        "",
      );
      index = end + 1;
      continue;
    }

    const blockAttributeLine = trimmed.match(BLOCK_ATTRIBUTES);
    if (blockAttributeLine) {
      pendingAttributes = parseBlockAttributes(blockAttributeLine[1]);
      index += 1;
      continue;
    }

    const standalone = convertStandaloneLine(trimmed, attributes);
    if (standalone) {
      takeAttributes();
      emitTitle();
      out.push(...standalone, "");
      index += 1;
      continue;
    }

    const blockTitle = trimmed.match(BLOCK_TITLE);
    if (blockTitle && !UNORDERED_ITEM.test(trimmed) && !ORDERED_ITEM.test(trimmed)) {
      pendingTitle = blockTitle[1].trim();
      index += 1;
      continue;
    }

    // `NOTE: text` - the single-paragraph admonition form.
    const inlineAdmonition = trimmed.match(/^([A-Z]{3,9}):\s+(.*)$/);
    if (inlineAdmonition && ADMONITION_LABELS[inlineAdmonition[1]]) {
      takeAttributes();
      emitTitle();
      const label = ADMONITION_LABELS[inlineAdmonition[1]];
      const { text, next } = readParagraph(lines, index, inlineAdmonition[2]);
      out.push(...quote([`**${label}:** ${convertInline(text, attributes)}`]), "");
      index = next;
      continue;
    }

    const listItem = matchListItem(trimmed, attributes);
    if (listItem) {
      emitTitle();
      listIndent = listItem.indent;
      out.push(`${"  ".repeat(listItem.indent)}${listItem.text}`);
      index += 1;
      continue;
    }

    // A literal paragraph: indented text renders verbatim.
    if (/^\s+\S/.test(line) && listIndent === 0) {
      const end = findBlankLine(lines, index);
      out.push(
        "```",
        ...lines.slice(index, end).map((entry) => entry.replace(/^\s{1,4}/, "")),
        "```",
        "",
      );
      index = end;
      continue;
    }

    // Ordinary paragraph.
    takeAttributes();
    emitTitle();
    const { text, next } = readParagraph(lines, index, trimmed);
    out.push(convertInline(text, attributes), "");
    index = next;
  }

  // Nested blocks are collapsed here too, so a quote built from them doesn't
  // inherit a run of empty `>` lines.
  return collapseBlankRuns(out);
}

/** Lines that render nothing: comments, conditionals, the TOC macro, anchors, page breaks. */
function isSkippableLine(line: string, trimmed: string): boolean {
  return (
    isComment(line) ||
    CONDITIONAL_DIRECTIVE.test(trimmed) ||
    trimmed === "toc::[]" ||
    trimmed === "<<<" ||
    ANCHOR_LINE.test(trimmed)
  );
}

/** Constructs that consume exactly one line and render on their own. */
function convertStandaloneLine(trimmed: string, attributes: Map<string, string>): string[] | null {
  const heading = trimmed.match(HEADING);
  if (heading) {
    const level = Math.min(6, heading[1].length);
    return [`${"#".repeat(level)} ${convertInline(heading[2].trim(), attributes)}`];
  }

  const blockImage = trimmed.match(BLOCK_IMAGE);
  if (blockImage) {
    return [
      `![${firstPositional(blockImage[2])}](${resolveImageTarget(blockImage[1], attributes)})`,
    ];
  }

  const include = trimmed.match(INCLUDE_DIRECTIVE);
  if (include) {
    // Honest degradation: the preview cannot resolve includes, so it says so
    // rather than silently rendering an incomplete document.
    return [`> **Include** \`${include[1].trim()}\` - not resolved in preview.`];
  }

  const attributeEntry = trimmed.match(ATTRIBUTE_ENTRY);
  if (attributeEntry) {
    // Mid-document attribute assignment: takes effect, renders nothing.
    const [, bangBefore, name, bangAfter, rawValue] = attributeEntry;
    if (bangBefore === "!" || bangAfter === "!") {
      attributes.delete(name);
    } else {
      attributes.set(name, rawValue.trim());
    }
    return [];
  }

  if (trimmed === "'''" || trimmed === "---") {
    return ["---"];
  }

  return null;
}

interface ListItem {
  indent: number;
  /** The bullet, marker included, already inline-converted. */
  text: string;
}

/** One matcher for every list form, so the block loop keeps a single list branch. */
function matchListItem(trimmed: string, attributes: Map<string, string>): ListItem | null {
  const callout = trimmed.match(CALLOUT_ITEM);
  if (callout) {
    return { indent: 0, text: `${callout[1]}. ${convertInline(callout[2], attributes)}` };
  }
  const unordered = trimmed.match(UNORDERED_ITEM);
  if (unordered && /^\*+$|^-$/.test(unordered[1])) {
    return {
      indent: unordered[1].length - 1,
      text: `- ${convertInline(unordered[2], attributes)}`,
    };
  }
  const ordered = trimmed.match(ORDERED_ITEM);
  if (ordered) {
    return { indent: ordered[1].length - 1, text: `1. ${convertInline(ordered[2], attributes)}` };
  }
  const numbered = trimmed.match(NUMBERED_ITEM);
  if (numbered) {
    return { indent: 0, text: `1. ${convertInline(numbered[1], attributes)}` };
  }
  // `term:: definition` - markdown has no description list, so it becomes a
  // bullet whose term is bold, which reads the same way.
  const description = trimmed.startsWith("|") ? null : trimmed.match(DESCRIPTION_ITEM);
  if (description) {
    const term = `**${convertInline(description[1].trim(), attributes)}**`;
    const definition = description[3]?.trim();
    return {
      indent: Math.max(0, description[2].length - 2),
      text: definition ? `- ${term} - ${convertInline(definition, attributes)}` : `- ${term}`,
    };
  }
  return null;
}

/** Collect a paragraph's continuation lines, stopping at anything block-level. */
function readParagraph(
  lines: string[],
  index: number,
  firstLine: string,
): { text: string; next: number } {
  const collected = [firstLine];
  let cursor = index + 1;
  while (cursor < lines.length) {
    const line = lines[cursor];
    const trimmed = line.trim();
    if (trimmed === "" || trimmed === "+" || isComment(line) || startsBlock(trimmed)) {
      break;
    }
    collected.push(trimmed);
    cursor += 1;
  }
  return { text: collected.join("\n"), next: cursor };
}

function startsBlock(trimmed: string): boolean {
  return (
    HEADING.test(trimmed) ||
    BLOCK_ATTRIBUTES.test(trimmed) ||
    CALLOUT_ITEM.test(trimmed) ||
    BLOCK_IMAGE.test(trimmed) ||
    INCLUDE_DIRECTIVE.test(trimmed) ||
    CONDITIONAL_DIRECTIVE.test(trimmed) ||
    DELIMITERS.some((entry) => entry.pattern.test(trimmed)) ||
    (UNORDERED_ITEM.test(trimmed) && /^([*-]+)\s/.test(trimmed)) ||
    ORDERED_ITEM.test(trimmed) ||
    NUMBERED_ITEM.test(trimmed)
  );
}

function findClosingDelimiter(lines: string[], start: number, pattern: RegExp): number {
  for (let index = start; index < lines.length; index += 1) {
    if (pattern.test(lines[index].trim())) {
      return index;
    }
  }
  return lines.length;
}

function findBlankLine(lines: string[], start: number): number {
  for (let index = start; index < lines.length; index += 1) {
    if (lines[index].trim() === "") {
      return index;
    }
  }
  return lines.length;
}

/**
 * The info string for a listing or literal fence.
 *
 * `[mermaid]` is the whole reason a diagram in a `.adoc` looks like a diagram
 * in a `.md`: the fence lands on `MarkdownFence`, which routes it to
 * `MermaidBlock`. A literal block is verbatim text, so it stays untagged.
 */
function fenceLanguage(kind: DelimitedKind, blockAttributes: BlockAttributes): string {
  const style = blockAttributes.style.toLowerCase();
  if (style === "mermaid") {
    return "mermaid";
  }
  if (kind === "literal" && style !== "source") {
    return "";
  }
  return blockAttributes.positional[0] ?? "";
}

function renderDelimitedBlock(
  kind: DelimitedKind,
  content: string[],
  blockAttributes: BlockAttributes,
  title: string | null,
  attributes: Map<string, string>,
): string[] {
  const heading = title ? [`**${convertInline(title, attributes)}**`, ""] : [];

  switch (kind) {
    case "comment":
      return [];

    case "listing":
    case "literal":
      return [...heading, ...fence(content, fenceLanguage(kind, blockAttributes))];

    case "passthrough":
      // Raw output markup. Showing it as HTML source is honest; rendering it
      // would mean a second, untranslated HTML path.
      return [...heading, ...fence(content, "html")];

    case "table":
      return [...heading, ...renderTable(content, blockAttributes, attributes)];

    case "example": {
      const label = ADMONITION_LABELS[blockAttributes.style.toUpperCase()];
      const inner = convertBlocks(content, 0, attributes);
      if (label) {
        return quote([`**${label}**`, "", ...inner]);
      }
      return quote(title ? [`**${convertInline(title, attributes)}**`, "", ...inner] : inner);
    }

    case "sidebar":
    case "quote": {
      const inner = convertBlocks(content, 0, attributes);
      const attribution = kind === "quote" ? blockAttributes.positional[0] : undefined;
      const quoted = quote(
        title && kind === "sidebar"
          ? [`**${convertInline(title, attributes)}**`, "", ...inner]
          : inner,
      );
      return attribution ? [...quoted, `> - ${convertInline(attribution, attributes)}`] : quoted;
    }

    case "open":
      return [...heading, ...convertBlocks(content, 0, attributes)];
  }
}

/** Open a fence long enough that backticks in the content cannot close it. */
function fence(content: string[], language: string): string[] {
  let longestRun = 0;
  for (const line of content) {
    for (const match of line.matchAll(/`+/g)) {
      longestRun = Math.max(longestRun, match[0].length);
    }
  }
  const ticks = "`".repeat(Math.max(3, longestRun + 1));
  return [`${ticks}${language}`, ...content, ticks];
}

function quote(lines: string[]): string[] {
  // A converted paragraph is one entry carrying embedded newlines, so split
  // before prefixing - otherwise only its first physical line gets the `>`.
  const trimmed = lines.flatMap((line) => line.split("\n"));
  while (trimmed.length > 0 && trimmed[0] === "") {
    trimmed.shift();
  }
  const quoted = trimmed.map((line) => (line === "" ? ">" : `> ${line}`));
  // Trailing `>` lines render as an empty paragraph inside the quote.
  while (quoted.length > 0 && quoted[quoted.length - 1] === ">") {
    quoted.pop();
  }
  return quoted;
}

/**
 * AsciiDoc tables → GFM. Cells are collected in source order and chunked into
 * rows by the column count (from `cols`, else from the first cell line). GFM
 * has no cell spans or block-level cells, so those flatten.
 */
function renderTable(
  content: string[],
  blockAttributes: BlockAttributes,
  attributes: Map<string, string>,
): string[] {
  const cells: string[] = [];
  /** Cells on the first cell-bearing line - the width fallback when `cols` is absent. */
  let firstLineCellCount = 0;
  let sawBlankAfterFirstRow = false;
  let current: string[] | null = null;

  const flush = () => {
    if (current) {
      cells.push(current.join(" ").trim());
      current = null;
    }
  };

  for (const line of content) {
    const trimmed = line.trim();
    if (trimmed === "") {
      flush();
      // A blank line straight after the opening row is what marks it a header.
      if (cells.length > 0 && !sawBlankAfterFirstRow && cells.length === firstLineCellCount) {
        sawBlankAfterFirstRow = true;
      }
      continue;
    }
    const segments = splitTableLine(trimmed);
    if (segments === null) {
      if (current) {
        current.push(trimmed);
      }
      continue;
    }
    if (firstLineCellCount === 0) {
      firstLineCellCount = segments.length;
    }
    for (const segment of segments) {
      flush();
      current = [segment];
    }
  }
  flush();

  if (cells.length === 0) {
    return [];
  }

  const columnCount = resolveColumnCount(blockAttributes, firstLineCellCount, cells.length);
  const hasHeader =
    sawBlankAfterFirstRow ||
    blockAttributes.named.get("options")?.includes("header") === true ||
    blockAttributes.positional.some((value) => value.includes("header"));

  const rendered = cells.map((cell) =>
    convertInline(cell, attributes).replace(/\\/g, "\\\\").replace(/\|/g, "\\|"),
  );
  const rows: string[][] = [];
  for (let index = 0; index < rendered.length; index += columnCount) {
    const row = rendered.slice(index, index + columnCount);
    while (row.length < columnCount) {
      row.push("");
    }
    rows.push(row);
  }

  const header = hasHeader ? (rows.shift() ?? []) : Array.from({ length: columnCount }, () => "");
  return [
    `| ${header.join(" | ")} |`,
    `| ${Array.from({ length: columnCount }, () => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ];
}

/** A cell spec (`2+`, `.3+`, `^`, `a`) sits *before* the `|` it applies to. */
const CELL_SPEC_ONLY = /^[\d.+*<>^adehlmsv]+$/;
const TRAILING_CELL_SPEC = /\s(?:[\d.]*[+*][<>^]?(?:\.[<>^])?[adehlmsv]?|[<>^][adehlmsv]?)$/;

/**
 * Split one table line into cell contents, or `null` if the line is a
 * continuation of the cell above. Specs are dropped: GFM has no cell spans, so
 * a spanned cell renders as an ordinary one rather than shifting the grid.
 */
function splitTableLine(line: string): string[] | null {
  const boundaries: number[] = [];
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === "|" && line[index - 1] !== "\\") {
      boundaries.push(index);
    }
  }
  if (boundaries.length === 0) {
    return null;
  }
  // Anything before the first `|` must be a spec, otherwise this is prose that
  // happens to contain a pipe - a continuation line, not a new row.
  const lead = line.slice(0, boundaries[0]).trim();
  if (lead !== "" && !CELL_SPEC_ONLY.test(lead)) {
    return null;
  }

  const cells: string[] = [];
  for (let index = 0; index < boundaries.length; index += 1) {
    const start = boundaries[index] + 1;
    const end = index + 1 < boundaries.length ? boundaries[index + 1] : line.length;
    const slice = line.slice(start, end);
    // The next cell's spec trails this one's content; a spec must be preceded
    // by whitespace, so an ordinary word ending in `a` is never mistaken for one.
    cells.push(
      (index + 1 < boundaries.length ? slice.replace(TRAILING_CELL_SPEC, "") : slice).trim(),
    );
  }
  return cells;
}

function resolveColumnCount(
  blockAttributes: BlockAttributes,
  firstLineCellCount: number,
  totalCells: number,
): number {
  const cols = blockAttributes.named.get("cols");
  if (cols) {
    // `cols="1,3"` → 2 columns; `cols="3*"` / `cols="3*1"` → 3 columns.
    const repeat = cols.match(/^\s*(\d+)\s*\*/);
    if (repeat) {
      return Math.max(1, Number(repeat[1]));
    }
    return Math.max(1, cols.split(",").length);
  }
  return Math.max(1, firstLineCellCount || totalCells);
}

/** Parse a `[...]` block attribute line into style, positional and named values. */
function parseBlockAttributes(raw: string): BlockAttributes {
  const values = splitAttributeList(raw);
  const positional: string[] = [];
  const named = new Map<string, string>();

  for (const value of values) {
    const match = value.match(/^([\w-]+)\s*=\s*(.*)$/);
    if (match) {
      named.set(match[1], stripQuotes(match[2]));
    } else {
      positional.push(stripQuotes(value));
    }
  }

  const style = positional.shift() ?? "";
  return { style: style.replace(/^[.#%]/, ""), positional, named };
}

/** Split on commas that are not inside quotes. */
function splitAttributeList(raw: string): string[] {
  const values: string[] = [];
  let current = "";
  let openQuote: string | null = null;
  for (const char of raw) {
    if (openQuote) {
      if (char === openQuote) {
        openQuote = null;
      }
      current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      openQuote = char;
      current += char;
      continue;
    }
    if (char === ",") {
      values.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current.trim());
  return values.filter((value) => value !== "");
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && /^["']/.test(trimmed) && trimmed.endsWith(trimmed[0])) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function firstPositional(raw: string): string {
  return stripQuotes(splitAttributeList(raw)[0] ?? "");
}

/**
 * An image target, with `:imagesdir:` applied.
 *
 * AsciiDoc's own convention is that image targets are relative to `imagesdir`
 * rather than to the document, so `:imagesdir: images` + `image::flow.png[]`
 * means `images/flow.png`. Folding it in here is what lets the markdown side
 * resolve one kind of relative path - from there an AsciiDoc image and a
 * markdown one take the identical route. A URL or a root-relative target ignores
 * `imagesdir`, as Asciidoctor does.
 */
function resolveImageTarget(target: string, attributes: Map<string, string>): string {
  const trimmed = target.trim();
  const imagesDir = attributes.get("imagesdir")?.trim().replace(/\/+$/, "");
  if (
    !imagesDir ||
    !trimmed ||
    trimmed.startsWith("/") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(trimmed)
  ) {
    return trimmed;
  }
  return `${imagesDir}/${trimmed}`;
}

const PLACEHOLDER_OPEN = "\u0000";
const PLACEHOLDER_CLOSE = "\u0001";

/**
 * The inline pass: macros, formatting and attribute references.
 *
 * Code spans are lifted out first and restored last, so nothing below can
 * reach inside `` `like_this` `` and mangle it.
 */
export function convertInline(text: string, attributes: Map<string, string>): string {
  const protectedSpans: string[] = [];
  const protect = (value: string): string =>
    `${PLACEHOLDER_OPEN}${protectedSpans.push(value) - 1}${PLACEHOLDER_CLOSE}`;

  let result = text;

  // Attribute references resolve before anything else; unresolved ones are
  // left visible rather than blanked, so the author sees the typo.
  result = result.replace(/\{([\w][\w-]*)\}/g, (match, name: string) =>
    attributes.has(name) ? (attributes.get(name) ?? "") : match,
  );

  // `+literal+` inside backticks, then plain backtick spans.
  result = result.replace(/`\+([^`]+?)\+`/g, (_match, code: string) => protect(`\`${code}\``));
  result = result.replace(/`([^`\n]+?)`/g, (_match, code: string) => protect(`\`${code}\``));
  result = result.replace(/pass:[a-z]*\[(.*?)\]/g, (_match, inner: string) => protect(inner));

  // Macros.
  result = result.replace(/image:([^\s[\]]+)\[(.*?)\]/g, (_match, src: string, spec: string) =>
    protect(`![${firstPositional(spec)}](${resolveImageTarget(src, attributes)})`),
  );
  result = result.replace(
    /\b(?:link|mailto):([^\s[\]]+)\[(.*?)\]/g,
    (match, target: string, spec: string) => {
      const label = firstPositional(spec) || target;
      const href = match.startsWith("mailto:") ? `mailto:${target}` : target;
      return protect(`[${label}](${href})`);
    },
  );
  result = result.replace(
    /\b(https?:\/\/[^\s[\]]+)\[(.*?)\]/g,
    (_match, href: string, spec: string) => protect(`[${firstPositional(spec) || href}](${href})`),
  );
  result = result.replace(/xref:([^\s[\]]+)\[(.*?)\]/g, (_match, target: string, spec: string) =>
    protect(firstPositional(spec) || target),
  );
  result = result.replace(
    /<<([^<>,]+)(?:,([^<>]+))?>>/g,
    (_match, target: string, label?: string) => protect((label ?? target).trim()),
  );
  result = result.replace(/footnote:[^\s[\]]*\[(.*?)\]/g, (_match, note: string) =>
    protect(` (${note})`),
  );
  result = result.replace(/kbd:\[(.*?)\]/g, (_match, keys: string) => protect(`\`${keys}\``));
  result = result.replace(/btn:\[(.*?)\]/g, (_match, label: string) => protect(`**${label}**`));
  result = result.replace(/menu:([^\s[\]]+)\[(.*?)\]/g, (_match, root: string, rest: string) =>
    protect([root, ...rest.split(">").map((part) => part.trim())].filter(Boolean).join(" → ")),
  );

  // Formatting. Unconstrained forms are protected before the constrained pass
  // so `**bold**` is not re-wrapped into `****bold****`.
  result = result.replace(/\*\*(\S(?:.*?\S)?)\*\*/g, (_match, inner: string) =>
    protect(`**${inner}**`),
  );
  result = result.replace(/__(\S(?:.*?\S)?)__/g, (_match, inner: string) => protect(`*${inner}*`));
  // Constrained bold: AsciiDoc `*text*` is bold, markdown `*text*` is italic.
  result = result.replace(
    /(^|[\s([{>-])\*(\S(?:[^*\n]*?\S)?)\*(?=$|[\s)\]}.,;:!?-])/g,
    (_match, before: string, inner: string) => `${before}${protect(`**${inner}**`)}`,
  );
  result = result.replace(/\[.underline\]#(.*?)#/g, "$1");
  result = result.replace(/(^|\s)#(\S(?:[^#\n]*?\S)?)#(?=$|[\s.,;:!?])/g, "$1$2");
  result = result.replace(/\^(\S+?)\^/g, "$1");
  result = result.replace(/(^|\s)~(\S+?)~/g, "$1$2");

  // A trailing ` +` is an explicit line break.
  result = result.replace(/ \+$/gm, "  ");

  // Protected spans nest: `protect` runs over text that earlier passes already
  // protected, so a code span inside a link label, bold run or image alt is
  // stored with another span's placeholder still inside it. `String.replace`
  // never re-scans its own replacement output, so restoring in a single pass
  // leaves that inner placeholder in the rendered markdown as raw control
  // characters. Restore until the text stops changing. A span can only ever
  // reference indices lower than its own, so this terminates; the pass bound is
  // belt and braces.
  const placeholder = new RegExp(`${PLACEHOLDER_OPEN}(\\d+)${PLACEHOLDER_CLOSE}`, "g");
  let restored = result;
  for (let pass = 0; pass <= protectedSpans.length; pass += 1) {
    const next = restored.replace(
      placeholder,
      (_match, index: string) => protectedSpans[Number(index)] ?? "",
    );
    if (next === restored) {
      break;
    }
    restored = next;
  }
  return restored;
}

/** Never more than one blank line in a row - markdown treats runs the same. */
function collapseBlankRuns(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line === "" && out[out.length - 1] === "") {
      continue;
    }
    out.push(line);
  }
  return out;
}
