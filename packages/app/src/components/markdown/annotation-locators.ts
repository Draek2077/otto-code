import type MarkdownIt from "markdown-it";

export type MarkdownDocumentAnnotationTarget =
  | {
      kind: "heading";
      level: number;
      lineStart: number;
      lineEnd: number;
      text: string;
      excerpt: string;
    }
  | {
      kind: "paragraph" | "blockquote";
      lineStart: number;
      lineEnd: number;
      text: string;
      excerpt: string;
    }
  | {
      kind: "fence";
      lineStart: number;
      lineEnd: number;
      text: string;
      excerpt: string;
      language: string | null;
    };

/**
 * The renderer normally identifies a block by markdown-it token index. Some
 * renderer transforms can reindex that AST, so a unique heading text provides
 * a safe secondary lookup. Ambiguous repeated headings deliberately do not
 * resolve here; a wrong locator is worse than no locator.
 */
export function findUniqueHeadingAnnotationTarget(input: {
  targets: ReadonlyMap<number, MarkdownDocumentAnnotationTarget>;
  text: string;
  level?: number;
}): Extract<MarkdownDocumentAnnotationTarget, { kind: "heading" }> | undefined {
  const text = normalizeHeadingText(input.text);
  if (!text) return undefined;
  const matches = Array.from(input.targets.values()).filter(
    (target): target is Extract<MarkdownDocumentAnnotationTarget, { kind: "heading" }> =>
      target.kind === "heading" &&
      normalizeHeadingText(target.text) === text &&
      (input.level === undefined || target.level === input.level),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * `markdown-it` typography can turn source punctuation into its displayed
 * equivalent before the render rule sees it. This is intentionally limited to
 * visual punctuation and whitespace: Markdown syntax itself is never guessed
 * away when locating a durable source range.
 */
function normalizeHeadingText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolves the durable source locator for a rendered heading. The token index
 * is exact whenever the renderer still has the original markdown-it token
 * array. Some renderer paths rebuild that AST, in which case a unique
 * level-and-text match remains safe. Repeated headings without their original
 * token index intentionally remain unresolved rather than attaching a comment
 * to the wrong occurrence.
 */
export function resolveHeadingAnnotationTarget(input: {
  targets: ReadonlyMap<number, MarkdownDocumentAnnotationTarget>;
  tokenIndex: number;
  text: string;
  level: number;
}): Extract<MarkdownDocumentAnnotationTarget, { kind: "heading" }> | undefined {
  const tokenTarget = input.targets.get(input.tokenIndex);
  if (tokenTarget?.kind === "heading" && tokenTarget.level === input.level) {
    return tokenTarget;
  }

  return findUniqueHeadingAnnotationTarget(input);
}

interface MarkdownSourceToken {
  type: string;
  tag: string;
  map: [number, number] | null;
  content: string;
  info: string;
}

function annotationTargetFromToken(input: {
  token: MarkdownSourceToken;
  inline: MarkdownSourceToken | undefined;
  sourceLines: readonly string[];
}): MarkdownDocumentAnnotationTarget | null {
  const { token, inline, sourceLines } = input;
  if (!token.map) return null;
  const [start, end] = token.map;
  const lineStart = start + 1;
  const lineEnd = end;
  const excerpt = sourceLines.slice(start, end).join("\n");
  if (token.type === "heading_open" && /^h[1-6]$/.test(token.tag)) {
    const level = Number.parseInt(token.tag.slice(1), 10);
    if (!Number.isInteger(level)) return null;
    return {
      kind: "heading",
      level,
      lineStart,
      lineEnd,
      text: inline?.content.trim() ?? "",
      excerpt,
    };
  }
  if (token.type === "paragraph_open") {
    return { kind: "paragraph", lineStart, lineEnd, text: inline?.content.trim() ?? "", excerpt };
  }
  if (token.type === "blockquote_open") {
    return { kind: "blockquote", lineStart, lineEnd, text: "", excerpt };
  }
  if (token.type === "fence") {
    const language = token.info.trim().split(/\s+/, 1)[0] || null;
    return { kind: "fence", lineStart, lineEnd, text: token.content, excerpt, language };
  }
  return null;
}

/**
 * Returns only renderer items whose markdown-it source map reaches the file.
 * HTML fragments and translated documents deliberately do not enter here.
 */
export function collectMarkdownDocumentAnnotationTargets(input: {
  text: string;
  markdownit: ReturnType<typeof MarkdownIt>;
}): Map<number, MarkdownDocumentAnnotationTarget> {
  const targets = new Map<number, MarkdownDocumentAnnotationTarget>();
  const tokens = input.markdownit.parse(input.text, {}) as MarkdownSourceToken[];
  const sourceLines = input.text.split("\n");
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    const target = annotationTargetFromToken({
      token,
      inline: tokens[index + 1],
      sourceLines,
    });
    if (target) targets.set(index, target);
  }
  return targets;
}
