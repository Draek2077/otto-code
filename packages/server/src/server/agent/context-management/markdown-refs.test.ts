import { describe, expect, it } from "vitest";
import { extractMarkdownRefs, isMarkdownTarget } from "./markdown-refs.js";

describe("extractMarkdownRefs", () => {
  it("distinguishes an @import from a markdown link", () => {
    const text = "See @docs/always.md and [maybe](docs/maybe.md).";
    const refs = extractMarkdownRefs(text);

    expect(refs.map((ref) => ({ kind: ref.kind, rawTarget: ref.rawTarget }))).toEqual([
      { kind: "import", rawTarget: "docs/always.md" },
      { kind: "reference", rawTarget: "docs/maybe.md" },
    ]);
  });

  it("reports ranges that select the whole token in the original text", () => {
    const text = "prefix @docs/a.md tail";
    const [ref] = extractMarkdownRefs(text);

    expect(ref).toBeDefined();
    expect(text.slice(ref!.start, ref!.end)).toBe("@docs/a.md");
  });

  it("gives a link range covering the full markdown link", () => {
    const text = "x [label](docs/a.md) y";
    const [ref] = extractMarkdownRefs(text);

    expect(text.slice(ref!.start, ref!.end)).toBe("[label](docs/a.md)");
  });

  it("ignores references inside fenced code blocks", () => {
    const text = [
      "before",
      "```",
      "@docs/fenced.md",
      "[x](docs/fenced-link.md)",
      "```",
      "after",
    ].join("\n");

    expect(extractMarkdownRefs(text)).toEqual([]);
  });

  it("ignores references inside inline code", () => {
    expect(extractMarkdownRefs("use `@docs/inline.md` here")).toEqual([]);
  });

  it("ignores external link targets", () => {
    const refs = extractMarkdownRefs("[site](https://example.com) and [anchor](#section)");

    expect(refs).toEqual([]);
  });

  it("drops trailing sentence punctuation from an import path", () => {
    const [ref] = extractMarkdownRefs("Load @docs/a.md, then stop.");

    expect(ref?.rawTarget).toBe("docs/a.md");
  });

  it("keeps scoped package mentions as candidates for the resolver to reject", () => {
    // `@otto-code/protocol` looks like a path; only existence can rule it out,
    // so the parser must not silently drop it.
    const [ref] = extractMarkdownRefs("import from @otto-code/protocol");

    expect(ref?.rawTarget).toBe("otto-code/protocol");
    expect(isMarkdownTarget("otto-code/protocol")).toBe(false);
  });

  it("reads reference-style link definitions", () => {
    const [ref] = extractMarkdownRefs("[label]: docs/ref.md");

    expect(ref).toMatchObject({ kind: "reference", rawTarget: "docs/ref.md" });
  });
});
