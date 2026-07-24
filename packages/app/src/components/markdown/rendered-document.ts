import type { RenderedDocumentKind } from "@/components/file-pane-render-mode";
import { toMermaidFenceDocument } from "@/components/markdown/mermaid/mermaid-document";
import { splitMarkdownFrontmatter } from "@/components/markdown-frontmatter";

export interface RenderedDocument {
  /** Shown above the body as a metadata block; mermaid keeps its own. */
  frontmatter: string | null;
  /** Markdown handed to `MarkdownRenderer`. */
  body: string;
  /** Whether the embedded-HTML translation pass should run over the body. */
  enableHtmlish: boolean;
}

/**
 * Turn a file the viewer renders (rather than highlights) into what the markdown
 * pipeline needs.
 *
 * A `.md` file splits its YAML frontmatter off and runs the HTML translation. A
 * `.mmd`/`.mermaid` file *is* one diagram, so it becomes a single fence and
 * skips both passes: it contains no HTML, and its frontmatter belongs to
 * mermaid, which parses it itself.
 */
export function toRenderedDocument(kind: RenderedDocumentKind, content: string): RenderedDocument {
  if (kind === "mermaid") {
    return { frontmatter: null, body: toMermaidFenceDocument(content), enableHtmlish: false };
  }
  const { frontmatter, body } = splitMarkdownFrontmatter(content);
  return { frontmatter, body, enableHtmlish: true };
}
