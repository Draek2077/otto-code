import { describe, expect, it } from "vitest";
import { collectHtmlAnchorIds, resolveDocumentAnchor } from "./document-anchors";
import { HTML_ANCHOR_TOKEN } from "./html-anchors";
import { normalizeHtmlishMarkdown } from "./html-ish";
import { defaultMarkdownParser } from "./parser";

// The shape route-os uses: an id on each requirement row, linked from other files.
const verificationTable = [
  "| ID | Criterion | Evidence |",
  "| --- | --- | --- |",
  '| ROS-AC-17 | <a id="ros-ac-17"></a>Releases are reproducible | Build logs |',
  '| ROS-AC-18 | <a id="ros-ac-18"></a>A clean checkout runs ordinary setup/build/test | Portable entrypoints |',
].join("\n");

interface Token {
  type: string;
  attrs?: Array<[string, string]> | null;
  children?: Token[] | null;
}

function anchorTokens(markdown: string): Token[] {
  const found: Token[] = [];
  const visit = (tokens: Token[]) => {
    for (const token of tokens) {
      if (token.type === HTML_ANCHOR_TOKEN) found.push(token);
      if (token.children) visit(token.children);
    }
  };
  visit(defaultMarkdownParser.parse(markdown, {}) as Token[]);
  return found;
}

describe("html anchor sanitization", () => {
  it("keeps only the id of an anchor inside a table cell", () => {
    const normalized = normalizeHtmlishMarkdown(verificationTable, { anchors: true });
    expect(normalized).toContain('| ROS-AC-18 | <a id="ros-ac-18"></a>A clean checkout runs');
    const tokens = anchorTokens(normalized);
    expect(tokens.map((token) => token.attrs)).toEqual([
      [["id", "ros-ac-17"]],
      [["id", "ros-ac-18"]],
    ]);
  });

  it("drops anchors entirely unless the surface opts in", () => {
    expect(normalizeHtmlishMarkdown(verificationTable)).toContain(
      "| ROS-AC-18 | A clean checkout runs",
    );
  });

  it("recognizes a name, a span id, and an unclosed named anchor", () => {
    const source =
      '<a name="Mixed_Case"></a> one <span id="inline">two</span> <a name="bare"> three';
    expect(normalizeHtmlishMarkdown(source, { anchors: true })).toBe(
      '<a id="Mixed_Case"></a> one <a id="inline"></a>two <a id="bare"></a> three',
    );
  });

  it("carries no attribute but the id, and keeps a link that also has one", () => {
    const source =
      '<a id="x" onclick="alert(1)" style="color:red" class="c"></a><a id="y" href="#x">back</a>';
    expect(normalizeHtmlishMarkdown(source, { anchors: true })).toBe(
      '<a id="x"></a><a id="y"></a>[back](#x)',
    );
  });

  it("refuses ids that could break out of the marker", () => {
    const source = '<a id="a b"></a><a id=\'q"uote\'></a><span id="<x>">t</span>';
    expect(normalizeHtmlishMarkdown(source, { anchors: true })).toBe("t");
  });

  it("does not turn anchor markup in code into an anchor", () => {
    const markdown = [
      'Inline `<a id="in-code"></a>` stays text.',
      "",
      "```html",
      '<a id="in-fence"></a>',
      "```",
    ].join("\n");
    expect(collectHtmlAnchorIds(markdown)).toEqual(new Set());
  });

  it("never lets a raw anchor with extra attributes through the parser", () => {
    // Without html-ish canonicalizing it first, the document parser (html: false)
    // leaves this as literal text rather than an anchor.
    expect(anchorTokens('<a id="x" onclick="y"></a>')).toEqual([]);
  });
});

describe("collectHtmlAnchorIds", () => {
  it("lists the anchors a document will render", () => {
    expect(collectHtmlAnchorIds(`# Verification\n\n${verificationTable}\n`)).toEqual(
      new Set(["ros-ac-17", "ros-ac-18"]),
    );
  });
});

describe("resolveDocumentAnchor", () => {
  const headingAnchors = new Set(["fp-02-durable-messaging-and-controlled-scale", "café-options"]);
  const htmlAnchorIds = new Set(["ros-ac-18", "Mixed_Case", "café-options"]);

  it("matches an explicit id exactly", () => {
    expect(resolveDocumentAnchor({ fragment: "ros-ac-18", headingAnchors, htmlAnchorIds })).toEqual(
      { kind: "id", value: "ros-ac-18" },
    );
    expect(
      resolveDocumentAnchor({ fragment: "Mixed_Case", headingAnchors, htmlAnchorIds }),
    ).toEqual({ kind: "id", value: "Mixed_Case" });
  });

  it("matches a heading slug, as written or slugged from the heading text", () => {
    expect(
      resolveDocumentAnchor({
        fragment: "fp-02-durable-messaging-and-controlled-scale",
        headingAnchors,
        htmlAnchorIds,
      }),
    ).toEqual({ kind: "heading", value: "fp-02-durable-messaging-and-controlled-scale" });
    expect(
      resolveDocumentAnchor({
        fragment: "FP-02 Durable messaging and controlled scale",
        headingAnchors,
        htmlAnchorIds,
      }),
    ).toEqual({ kind: "heading", value: "fp-02-durable-messaging-and-controlled-scale" });
  });

  it("prefers the explicit id when a heading shares its name", () => {
    expect(
      resolveDocumentAnchor({ fragment: "café-options", headingAnchors, htmlAnchorIds }),
    ).toEqual({ kind: "id", value: "café-options" });
  });

  it("reports nothing for a fragment the document does not contain", () => {
    expect(resolveDocumentAnchor({ fragment: "ros-ac-99", headingAnchors, htmlAnchorIds })).toBe(
      null,
    );
    expect(resolveDocumentAnchor({ fragment: "mixed_case", headingAnchors, htmlAnchorIds })).toBe(
      null,
    );
  });
});
