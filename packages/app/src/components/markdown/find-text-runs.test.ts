import { describe, expect, it } from "vitest";
import { collectRenderedTextRuns } from "./find-text-runs";

function runs(text: string, enableHtmlish = true): string[] {
  return collectRenderedTextRuns({ text, enableHtmlish, remoteImages: "altText" });
}

describe("collectRenderedTextRuns", () => {
  it("collects prose in reading order", () => {
    expect(runs("# Title\n\nFirst para.\n\nSecond para.\n")).toEqual([
      "Title",
      "First para.",
      "Second para.",
    ]);
  });

  it("keeps a heading's words ahead of the body that follows it", () => {
    const collected = runs("Intro text.\n\n## Later heading\n\nTrailing text.\n");
    expect(collected.indexOf("Intro text.")).toBeLessThan(collected.indexOf("Later heading"));
    expect(collected.indexOf("Later heading")).toBeLessThan(collected.indexOf("Trailing text."));
  });

  it("collects inline code, which the shared rules render as text", () => {
    expect(runs("Call `doThing()` first.\n")).toContain("doThing()");
  });

  it("splits emphasis into its own run, the way the renderer nests it", () => {
    expect(runs("plain **bold** tail\n")).toEqual(["plain ", "bold", " tail"]);
  });

  it("collects list items and table cells", () => {
    expect(runs("- one\n- two\n")).toEqual(["one", "two"]);
    expect(runs("| a | b |\n| - | - |\n| c | d |\n")).toEqual(["a", "b", "c", "d"]);
  });

  it("collects a link's label but not its href", () => {
    const collected = runs("See [the docs](https://example.com/page).\n");
    expect(collected).toContain("the docs");
    expect(collected.join(" ")).not.toContain("example.com");
  });

  it("leaves fenced code out: it renders through the highlighter, not the text rule", () => {
    expect(runs("Before.\n\n```ts\nconst secret = 1;\n```\n\nAfter.\n")).toEqual([
      "Before.",
      "After.",
    ]);
  });

  it("leaves a collapsed <details> body out rather than counting hidden text", () => {
    const collected = runs(
      "Visible.\n\n<details><summary>More</summary>\n\nHidden.\n\n</details>\n",
    );
    expect(collected).toContain("Visible.");
    expect(collected).not.toContain("Hidden.");
  });

  it("returns nothing for an empty document", () => {
    expect(runs("")).toEqual([]);
  });

  it("reads a mermaid document, which arrives as a single fence, as no prose", () => {
    expect(runs("```mermaid\ngraph TD;\nA-->B;\n```\n", false)).toEqual([]);
  });
});
