const MARKDOWN_EXTENSIONS = new Set(["md", "mdx", "markdown"]);

/**
 * Whether a path is a markdown file, by extension.
 *
 * Shared by everything that has to decide before there is a document to parse:
 * which language extension to mount, whether the surface claims the markdown
 * focus scope, and whether the formatting toolbar appears. The runtime check
 * for "is this position markdown" is a different question with a different
 * answer (`markdownLanguage.isActiveAt`, which is false inside a code fence)
 * and lives in markdown-commands.ts.
 */
export function isMarkdownPath(path: string): boolean {
  const extension = path.split(".").pop()?.toLowerCase();
  return extension !== undefined && MARKDOWN_EXTENSIONS.has(extension);
}
