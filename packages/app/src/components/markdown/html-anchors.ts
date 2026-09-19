/**
 * Explicit HTML anchors (`<a id="x"></a>`, `<a name="x">`, `<span id="x">`) for
 * rendered documents.
 *
 * html-ish never renders HTML, so without this the tag is unwrapped and its id
 * is gone: a link to `other.md#ros-ac-18`, where `ros-ac-18` sits on a table
 * row rather than a heading, opened the file and then reported the target
 * missing. This keeps the one piece of such a tag a reader can use, the id,
 * and nothing else. No attribute reaches the renderer except that id, and the
 * id is only ever a lookup key for scrolling; it is never written into markup.
 *
 * The hand-off from html-ish to markdown-it is a canonical marker,
 * `<a id="x"></a>`, that html-ish emits (opt-in, see `HtmlishOptions`) and the
 * inline rule here claims. The document parser is `html: false`, so without
 * this rule the marker would render as literal text; that is why only callers
 * whose parser registers {@link applyHtmlAnchors} may opt in.
 */

export const HTML_ANCHOR_TOKEN = "otto_html_anchor";

/**
 * What an id may be. HTML allows anything without whitespace; quotes and angle
 * brackets are excluded so the canonical marker stays unambiguous to parse,
 * and the length cap bounds the scan.
 */
const HTML_ANCHOR_ID_RE = /^[^\s"'<>]{1,256}$/;
const HTML_ANCHOR_MARKER_RE = /^<a id="([^\s"'<>]{1,256})"><\/a>/;
const LESS_THAN = 0x3c;

export function isSafeHtmlAnchorId(id: string | undefined): id is string {
  return typeof id === "string" && HTML_ANCHOR_ID_RE.test(id);
}

/** The canonical marker html-ish emits for an anchor it keeps. */
export function htmlAnchorMarker(id: string): string {
  return `<a id="${id}"></a>`;
}

/**
 * The anchor id an HTML tag declares, if it is one the renderer keeps: `id` or
 * `name` on `<a>`, `id` on `<span>`. The same set GitHub-flavored validators
 * accept as link fragments.
 */
export function htmlTagAnchorId(
  name: string,
  attributes: Readonly<Record<string, string>>,
): string | null {
  let candidate: string | undefined;
  if (name === "a") {
    candidate = attributes.id ?? attributes.name;
  } else if (name === "span") {
    candidate = attributes.id;
  }
  const id = candidate?.trim();
  return isSafeHtmlAnchorId(id) ? id : null;
}

interface HtmlAnchorToken {
  attrs: Array<[string, string | number]> | null;
  markup?: string;
}

type Nesting = 1 | 0 | -1;

interface HtmlAnchorInlineState {
  src: string;
  pos: number;
  posMax: number;
  push: (type: string, tag: string, nesting: Nesting) => HtmlAnchorToken;
}

interface MarkdownItWithInlineRuler {
  inline: {
    ruler: {
      before: (
        target: string,
        name: string,
        rule: (state: HtmlAnchorInlineState, silent: boolean) => boolean,
      ) => void;
    };
  };
}

function htmlAnchorInlineRule(state: HtmlAnchorInlineState, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== LESS_THAN) {
    return false;
  }
  const match = HTML_ANCHOR_MARKER_RE.exec(state.src.slice(state.pos, state.posMax));
  if (!match?.[1]) {
    return false;
  }
  if (!silent) {
    const token = state.push(HTML_ANCHOR_TOKEN, "a", 0);
    token.attrs = [["id", match[1]]];
    token.markup = match[0];
  }
  state.pos += match[0].length;
  return true;
}

/** Registers the anchor marker rule on a markdown-it parser and returns it. */
export function applyHtmlAnchors<T extends MarkdownItWithInlineRuler>(parser: T): T {
  // Before `autolink`, the other inline rule that claims a leading `<`.
  parser.inline.ruler.before("autolink", "otto_html_anchor", htmlAnchorInlineRule);
  return parser;
}
