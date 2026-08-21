import { describe, expect, it } from "vitest";
import {
  buildRenderedFindIndex,
  findPreviewMatches,
  MAX_PREVIEW_FIND_MATCHES,
  splitTextForMatches,
  splitTokensForMatches,
  type PreviewFindQuery,
} from "./file-preview-find";

function query(overrides: Partial<PreviewFindQuery> = {}): PreviewFindQuery {
  return { search: "", caseSensitive: false, wholeWord: false, regexp: false, ...overrides };
}

describe("findPreviewMatches", () => {
  it("finds plain-text matches with 1-based lines and in-line offsets", () => {
    const matches = findPreviewMatches("alpha\nbeta alpha\n", query({ search: "alpha" }));
    expect(matches).toEqual([
      { line: 1, start: 0, end: 5 },
      { line: 2, start: 5, end: 10 },
    ]);
  });

  it("returns nothing for an empty query", () => {
    expect(findPreviewMatches("anything", query())).toEqual([]);
  });

  it("is case-insensitive by default and case-sensitive on request", () => {
    const content = "Foo foo FOO";
    expect(findPreviewMatches(content, query({ search: "foo" }))).toHaveLength(3);
    expect(findPreviewMatches(content, query({ search: "foo", caseSensitive: true }))).toEqual([
      { line: 1, start: 4, end: 7 },
    ]);
  });

  it("escapes regexp metacharacters in plain-text mode", () => {
    expect(findPreviewMatches("a.c abc", query({ search: "a.c" }))).toEqual([
      { line: 1, start: 0, end: 3 },
    ]);
  });

  it("supports regexp mode", () => {
    expect(findPreviewMatches("cat cot cut", query({ search: "c[ao]t", regexp: true }))).toEqual([
      { line: 1, start: 0, end: 3 },
      { line: 1, start: 4, end: 7 },
    ]);
  });

  it("treats an invalid regexp as no matches", () => {
    expect(findPreviewMatches("(((", query({ search: "(", regexp: true }))).toEqual([]);
  });

  it("does not loop on zero-width regexp matches", () => {
    expect(findPreviewMatches("abc", query({ search: "x*", regexp: true }))).toEqual([]);
  });

  it("honours whole-word matching, including unicode word characters", () => {
    const content = "cat category concat cat";
    const matches = findPreviewMatches(content, query({ search: "cat", wholeWord: true }));
    expect(matches).toEqual([
      { line: 1, start: 0, end: 3 },
      { line: 1, start: 20, end: 23 },
    ]);
    expect(findPreviewMatches("écat cat", query({ search: "cat", wholeWord: true }))).toEqual([
      { line: 1, start: 5, end: 8 },
    ]);
  });

  it("caps the match list", () => {
    const content = "a".repeat(5000);
    const matches = findPreviewMatches(content, query({ search: "a" }));
    expect(matches).toHaveLength(MAX_PREVIEW_FIND_MATCHES);
  });
});

describe("splitTokensForMatches", () => {
  const tokens = [
    { text: "const ", style: "keyword" },
    { text: "value", style: "variable" },
    { text: " = 1;", style: null },
  ] as const;

  it("passes tokens through untouched when there are no ranges", () => {
    expect(splitTokensForMatches(tokens, [])).toEqual([
      { text: "const ", style: "keyword", highlight: null },
      { text: "value", style: "variable", highlight: null },
      { text: " = 1;", style: null, highlight: null },
    ]);
  });

  it("cuts a match inside a single token", () => {
    const segments = splitTokensForMatches(tokens, [{ start: 6, end: 11, active: false }]);
    expect(segments).toEqual([
      { text: "const ", style: "keyword", highlight: null },
      { text: "value", style: "variable", highlight: "match" },
      { text: " = 1;", style: null, highlight: null },
    ]);
  });

  it("cuts a match spanning token boundaries while keeping each style", () => {
    const segments = splitTokensForMatches(tokens, [{ start: 4, end: 8, active: true }]);
    expect(segments).toEqual([
      { text: "cons", style: "keyword", highlight: null },
      { text: "t ", style: "keyword", highlight: "active" },
      { text: "va", style: "variable", highlight: "active" },
      { text: "lue", style: "variable", highlight: null },
      { text: " = 1;", style: null, highlight: null },
    ]);
  });

  it("handles several ranges on one line, active flagged individually", () => {
    const segments = splitTokensForMatches(
      [{ text: "aa bb aa", style: null }],
      [
        { start: 0, end: 2, active: false },
        { start: 6, end: 8, active: true },
      ],
    );
    expect(segments).toEqual([
      { text: "aa", style: null, highlight: "match" },
      { text: " bb ", style: null, highlight: null },
      { text: "aa", style: null, highlight: "active" },
    ]);
  });
});

describe("splitTextForMatches", () => {
  it("returns the whole run untouched when there are no matches", () => {
    expect(splitTextForMatches("hello world", [])).toEqual([
      { text: "hello world", highlight: null },
    ]);
  });

  it("cuts matches out as their own segments and marks the active one", () => {
    expect(
      splitTextForMatches("the cat sat on the cat", [
        { start: 4, end: 7, active: true },
        { start: 19, end: 22, active: false },
      ]),
    ).toEqual([
      { text: "the ", highlight: null },
      { text: "cat", highlight: "active" },
      { text: " sat on the ", highlight: null },
      { text: "cat", highlight: "match" },
    ]);
  });

  it("drops a range that starts past the end of the run", () => {
    expect(splitTextForMatches("short", [{ start: 99, end: 102, active: false }])).toEqual([
      { text: "short", highlight: null },
    ]);
  });
});

describe("buildRenderedFindIndex", () => {
  const runs = ["Alpha and beta", "beta again", "nothing here"];

  it("counts matches across every run in reading order", () => {
    expect(buildRenderedFindIndex(runs, query({ search: "beta" }), 0).total).toBe(2);
  });

  it("marks only the active match, in reading order across runs", () => {
    const index = buildRenderedFindIndex(runs, query({ search: "beta" }), 1);
    expect(index.byContent.get("Alpha and beta")).toEqual([{ start: 10, end: 14, active: false }]);
    expect(index.byContent.get("beta again")).toEqual([{ start: 0, end: 4, active: true }]);
  });

  it("places the active match as a fraction of the document's rendered text", () => {
    // "Alpha and beta" is 14 chars of a 36-char document; the second hit starts
    // right after it.
    const index = buildRenderedFindIndex(runs, query({ search: "beta" }), 1);
    expect(index.activeFraction).toBeCloseTo(14 / 36, 5);
  });

  it("has no active match, and so no scroll target, once the index runs past the end", () => {
    const index = buildRenderedFindIndex(runs, query({ search: "beta" }), 9);
    expect(index.activeFraction).toBeNull();
    expect([...index.byContent.values()].flat().every((range) => !range.active)).toBe(true);
  });

  it("shares one entry between runs that read identically", () => {
    const index = buildRenderedFindIndex(["same", "same"], query({ search: "same" }), 0);
    expect(index.total).toBe(2);
    expect(index.byContent.size).toBe(1);
  });

  it("honors case, whole-word and regexp the way the code view does", () => {
    expect(
      buildRenderedFindIndex(["Foo foo"], query({ search: "foo", caseSensitive: true }), 0).total,
    ).toBe(1);
    expect(
      buildRenderedFindIndex(["cat catalog"], query({ search: "cat", wholeWord: true }), 0).total,
    ).toBe(1);
    expect(
      buildRenderedFindIndex(["a1 b2"], query({ search: "[a-z][0-9]", regexp: true }), 0).total,
    ).toBe(2);
  });

  it("returns nothing for an empty or half-typed query", () => {
    expect(buildRenderedFindIndex(runs, query(), 0).total).toBe(0);
    expect(buildRenderedFindIndex(runs, query({ search: "(", regexp: true }), 0).total).toBe(0);
  });

  it("caps the match list the same way the code view does", () => {
    const many = Array.from({ length: MAX_PREVIEW_FIND_MATCHES + 50 }, () => "x");
    expect(buildRenderedFindIndex(many, query({ search: "x" }), 0).total).toBe(
      MAX_PREVIEW_FIND_MATCHES,
    );
  });
});
