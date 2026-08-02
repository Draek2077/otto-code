// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { htmlIsWorthConverting, htmlToMarkdown, normalizeBlankLines } from "./markdown-paste";

describe("htmlToMarkdown", () => {
  it("keeps headings, emphasis and links as markdown", () => {
    expect(htmlToMarkdown("<h2>Setup</h2>")).toBe("## Setup");
    expect(htmlToMarkdown("<p><strong>bold</strong> and <em>italic</em></p>")).toBe(
      "**bold** and *italic*",
    );
    expect(htmlToMarkdown('<a href="https://x.test">link</a>')).toBe("[link](https://x.test)");
  });

  it("uses the same markers the formatting commands produce", () => {
    // ATX headings and `-` bullets, so pasted and typed content match.
    expect(htmlToMarkdown("<ul><li>one</li><li>two</li></ul>")).toBe("-   one\n-   two");
    expect(htmlToMarkdown("<h1>Title</h1>")).toBe("# Title");
  });

  // The single most common thing worth pasting that markdown can represent.
  it("converts a table to GFM rather than a run of cell text", () => {
    const html = "<table><tr><th>Name</th><th>Size</th></tr><tr><td>a</td><td>1</td></tr></table>";
    expect(htmlToMarkdown(html)).toBe("| Name | Size |\n| --- | --- |\n| a | 1 |");
  });

  it("escapes a pipe inside a cell so the row survives", () => {
    const html = "<table><tr><th>a|b</th></tr><tr><td>c</td></tr></table>";
    expect(htmlToMarkdown(html)).toContain("a\\|b");
  });

  it("collapses whitespace inside a cell, which markdown tables cannot carry", () => {
    const html = "<table><tr><th>one\n  two</th></tr><tr><td>x</td></tr></table>";
    expect(htmlToMarkdown(html)).toContain("| one two |");
  });

  it("keeps a fenced code block fenced", () => {
    expect(htmlToMarkdown("<pre><code>const a = 1;</code></pre>")).toBe("```\nconst a = 1;\n```");
  });

  it("drops elements that carry nothing a document can use", () => {
    expect(htmlToMarkdown("<style>.a{}</style><p>text</p>")).toBe("text");
    expect(htmlToMarkdown("<script>alert(1)</script><p>text</p>")).toBe("text");
  });

  it("returns null for empty or content-free html, so the caller can paste plain text", () => {
    expect(htmlToMarkdown("")).toBeNull();
    expect(htmlToMarkdown("   ")).toBeNull();
    expect(htmlToMarkdown("<span></span>")).toBeNull();
  });
});

describe("normalizeBlankLines", () => {
  // Browsers wrap everything in nested blocks; a two-sentence paste routinely
  // arrives with four blank lines in it.
  it("collapses runs of blank lines to one", () => {
    expect(normalizeBlankLines("a\n\n\n\n\nb")).toBe("a\n\nb");
  });

  // The outer trim takes the first line's indent with it, which is what makes a
  // paste land at the caret's own indentation rather than the browser's.
  it("strips trailing whitespace and outer blank lines", () => {
    expect(normalizeBlankLines("\n\n  a  \nb   \n\n")).toBe("a\nb");
  });
});

describe("htmlIsWorthConverting", () => {
  it("recognises real structure", () => {
    expect(htmlIsWorthConverting("<h1>x</h1>")).toBe(true);
    expect(htmlIsWorthConverting("<table><tr><td>x</td></tr></table>")).toBe(true);
    expect(htmlIsWorthConverting("<ul><li>x</li></ul>")).toBe(true);
  });

  // Copying from a plain-text editor still puts an HTML flavour on the
  // clipboard; converting it would only risk losing the exact whitespace.
  it("rejects the wrapper markup a plain-text copy produces", () => {
    expect(htmlIsWorthConverting('<span style="color:red">x</span>')).toBe(false);
    expect(htmlIsWorthConverting("<div><p>x</p></div>")).toBe(false);
    expect(htmlIsWorthConverting("plain text")).toBe(false);
  });
});
