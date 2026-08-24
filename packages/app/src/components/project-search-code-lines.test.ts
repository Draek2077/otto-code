import { describe, expect, it } from "vitest";
import type { FileSearchMatch } from "@otto-code/protocol/messages";
import {
  buildSearchDisplayLines,
  getSearchLineSegments,
  resolveSearchLineTokens,
  searchHighlightExtension,
} from "@/components/project-search-code-lines";

const key = (hit: FileSearchMatch) => `${hit.line}:${hit.column}`;

function match(
  input: Partial<FileSearchMatch> & { line: number; column: number },
): FileSearchMatch {
  return {
    length: 3,
    lineText: "const foo = bar;",
    previewStart: input.column - 1,
    ...input,
  };
}

describe("buildSearchDisplayLines", () => {
  it("keeps one row per source line and preserves order", () => {
    const rows = buildSearchDisplayLines(
      [match({ line: 4, column: 7 }), match({ line: 9, column: 7 })],
      key,
    );
    expect(rows.map((row) => row.line)).toEqual([4, 9]);
  });

  it("collapses several matches on one line into one row with both ranges", () => {
    const rows = buildSearchDisplayLines(
      [
        match({ line: 4, column: 7, length: 3 }),
        match({ line: 4, column: 13, length: 3, previewStart: 12 }),
      ],
      key,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ranges).toEqual([
      { start: 6, end: 9, active: false },
      { start: 12, end: 15, active: false },
    ]);
    expect(rows[0]?.matchKeys).toEqual(["4:7", "4:13"]);
  });

  it("re-projects a second match into the row's own truncated window", () => {
    // The row renders the first match's window, which starts at column 41.
    const rows = buildSearchDisplayLines(
      [
        match({ line: 2, column: 101, length: 4, lineText: "x".repeat(240), previewStart: 60 }),
        match({ line: 2, column: 121, length: 4, lineText: "y".repeat(240), previewStart: 60 }),
      ],
      key,
    );
    expect(rows[0]?.text).toBe("x".repeat(240));
    expect(rows[0]?.ranges).toEqual([
      { start: 60, end: 64, active: false },
      { start: 80, end: 84, active: false },
    ]);
  });

  it("drops a highlight that falls outside the rendered window but keeps its key", () => {
    const rows = buildSearchDisplayLines(
      [
        match({ line: 2, column: 101, length: 4, lineText: "x".repeat(240), previewStart: 60 }),
        match({ line: 2, column: 900, length: 4, lineText: "y".repeat(240), previewStart: 60 }),
      ],
      key,
    );
    expect(rows[0]?.ranges).toEqual([{ start: 60, end: 64, active: false }]);
    expect(rows[0]?.matchKeys).toEqual(["2:101", "2:900"]);
  });

  it("ignores a zero-length hit, which has nothing to highlight", () => {
    const rows = buildSearchDisplayLines([match({ line: 3, column: 1, length: 0 })], key);
    expect(rows[0]?.ranges).toEqual([]);
    expect(rows[0]?.matchKeys).toEqual(["3:1"]);
  });
});

describe("resolveSearchLineTokens", () => {
  it("keeps tokens that reconstruct the line", () => {
    const tokens = [
      { text: "const", style: "keyword" as const },
      { text: " foo", style: null },
    ];
    expect(resolveSearchLineTokens("const foo", tokens)).toEqual(tokens);
  });

  it("falls back to one unstyled token when there are no tokens", () => {
    expect(resolveSearchLineTokens("const foo", null)).toEqual([
      { text: "const foo", style: null },
    ]);
  });

  it("falls back when the tokens disagree with the line", () => {
    expect(resolveSearchLineTokens("const foo", [{ text: "mismatch", style: "keyword" }])).toEqual([
      { text: "const foo", style: null },
    ]);
  });
});

describe("searchHighlightExtension", () => {
  it("resolves a grammar the highlighter has", () => {
    expect(searchHighlightExtension("src/alpha.ts")).toBe("ts");
  });

  it("is null for a file with no grammar, which renders as plain text", () => {
    expect(searchHighlightExtension("NOTICE")).toBeNull();
    expect(searchHighlightExtension("data.unknownext")).toBeNull();
  });
});

describe("getSearchLineSegments", () => {
  it("tokenizes a line once and reuses the result", () => {
    const [row] = buildSearchDisplayLines(
      [match({ line: 1, column: 7, length: 3, lineText: "const foo = 1;" })],
      key,
    );

    const first = getSearchLineSegments(row, "ts");
    const second = getSearchLineSegments(row, "ts");

    // The same instance, not an equal one: scrolling back over a result must
    // never re-parse it.
    expect(second).toBe(first);
  });

  it("lights the hit up inside the highlighted tokens", () => {
    const [row] = buildSearchDisplayLines(
      [match({ line: 1, column: 7, length: 3, lineText: "const foo = 1;" })],
      key,
    );

    const segments = getSearchLineSegments(row, "ts");

    expect(segments.map((segment) => segment.text).join("")).toBe("const foo = 1;");
    expect(segments.filter((segment) => segment.highlight === "match").map((s) => s.text)).toEqual([
      "foo",
    ]);
  });

  it("renders one unstyled run when the file has no grammar", () => {
    const [row] = buildSearchDisplayLines(
      [match({ line: 2, column: 1, length: 4, lineText: "otto rules" })],
      key,
    );

    const segments = getSearchLineSegments(row, null);

    expect(segments).toEqual([
      { text: "otto", style: null, highlight: "match" },
      { text: " rules", style: null, highlight: null },
    ]);
  });
});
