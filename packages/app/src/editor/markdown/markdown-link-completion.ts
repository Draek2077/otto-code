import type { MarkdownHeading } from "@otto-code/highlight";

/**
 * The pure half of markdown link completion: where a link target is being
 * typed, what a heading's anchor is called, and how a workspace path is written
 * relative to the document doing the linking.
 *
 * Nothing here imports CodeMirror. `markdown-completion.ts` wraps these into a
 * completion source the same way `markdown-commands.ts` wraps the transforms.
 */

export type LinkCompletionKind = "file" | "anchor";

export interface LinkCompletionContext {
  kind: LinkCompletionKind;
  /** Offset the completion replaces from; the caret is the other end. */
  from: number;
  /** What the user has typed in that span. */
  query: string;
  /**
   * For an anchor, the file written before the `#`. Empty means the anchor
   * points into the document being edited, which is the only case we can offer
   * headings for without reading another file.
   */
  file: string;
}

/**
 * A link target cannot contain unescaped whitespace, and a `)` has already
 * closed it. Either one means the caret is in prose that merely happens to sit
 * after a `](`, so there is nothing to complete.
 */
const NOT_A_TARGET = /[\s)]/;

/**
 * Where, if anywhere, the caret is typing a link target.
 *
 * Scans the current line only. A link whose target is split across a newline is
 * not something markdown allows, and scanning the whole document backwards
 * would make every keystroke O(doc).
 *
 * `![](` is the same shape as `](`, so image targets come free.
 */
export function findLinkCompletionContext(doc: string, pos: number): LinkCompletionContext | null {
  const lineStart = doc.lastIndexOf("\n", Math.max(0, pos - 1)) + 1;
  const segment = doc.slice(lineStart, pos);
  const open = segment.lastIndexOf("](");
  if (open < 0) {
    return null;
  }

  const target = segment.slice(open + 2);
  if (NOT_A_TARGET.test(target)) {
    return null;
  }

  const targetStart = lineStart + open + 2;
  const hash = target.lastIndexOf("#");
  if (hash < 0) {
    return { kind: "file", from: targetStart, query: target, file: "" };
  }
  return {
    kind: "anchor",
    from: targetStart + hash + 1,
    query: target.slice(hash + 1),
    file: target.slice(0, hash),
  };
}

/**
 * Inline markup does not survive into an anchor, because the anchor is built
 * from the *rendered* heading: `## **Setup**` is `#setup`, not `#setup` with
 * asterisks stripped by luck. Links collapse to their text for the same reason.
 */
function stripInlineMarkup(text: string): string {
  return text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_~`]/g, "");
}

/**
 * GitHub's heading anchor: lowercase, punctuation dropped, spaces hyphenated.
 *
 * Letters and digits are matched by Unicode property rather than `\w`, so a
 * heading in Greek or Japanese keeps its characters instead of slugging to the
 * empty string.
 */
export function headingAnchorSlug(text: string): string {
  return stripInlineMarkup(text)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

export interface HeadingAnchor {
  level: number;
  text: string;
  anchor: string;
}

/**
 * Anchors for a document's headings, in document order.
 *
 * Repeats are suffixed `-1`, `-2` in the order they appear, which is what
 * GitHub does: two `## Options` sections are `#options` and `#options-1`, and
 * offering both the same anchor would send half the links to the wrong place.
 */
export function headingAnchors(headings: readonly MarkdownHeading[]): HeadingAnchor[] {
  const seen = new Map<string, number>();
  return headings.map((heading) => {
    const base = headingAnchorSlug(heading.text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return {
      level: heading.level,
      text: heading.text,
      anchor: count === 0 ? base : `${base}-${count}`,
    };
  });
}

/**
 * Write `toFile` as a path relative to the document at `fromFile`.
 *
 * Both are workspace-relative with `/` separators, which is what
 * `code.list_files` returns. A relative link is what belongs in the file: it
 * survives the directory being moved, and it is what every markdown renderer
 * outside this app resolves. A workspace-relative path would only work here.
 */
export function relativeLinkPath(fromFile: string, toFile: string): string {
  const fromDirectory = fromFile.split("/").slice(0, -1);
  const toSegments = toFile.split("/");
  const toName = toSegments.pop() ?? "";

  let common = 0;
  while (
    common < fromDirectory.length &&
    common < toSegments.length &&
    fromDirectory[common] === toSegments[common]
  ) {
    common += 1;
  }

  const up = Array.from({ length: fromDirectory.length - common }, () => "..");
  return [...up, ...toSegments.slice(common), toName].join("/");
}

/**
 * Percent-encode only what would end the link target early.
 *
 * Deliberately not `encodeURI`: that would also escape non-ASCII, turning a
 * perfectly valid `docs/guía.md` into an unreadable link for no benefit.
 */
export function encodeLinkPath(path: string): string {
  return path.replace(
    /[ ()<>]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
