import { describe, expect, it } from "vitest";
import {
  defaultFileViewMode,
  exceedsHighlightBudget,
  HIGHLIGHT_MAX_CHARS,
  HIGHLIGHT_MAX_LINES,
  isRenderedHtmlFile,
  isRenderedMarkdownFile,
  isRenderedMermaidFile,
  renderedDocumentKind,
} from "@/components/file-pane-render-mode";

describe("isRenderedMarkdownFile", () => {
  it("detects .md files", () => {
    expect(isRenderedMarkdownFile("README.md")).toBe(true);
    expect(isRenderedMarkdownFile("docs/guide.MD")).toBe(true);
  });

  it("detects .markdown files", () => {
    expect(isRenderedMarkdownFile("notes.markdown")).toBe(true);
    expect(isRenderedMarkdownFile("docs/CHANGELOG.MARKDOWN")).toBe(true);
  });

  it("does not treat .mdx files as rendered markdown", () => {
    expect(isRenderedMarkdownFile("page.mdx")).toBe(false);
  });

  it("does not treat other text files as rendered markdown", () => {
    expect(isRenderedMarkdownFile("src/index.ts")).toBe(false);
    expect(isRenderedMarkdownFile("README.md.txt")).toBe(false);
  });
});

describe("isRenderedMermaidFile", () => {
  it("detects standalone diagram files", () => {
    expect(isRenderedMermaidFile("docs/flow.mmd")).toBe(true);
    expect(isRenderedMermaidFile("ARCH.MERMAID")).toBe(true);
  });

  it("does not treat other text files as diagrams", () => {
    expect(isRenderedMermaidFile("README.md")).toBe(false);
    expect(isRenderedMermaidFile("flow.mmd.txt")).toBe(false);
  });
});

describe("isRenderedHtmlFile", () => {
  it("recognizes HTML files case-insensitively", () => {
    expect(isRenderedHtmlFile("site/index.html")).toBe(true);
    expect(isRenderedHtmlFile("site/LANDING.HTML")).toBe(true);
    expect(isRenderedHtmlFile("site/legacy.htm")).toBe(true);
  });

  it("does not treat HTML-suffixed files as HTML", () => {
    expect(isRenderedHtmlFile("site/index.html.txt")).toBe(false);
  });
});

describe("renderedDocumentKind", () => {
  it("names the pipeline a file renders through", () => {
    expect(renderedDocumentKind("README.md")).toBe("markdown");
    expect(renderedDocumentKind("docs/flow.mmd")).toBe("mermaid");
    expect(renderedDocumentKind("archdocs/pages/01-overview.adoc")).toBe("asciidoc");
    expect(renderedDocumentKind("notes.asciidoc")).toBe("asciidoc");
    expect(renderedDocumentKind("site/index.html")).toBe("html");
    expect(renderedDocumentKind("src/index.ts")).toBeNull();
  });

  it("leaves PGP armored files as source", () => {
    expect(renderedDocumentKind("release.asc")).toBeNull();
  });
});

describe("exceedsHighlightBudget", () => {
  it("highlights ordinary source files", () => {
    expect(exceedsHighlightBudget("")).toBe(false);
    expect(exceedsHighlightBudget("const a = 1;\nconst b = 2;\n")).toBe(false);
  });

  it("gives up on a file past the character budget", () => {
    expect(exceedsHighlightBudget("x".repeat(HIGHLIGHT_MAX_CHARS))).toBe(false);
    expect(exceedsHighlightBudget("x".repeat(HIGHLIGHT_MAX_CHARS + 1))).toBe(true);
  });

  it("gives up on a file past the line budget even when it is small", () => {
    expect(exceedsHighlightBudget("\n".repeat(HIGHLIGHT_MAX_LINES - 1))).toBe(false);
    expect(exceedsHighlightBudget("\n".repeat(HIGHLIGHT_MAX_LINES))).toBe(true);
  });
});

describe("defaultFileViewMode", () => {
  it("opens rendered formats in preview", () => {
    expect(defaultFileViewMode("README.md")).toBe("preview");
    expect(defaultFileViewMode("docs/guide.markdown")).toBe("preview");
    expect(defaultFileViewMode("docs/flow.mmd")).toBe("preview");
    expect(defaultFileViewMode("docs/arch.mermaid")).toBe("preview");
    expect(defaultFileViewMode("archdocs/pages/01-overview.adoc")).toBe("preview");
    expect(defaultFileViewMode("site/index.html")).toBe("preview");
    expect(defaultFileViewMode("assets/logo.svg")).toBe("preview");
    expect(defaultFileViewMode("shots/screen.PNG")).toBe("preview");
    expect(defaultFileViewMode("build/app.zip")).toBe("preview");
    expect(defaultFileViewMode("media/demo.mp4")).toBe("preview");
  });

  it("opens plain text and code in the editor", () => {
    expect(defaultFileViewMode("src/main.ts")).toBe("editor");
    expect(defaultFileViewMode("notes/todo.txt")).toBe("editor");
    expect(defaultFileViewMode("config.json")).toBe("editor");
    expect(defaultFileViewMode("Makefile")).toBe("editor");
    expect(defaultFileViewMode(".gitignore")).toBe("editor");
  });

  it("only reads the extension from the file name, not the directory", () => {
    expect(defaultFileViewMode("v1.2/CHANGELOG")).toBe("editor");
    expect(defaultFileViewMode("archive.zip/nested")).toBe("editor");
  });
});
