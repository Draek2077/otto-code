import type { RenderedDocumentKind } from "@/components/file-pane-render-mode";
import { asciiDocToMarkdown } from "@/components/markdown/asciidoc/asciidoc-to-markdown";
import { toMermaidFenceDocument } from "@/components/markdown/fence/mermaid/mermaid-document";
import { splitMarkdownFrontmatter } from "@/components/markdown-frontmatter";

export interface RenderedDocument {
  /** Shown above the body as a metadata block; mermaid keeps its own. */
  frontmatter: string | null;
  /** Markdown handed to `MarkdownRenderer`. */
  body: string;
  /** Whether the embedded-HTML translation pass should run over the body. */
  enableHtmlish: boolean;
  /**
   * How many source lines sit above `body`, so a line number the renderer
   * reports can be turned back into a line in the file.
   *
   * **Null means the mapping does not exist.** A mermaid document is rewritten
   * into a single synthesised fence and an AsciiDoc one is translated to
   * markdown, so neither body's line 4 is the file's line 4 plus a constant.
   * Anything that writes back to the file must refuse rather than guess.
   */
  bodyLineOffset: number | null;
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
 * the HTML pass is skipped - the converter already resolved AsciiDoc's own
 * passthrough markup.
 */
export function toRenderedDocument(kind: RenderedDocumentKind, content: string): RenderedDocument {
  if (kind === "mermaid") {
    return {
      frontmatter: null,
      body: toMermaidFenceDocument(content),
      enableHtmlish: false,
      bodyLineOffset: null,
    };
  }
  if (kind === "asciidoc") {
    const { frontmatter, body } = asciiDocToMarkdown(content);
    return { frontmatter, body, enableHtmlish: false, bodyLineOffset: null };
  }
  const { frontmatter, body } = splitMarkdownFrontmatter(content);
  // `body` is a suffix of `content`, so what was dropped is exactly the prefix,
  // and its newline count is the offset. Derived rather than reported by the
  // splitter so the two can never disagree.
  const dropped = content.slice(0, content.length - body.length);
  return {
    frontmatter,
    body,
    enableHtmlish: true,
    bodyLineOffset: dropped.split("\n").length - 1,
  };
}
