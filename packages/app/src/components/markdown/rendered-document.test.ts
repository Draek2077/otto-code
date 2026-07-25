import { describe, expect, it } from "vitest";
import { toRenderedDocument } from "./rendered-document";

describe("toRenderedDocument", () => {
  it("splits frontmatter off a markdown document and keeps HTML translation on", () => {
    const result = toRenderedDocument("markdown", "---\ntitle: Guide\n---\n# Heading\n");

    expect(result.frontmatter).toBe("title: Guide");
    expect(result.body).toBe("# Heading\n");
    expect(result.enableHtmlish).toBe(true);
  });

  it("wraps a diagram file as one fence and skips both passes", () => {
    const result = toRenderedDocument("mermaid", "sequenceDiagram\n  A->>B: hi");

    expect(result.frontmatter).toBeNull();
    expect(result.body).toContain("```mermaid");
    expect(result.body).toContain("sequenceDiagram");
    // The HTML pass would strip indentation from tag bodies; mermaid is
    // whitespace-sensitive and needs its source verbatim.
    expect(result.enableHtmlish).toBe(false);
  });

  it("leaves a diagram file's frontmatter in the body for mermaid to parse", () => {
    const result = toRenderedDocument("mermaid", "---\ntitle: Flow\n---\ngraph TD\n  A --> B");

    expect(result.frontmatter).toBeNull();
    expect(result.body).toContain("title: Flow");
  });

  it("converts an asciidoc document and lifts its header attributes", () => {
    const result = toRenderedDocument("asciidoc", "= Guide\n:version: 2\n\n== Setup\n\nDo *this*.");

    expect(result.frontmatter).toBe("version: 2");
    expect(result.body).toBe("# Guide\n\n## Setup\n\nDo **this**.");
    // The converter already resolved AsciiDoc's own passthrough markup, so the
    // HTML translation has nothing left to do.
    expect(result.enableHtmlish).toBe(false);
  });

  it("routes an asciidoc [mermaid] block to the same fence a .md would use", () => {
    const result = toRenderedDocument("asciidoc", "[mermaid]\n----\ngraph TD\n  A --> B\n----");

    expect(result.body).toBe("```mermaid\ngraph TD\n  A --> B\n```");
  });
});
