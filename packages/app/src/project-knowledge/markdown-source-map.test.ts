import { describe, expect, it } from "vitest";
import { collectMarkdownSourceMap } from "./markdown-source-map";

describe("Knowledge Markdown source map", () => {
  it("maps repeated visible text to its distinct source locations", () => {
    const source = "One **daemon**. Another daemon.\n";
    const map = collectMarkdownSourceMap(source);
    expect(map.textRuns).toEqual([
      { text: "One ", start: 0, end: 4 },
      { text: "daemon", start: 6, end: 12 },
      { text: ". Another daemon.", start: 14, end: 31 },
    ]);
  });

  it("maps a Mermaid fence to its full editable block", () => {
    const source = "Before\n\n```mermaid\ngraph LR\nA-->B\n```\n";
    const map = collectMarkdownSourceMap(source);
    expect(map.fences).toEqual([
      {
        tokenIndex: 3,
        start: 8,
        end: source.length,
        contentStart: 19,
        contentEnd: 34,
        language: "mermaid",
        label: "Mermaid diagram",
      },
    ]);
  });

  it("continues across the invisible record-field separator", () => {
    const source = "Current truth.\n\n<!-- otto:knowledge-review-evidence -->\n\nEvidence text.\n";
    const evidenceStart = source.indexOf("Evidence text.");
    const map = collectMarkdownSourceMap(source);
    expect(map.textRuns).toEqual([
      { text: "Current truth.", start: 0, end: 14 },
      {
        text: "<!-- otto:knowledge-review-evidence -->",
        start: 16,
        end: 55,
      },
      { text: "Evidence text.", start: evidenceStart, end: evidenceStart + 14 },
    ]);
  });
});
