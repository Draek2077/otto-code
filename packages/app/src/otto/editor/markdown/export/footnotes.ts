/**
 * Markdown footnotes (`text[^1]` … `[^1]: the note`) for the shared renderer.
 *
 * **A core-ruler rewrite cannot do this, unlike task lists and alerts.** By the
 * time core rules run, markdown-it has already consumed `[^1]: the note` as a
 * *link reference definition* - that is exactly what the syntax looks like to
 * CommonMark - and turned every `[^1]` in the body into a link to it. The
 * definition is gone from the token stream and the reference is a `link_open` /
 * `text` / `link_close` triple, so there is nothing left to rewrite.
 *
 * So the definitions are claimed first, by a block rule registered *before*
 * `reference`. With no reference definition left to match, `[^1]` stops being a
 * link and stays a plain text token, which the core rule can then rewrite the
 * way the other markdown extensions in this directory do.
 *
 * **Deliberately a rewrite rather than new node types.** The reference becomes
 * a superscript digit in the surrounding text and the definitions become an
 * ordinary list, which means every surface that already renders markdown
 * renders footnotes the moment this is registered: no new render rules, nothing
 * for a caller supplying its own `rules` to miss, and no divergence between the
 * chat bubble and the file viewer. The cost is that a reference is not a link
 * you can tap to jump to. That is worth paying; a preview pane is a page you
 * read, not a document you navigate.
 */

/** The tokens this module creates and then consumes; never reaches a renderer. */
const DEFINITION_OPEN = "otto_footnote_def_open";
const DEFINITION_CLOSE = "otto_footnote_def_close";

export interface FootnoteToken {
  type: string;
  content: string;
  children?: FootnoteToken[] | null;
  markup?: string;
  /** Carries the footnote id on the definition's open token. */
  info?: string;
  map?: [number, number] | null;
}

/**
 * markdown-it's own `Nesting`. Spelled out rather than widened to `number`
 * because a wider parameter type makes a real `MarkdownIt` fail to satisfy the
 * constraint below, and `applyFootnotes` then silently returns this interface
 * instead of the parser that was passed in.
 */
type Nesting = 1 | 0 | -1;

interface FootnoteCoreState {
  tokens: FootnoteToken[];
  Token: new (type: string, tag: string, nesting: Nesting) => FootnoteToken;
}

/** The slice of markdown-it's StateBlock the definition rule needs. */
interface FootnoteBlockState {
  src: string;
  bMarks: number[];
  eMarks: number[];
  tShift: number[];
  line: number;
  push: (type: string, tag: string, nesting: Nesting) => FootnoteToken;
}

type BlockRule = (
  state: FootnoteBlockState,
  startLine: number,
  endLine: number,
  silent: boolean,
) => boolean;

interface MarkdownItWithRulers {
  block: { ruler: { before: (target: string, name: string, rule: BlockRule) => void } };
  core: { ruler: { push: (name: string, rule: (state: FootnoteCoreState) => void) => void } };
}

/**
 * `[^id]: text`. The id is anything but whitespace and a closing bracket, which
 * is what CommonMark's link labels allow and what every footnote implementation
 * settled on.
 */
const DEFINITION = /^\[\^([^\]\s]+)\]:[ \t]*/;

/** A reference, anywhere in running text. */
const REFERENCE = /\[\^([^\]\s]+)\]/g;

const SUPERSCRIPTS = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];

/**
 * The marker that replaces `[^1]` in the text.
 *
 * Real superscript characters rather than a raised style: the reference sits
 * inside a text run whose typography belongs to the markdown styles, and a
 * nested `<Text>` with a smaller size and a baseline shift does not lay out
 * consistently across React Native's three text engines.
 */
export function footnoteMarker(index: number): string {
  return String(index)
    .split("")
    .map((digit) => SUPERSCRIPTS[Number(digit)])
    .join("");
}

/**
 * Claim a `[^id]: …` line before the `reference` rule can read it as a link
 * definition. One line only: a continuation-line footnote is rare enough, and
 * the alternative is reimplementing lazy paragraph continuation here.
 */
const footnoteDefinitionRule: BlockRule = (state, startLine, _endLine, silent) => {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const line = state.src.slice(start, state.eMarks[startLine]);
  const match = DEFINITION.exec(line);
  if (!match) {
    return false;
  }
  if (silent) {
    return true;
  }

  const open = state.push(DEFINITION_OPEN, "div", 1);
  open.info = match[1];
  open.map = [startLine, startLine + 1];

  const inline = state.push("inline", "", 0);
  inline.content = line.slice(match[0].length);
  inline.map = [startLine, startLine + 1];
  inline.children = [];

  state.push(DEFINITION_CLOSE, "div", -1);
  state.line = startLine + 1;
  return true;
};

interface Definition {
  id: string;
  /** The definition's inline token; its children are the note's content. */
  inline: FootnoteToken;
  /** Index of `otto_footnote_def_open` in the token stream. */
  start: number;
  /** Index just past `otto_footnote_def_close`. */
  end: number;
}

function collectDefinitions(tokens: readonly FootnoteToken[]): Definition[] {
  const definitions: Definition[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].type !== DEFINITION_OPEN) {
      continue;
    }
    const inline = tokens[index + 1];
    if (!inline || inline.type !== "inline") {
      continue;
    }
    definitions.push({
      id: tokens[index].info ?? "",
      inline,
      start: index,
      end: index + 3,
    });
  }
  return definitions;
}

/**
 * Replace references with markers, numbering by first appearance.
 *
 * A reference to an id nothing defines is left exactly as written: inventing a
 * number for a note that does not exist would produce a list with a hole in it.
 */
function numberReferences(
  tokens: readonly FootnoteToken[],
  defined: ReadonlySet<string>,
  skip: ReadonlySet<FootnoteToken>,
): string[] {
  const order: string[] = [];
  const numbers = new Map<string, number>();

  const substitute = (text: string) =>
    text.replace(REFERENCE, (literal, id: string) => {
      if (!defined.has(id)) {
        return literal;
      }
      let number = numbers.get(id);
      if (number === undefined) {
        number = order.length + 1;
        numbers.set(id, number);
        order.push(id);
      }
      return footnoteMarker(number);
    });

  for (const token of tokens) {
    if (token.type !== "inline" || skip.has(token)) {
      continue;
    }
    for (const child of token.children ?? []) {
      if (child.type === "text") {
        child.content = substitute(child.content);
      }
    }
    // The inline token's own `content` is the raw source the children were
    // parsed from. Renderers read the children, but leaving the two disagreeing
    // is how a later pass ends up reintroducing the raw `[^1]`.
    token.content = substitute(token.content);
  }

  return order;
}

/** The `n. …` list the referenced definitions become. */
function buildFootnoteSection(
  state: FootnoteCoreState,
  ordered: readonly Definition[],
): FootnoteToken[] {
  const make = (type: string, tag: string, nesting: Nesting) => new state.Token(type, tag, nesting);

  const rule = make("hr", "hr", 0);
  rule.markup = "---";
  const listOpen = make("ordered_list_open", "ol", 1);
  listOpen.markup = ".";
  const listClose = make("ordered_list_close", "ol", -1);
  listClose.markup = ".";

  const items = ordered.flatMap((definition) => {
    const itemOpen = make("list_item_open", "li", 1);
    itemOpen.markup = ".";
    const itemClose = make("list_item_close", "li", -1);
    itemClose.markup = ".";
    return [
      itemOpen,
      make("paragraph_open", "p", 1),
      definition.inline,
      make("paragraph_close", "p", -1),
      itemClose,
    ];
  });

  return [rule, listOpen, ...items, listClose];
}

/**
 * Put an unreferenced definition back as an ordinary paragraph.
 *
 * Dropping it would silently delete the author's text, and numbering it would
 * invent a note nothing points at. Leaving it exactly where it was written is
 * the only option that loses nothing.
 */
function restoreAsParagraph(state: FootnoteCoreState, definition: Definition): FootnoteToken[] {
  const first = definition.inline.children?.[0];
  const prefix = `[^${definition.id}]: `;
  if (first && first.type === "text") {
    first.content = prefix + first.content;
  } else {
    definition.inline.children = [
      Object.assign(new state.Token("text", "", 0), { content: prefix }),
      ...(definition.inline.children ?? []),
    ];
  }
  definition.inline.content = prefix + definition.inline.content;
  return [
    new state.Token("paragraph_open", "p", 1),
    definition.inline,
    new state.Token("paragraph_close", "p", -1),
  ];
}

export function rewriteFootnoteTokens(state: FootnoteCoreState): void {
  const definitions = collectDefinitions(state.tokens);
  if (definitions.length === 0) {
    return;
  }

  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  // A definition's own text is not scanned for references: numbering follows
  // the body, and a note citing another note would otherwise renumber the list
  // from inside it.
  const definitionInlines = new Set(definitions.map((definition) => definition.inline));
  const order = numberReferences(state.tokens, new Set(byId.keys()), definitionInlines);

  const moving = new Set(order.map((id) => byId.get(id)!));
  const replacement: FootnoteToken[] = [];
  let index = 0;
  while (index < state.tokens.length) {
    const definition = definitions.find((candidate) => candidate.start === index);
    if (!definition) {
      replacement.push(state.tokens[index]);
      index += 1;
      continue;
    }
    if (!moving.has(definition)) {
      replacement.push(...restoreAsParagraph(state, definition));
    }
    index = definition.end;
  }

  // No references means no list. Emitting an empty one would put a rule and a
  // blank block at the end of a document that has no footnotes in it.
  const ordered = order.map((id) => byId.get(id)!);
  state.tokens =
    ordered.length === 0 ? replacement : [...replacement, ...buildFootnoteSection(state, ordered)];
}

/** Registers footnote parsing and rendering on a markdown-it parser. */
export function applyFootnotes<T extends MarkdownItWithRulers>(parser: T): T {
  // Before `reference`, or CommonMark claims the definition first.
  parser.block.ruler.before("reference", "otto_footnote_definition", footnoteDefinitionRule);
  parser.core.ruler.push("otto_footnotes", (state) => {
    rewriteFootnoteTokens(state);
  });
  return parser;
}
