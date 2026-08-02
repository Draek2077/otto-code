import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";
import { applyMath, MATH_BLOCK_TOKEN, MATH_INLINE_TOKEN } from "./math";

function parse(markdown: string) {
  return applyMath(new MarkdownIt()).parse(markdown, {});
}

/** `[type, content]` for every inline child, so prose and math both show. */
function inlineChildren(markdown: string): Array<[string, string]> {
  return parse(markdown)
    .filter((token) => token.type === "inline")
    .flatMap((token) =>
      (token.children ?? []).map((child): [string, string] => [child.type, child.content]),
    );
}

/** The TeX of every block formula, in document order. */
function blockFormulas(markdown: string): string[] {
  return parse(markdown)
    .filter((token) => token.type === MATH_BLOCK_TOKEN)
    .map((token) => token.content);
}

describe("inline math", () => {
  it("captures the TeX between single dollars", () => {
    expect(inlineChildren("Let $x^2$ be.\n")).toEqual([
      ["text", "Let "],
      [MATH_INLINE_TOKEN, "x^2"],
      ["text", " be."],
    ]);
  });

  // A core-ruler pass would arrive after emphasis had already eaten these.
  it("keeps markdown metacharacters inside a formula intact", () => {
    expect(inlineChildren("$a_1 + b_2$\n")).toEqual([[MATH_INLINE_TOKEN, "a_1 + b_2"]]);
    expect(inlineChildren("$x * y * z$\n")).toEqual([[MATH_INLINE_TOKEN, "x * y * z"]]);
  });

  it("allows an escaped dollar inside a formula", () => {
    expect(inlineChildren(String.raw`$a \$ b$` + "\n")).toEqual([
      [MATH_INLINE_TOKEN, String.raw`a \$ b`],
    ]);
  });

  // Currency is the reason the guards exist.
  it("leaves prices alone", () => {
    expect(inlineChildren("it cost $5 and $10 total\n")).toEqual([
      ["text", "it cost $5 and $10 total"],
    ]);
  });

  it("requires a non-space just inside each delimiter", () => {
    expect(inlineChildren("$ x $\n")).toEqual([["text", "$ x $"]]);
  });

  it("leaves an unclosed dollar as text", () => {
    expect(inlineChildren("a $ b c\n")).toEqual([["text", "a $ b c"]]);
  });

  it("does not treat display delimiters as inline math", () => {
    expect(inlineChildren("$$x$$\n").filter(([type]) => type === MATH_INLINE_TOKEN)).toEqual([]);
  });

  // The whole reason this is a tokenizer rule rather than a text substitution.
  it("does not touch math syntax inside a code span or fence", () => {
    expect(inlineChildren("`$x^2$`\n")).toEqual([["code_inline", "$x^2$"]]);
    const fence = parse("```\n$x^2$\n```\n").find((token) => token.type === "fence");
    expect(fence?.content).toBe("$x^2$\n");
  });
});

describe("block math", () => {
  it("captures a formula written on one line", () => {
    expect(blockFormulas("$$x^2 + y^2 = z^2$$\n")).toEqual(["x^2 + y^2 = z^2"]);
  });

  it("captures a formula fenced across several lines", () => {
    const doc = ["$$", "\\int_0^1 f(x)\\,dx", "= F(1) - F(0)", "$$", ""].join("\n");
    expect(blockFormulas(doc)).toEqual(["\\int_0^1 f(x)\\,dx\n= F(1) - F(0)"]);
  });

  it("keeps the surrounding prose as its own blocks", () => {
    const doc = ["Before.", "", "$$a = b$$", "", "After.", ""].join("\n");
    expect(
      parse(doc)
        .map((token) => token.type)
        .filter((type) => type !== "inline"),
    ).toEqual([
      "paragraph_open",
      "paragraph_close",
      MATH_BLOCK_TOKEN,
      "paragraph_open",
      "paragraph_close",
    ]);
  });

  // Swallowing the rest of the document because a delimiter was mistyped is the
  // worst available failure, so an unclosed block is simply not math.
  it("leaves an unclosed block as ordinary text", () => {
    expect(blockFormulas("$$\nx = 1\n\nstill prose\n")).toEqual([]);
  });

  it("does not treat a lone pair of dollars as a formula", () => {
    expect(blockFormulas("$$\n$$\n")).toEqual([""]);
  });
});
