import { describe, expect, it } from "vitest";
import { splitMarkdownBlocks } from "./split-markdown-blocks";

describe("splitMarkdownBlocks", () => {
  it("splits on blank lines", () => {
    expect(splitMarkdownBlocks("first\n\nsecond")).toEqual(["first", "second"]);
  });

  it("keeps a fenced code block whole", () => {
    const text = "```js\nconst a = 1;\n\nconst b = 2;\n```";
    expect(splitMarkdownBlocks(text)).toEqual([text]);
  });

  it("keeps a display formula whole across a blank line", () => {
    const text = "$$\n\\begin{aligned}\na &= b \\\\\n\nc &= d\n\\end{aligned}\n$$";
    expect(splitMarkdownBlocks(text)).toEqual([text]);
  });

  it("does not hold the block open for a single-line formula", () => {
    expect(splitMarkdownBlocks("$$x^2$$\n\nafter")).toEqual(["$$x^2$$", "after"]);
  });

  it("separates a formula from the prose around it", () => {
    expect(splitMarkdownBlocks("before\n\n$$\nx^2\n$$\n\nafter")).toEqual([
      "before",
      "$$\nx^2\n$$",
      "after",
    ]);
  });

  it("leaves inline math to the paragraph it sits in", () => {
    expect(splitMarkdownBlocks("cost is $5 and $10\n\nthe area $A = \\pi r^2$ grows")).toEqual([
      "cost is $5 and $10",
      "the area $A = \\pi r^2$ grows",
    ]);
  });

  it("does not open display math inside a fence", () => {
    const text = "```\n$$\n```\n\nafter";
    expect(splitMarkdownBlocks(text)).toEqual(["```\n$$\n```", "after"]);
  });
});
