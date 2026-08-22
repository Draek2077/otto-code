import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";
import { toMermaidFenceDocument } from "./mermaid-document";

function fenceTokens(document: string) {
  return new MarkdownIt().parse(document, {}).filter((token) => token.type === "fence");
}

describe("toMermaidFenceDocument", () => {
  it("wraps diagram source as a single mermaid fence", () => {
    const document = toMermaidFenceDocument("graph TD\n  A --> B");
    const [fence, ...rest] = fenceTokens(document);

    expect(rest).toHaveLength(0);
    expect(fence?.info.trim()).toBe("mermaid");
    expect(fence?.content).toBe("graph TD\n  A --> B\n");
  });

  it("keeps YAML frontmatter inside the fence - mermaid parses it itself", () => {
    const source = "---\ntitle: Flow\n---\ngraph TD\n  A --> B";
    const [fence] = fenceTokens(toMermaidFenceDocument(source));

    expect(fence?.content).toContain("title: Flow");
  });

  it("outgrows backtick runs in the source so the fence cannot close early", () => {
    const source = 'graph TD\n  A["```"] --> B';
    const document = toMermaidFenceDocument(source);
    const [fence, ...rest] = fenceTokens(document);

    expect(rest).toHaveLength(0);
    expect(document.startsWith("````mermaid")).toBe(true);
    expect(fence?.content).toContain("```");
  });

  it("survives an empty file without producing a broken fence", () => {
    const [fence, ...rest] = fenceTokens(toMermaidFenceDocument(""));

    expect(rest).toHaveLength(0);
    expect(fence?.info.trim()).toBe("mermaid");
    expect(fence?.content.trim()).toBe("");
  });
});
