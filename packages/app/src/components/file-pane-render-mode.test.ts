import { describe, expect, it } from "vitest";
import {
  defaultFileViewMode,
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

describe("renderedDocumentKind", () => {
  it("names the pipeline a file renders through", () => {
    expect(renderedDocumentKind("README.md")).toBe("markdown");
    expect(renderedDocumentKind("docs/flow.mmd")).toBe("mermaid");
    expect(renderedDocumentKind("archdocs/pages/01-overview.adoc")).toBe("asciidoc");
    expect(renderedDocumentKind("notes.asciidoc")).toBe("asciidoc");
    expect(renderedDocumentKind("src/index.ts")).toBeNull();
  });

  it("leaves PGP armored files as source", () => {
    expect(renderedDocumentKind("release.asc")).toBeNull();
  });
});

describe("defaultFileViewMode", () => {
  it("opens rendered formats in preview", () => {
    expect(defaultFileViewMode("README.md")).toBe("preview");
    expect(defaultFileViewMode("docs/guide.markdown")).toBe("preview");
    expect(defaultFileViewMode("docs/flow.mmd")).toBe("preview");
    expect(defaultFileViewMode("docs/arch.mermaid")).toBe("preview");
    expect(defaultFileViewMode("archdocs/pages/01-overview.adoc")).toBe("preview");
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
