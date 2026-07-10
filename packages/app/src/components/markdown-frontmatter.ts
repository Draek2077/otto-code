export interface SplitMarkdownFrontmatterResult {
  /** Frontmatter content without the `---` delimiters, or null when absent. */
  frontmatter: string | null;
  body: string;
}

/**
 * Splits leading YAML frontmatter off a markdown document so the viewer can
 * render it as a metadata block. Without this, the opening `---` renders as a
 * horizontal rule and the fields spill into the document body as prose.
 */
export function splitMarkdownFrontmatter(text: string): SplitMarkdownFrontmatterResult {
  const openMatch = /^---[ \t]*\r?\n/.exec(text);
  if (!openMatch) {
    return { frontmatter: null, body: text };
  }
  const rest = text.slice(openMatch[0].length);
  const closeMatch = /^---[ \t]*(?:\r?\n|$)/m.exec(rest);
  if (!closeMatch || closeMatch.index === undefined) {
    return { frontmatter: null, body: text };
  }
  const frontmatter = rest.slice(0, closeMatch.index).replace(/\r?\n$/, "");
  const body = rest.slice(closeMatch.index + closeMatch[0].length);
  return { frontmatter, body };
}
