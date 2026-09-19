import { headingAnchorSlug } from "@/editor/markdown/markdown-link-completion";
import { HTML_ANCHOR_TOKEN } from "./html-anchors";
import { splitHtmlishMarkdown, type MarkdownDisplayPart } from "./html-ish";
import { defaultMarkdownParser } from "./parser";

/**
 * Where a document link's `#fragment` lands in a rendered document: an
 * explicit HTML anchor (`<a id="x">`) or a heading's GitHub slug. They are
 * separate namespaces so an `<a id="intro">` and a `## Intro` heading cannot
 * register over each other.
 */
export interface DocumentAnchorTarget {
  kind: "id" | "heading";
  value: string;
}

/** The registry key a rendered anchor target is stored and looked up under. */
export function documentAnchorKey(target: DocumentAnchorTarget): string {
  return `${target.kind}:${target.value}`;
}

/**
 * Resolve a link fragment against what the document actually contains.
 *
 * An explicit id is matched exactly, because that is what the author wrote
 * and what HTML does. A heading is matched by its slug, first as written and
 * then slugged, so a link spelled with the heading's own text
 * (`#Café Options`) still finds `café-options`.
 */
export function resolveDocumentAnchor(input: {
  fragment: string;
  headingAnchors: ReadonlySet<string>;
  htmlAnchorIds: ReadonlySet<string>;
}): DocumentAnchorTarget | null {
  const fragment = input.fragment.trim();
  if (!fragment) return null;
  if (input.htmlAnchorIds.has(fragment)) return { kind: "id", value: fragment };
  if (input.headingAnchors.has(fragment)) return { kind: "heading", value: fragment };
  const slug = headingAnchorSlug(fragment);
  if (slug && input.headingAnchors.has(slug)) return { kind: "heading", value: slug };
  return null;
}

interface AnchorSourceToken {
  type: string;
  attrs?: Array<[string, string]> | null;
  children?: AnchorSourceToken[] | null;
}

function collectFromTokens(tokens: readonly AnchorSourceToken[], ids: Set<string>): void {
  for (const token of tokens) {
    if (token.type === HTML_ANCHOR_TOKEN) {
      const id = token.attrs?.find(([name]) => name === "id")?.[1];
      if (id) ids.add(id);
    }
    if (token.children) collectFromTokens(token.children, ids);
  }
}

function collectFromParts(parts: readonly MarkdownDisplayPart[], ids: Set<string>): void {
  for (const part of parts) {
    if (part.kind === "markdown") {
      collectFromTokens(defaultMarkdownParser.parse(part.text, {}) as AnchorSourceToken[], ids);
    } else if (part.kind === "details" && part.bodyParts) {
      collectFromParts(part.bodyParts, ids);
    }
  }
}

/**
 * Every explicit HTML anchor id the renderer will produce for a document,
 * through the same html-ish pass and parser it renders with, so an id inside a
 * code span or fence (which is not an anchor) is not counted.
 */
export function collectHtmlAnchorIds(markdown: string): Set<string> {
  const ids = new Set<string>();
  collectFromParts(splitHtmlishMarkdown(markdown, { anchors: true }), ids);
  return ids;
}
