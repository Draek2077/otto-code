import { describe, expect, it } from "vitest";
import { htmlExportFileName, markdownToHtmlDocument } from "./markdown-to-html";

function body(markdown: string): string {
  const { html } = markdownToHtmlDocument(markdown, "untitled");
  return html.slice(html.indexOf("<body>") + "<body>".length, html.indexOf("</body>")).trim();
}

describe("markdownToHtmlDocument", () => {
  it("produces a complete standalone document", () => {
    const { html } = markdownToHtmlDocument("# Hello\n", "untitled");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
    expect(html).toContain("<title>Hello</title>");
  });

  // Standalone means it opens with no network at all.
  it("inlines its styles and fetches nothing", () => {
    const { html } = markdownToHtmlDocument("# Hello\n", "untitled");
    expect(html).toContain("<style>");
    expect(html).not.toMatch(/<link\b/);
    expect(html).not.toMatch(/<script\b/);
  });

  it("titles the document from its first heading", () => {
    expect(markdownToHtmlDocument("# Real Title\n\n# Later\n", "untitled").title).toBe(
      "Real Title",
    );
  });

  it("falls back to the given name when there is no heading", () => {
    expect(markdownToHtmlDocument("Just prose.\n", "notes.md").title).toBe("notes.md");
  });

  it("escapes a title that contains markup", () => {
    const { html } = markdownToHtmlDocument('# A <b> & "quote"\n', "untitled");
    expect(html).toContain("<title>A &lt;b&gt; &amp; &quot;quote&quot;</title>");
  });

  it("renders ordinary markdown", () => {
    expect(body("**bold** and `code`\n")).toBe(
      "<p><strong>bold</strong> and <code>code</code></p>",
    );
  });

  // The point of building the app's extensions as token rewrites: the export
  // gets them without a second implementation that could drift.
  it("carries task list state through as a drawn box", () => {
    const rendered = body("- [x] done\n- [ ] open\n");
    expect(rendered).toContain('<span class="task">☑</span> done');
    expect(rendered).toContain('<span class="task">☐</span> open');
  });

  it("carries GitHub alerts through as an attribute the stylesheet reads", () => {
    expect(body("> [!WARNING]\n> Be careful.\n")).toContain('data-otto-alert="warning"');
  });

  it("carries footnotes through, numbered and moved to the end", () => {
    const rendered = body("A claim[^a].\n\n[^a]: The source.\n");
    expect(rendered).toContain("A claim¹.");
    expect(rendered.indexOf("The source.")).toBeGreaterThan(rendered.indexOf("A claim¹."));
  });

  it("renders GFM tables", () => {
    const rendered = body("| a | b |\n| --- | --- |\n| 1 | 2 |\n");
    expect(rendered).toContain("<th>a</th>");
    expect(rendered).toContain("<td>1</td>");
  });

  // Embedded HTML is translated on the way in everywhere else; the export must
  // not become the one path that passes it through.
  it("does not pass raw HTML through", () => {
    expect(body("<script>alert(1)</script>\n")).not.toContain("<script>");
  });

  it("leaves a relative image relative, so it resolves beside the document", () => {
    expect(body("![flow](assets/flow.png)\n")).toContain('src="assets/flow.png"');
  });
});

describe("htmlExportFileName", () => {
  it("swaps the extension and drops the directory", () => {
    expect(htmlExportFileName("notes/design.md")).toBe("design.html");
    expect(htmlExportFileName("README.markdown")).toBe("README.html");
  });

  it("handles a windows path", () => {
    expect(htmlExportFileName("docs\\guide.md")).toBe("guide.html");
  });

  it("appends the extension when the file has none", () => {
    expect(htmlExportFileName("NOTES")).toBe("NOTES.html");
  });
});

describe("math in the export", () => {
  function exported(markdown: string): string {
    return markdownToHtmlDocument(markdown, "untitled").html;
  }

  // MathML needs no script and no stylesheet, so the saved file stays standalone.
  it("renders inline math as MathML", () => {
    const html = exported("Let $x^2$ be.\n");
    expect(html).toContain("<math");
    expect(html).toContain("<msup>");
    expect(html).not.toMatch(/<script\b/);
  });

  it("renders block math centred and as display MathML", () => {
    const html = exported("$$a = b$$\n");
    expect(html).toContain('<p class="math">');
    expect(html).toContain('display="block"');
  });

  it("falls back to the source when the TeX does not parse", () => {
    const html = exported("broken $\frac{$ here\n");
    expect(html).not.toContain("<math");
    expect(html).toContain("\frac{");
  });
});
