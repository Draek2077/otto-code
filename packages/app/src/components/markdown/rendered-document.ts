import type { RenderedDocumentKind } from "@/components/file-pane-render-mode";
import { asciiDocToMarkdown } from "@/components/markdown/asciidoc/asciidoc-to-markdown";
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
 *
 * A `.adoc` file is converted to markdown, which is what lets an AsciiDoc
 * `[mermaid]` block render through the same `MermaidBlock` as a ```mermaid
 * fence in a `.md`. Its own header attributes become the frontmatter block, and
 * the HTML pass is skipped — the converter already resolved AsciiDoc's own
 * passthrough markup.
 */
export function toRenderedDocument(kind: RenderedDocumentKind, content: string): RenderedDocument {
  if (kind === "mermaid") {
    return { frontmatter: null, body: toMermaidFenceDocument(content), enableHtmlish: false };
  }
  if (kind === "asciidoc") {
    const { frontmatter, body } = asciiDocToMarkdown(content);
    return { frontmatter, body, enableHtmlish: false };
  }
  const { frontmatter, body } = splitMarkdownFrontmatter(content);
  return { frontmatter, body, enableHtmlish: true };
}
