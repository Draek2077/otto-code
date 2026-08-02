import { describe, expect, it } from "vitest";
import { extractMarkdownHeadings } from "./markdown-headings.js";

describe("extractMarkdownHeadings", () => {
  it("returns ATX headings in document order with their levels", () => {
    const headings = extractMarkdownHeadings(
      ["# Title", "", "some prose", "", "## Setup", "", "### Install", ""].join("\n"),
    );
    expect(headings.map((h) => [h.level, h.text, h.line])).toEqual([
      [1, "Title", 1],
      [2, "Setup", 5],
      [3, "Install", 7],
    ]);
  });

  it("strips a closing marker run but leaves a trailing hash that is part of the text", () => {
    const headings = extractMarkdownHeadings(["## Closed ##", "", "# C#"].join("\n"));
    expect(headings.map((h) => h.text)).toEqual(["Closed", "C#"]);
  });

  it("reads Setext headings from their text line, not their underline", () => {
    const headings = extractMarkdownHeadings(
      ["Title", "=====", "", "Section", "-------"].join("\n"),
    );
    expect(headings.map((h) => [h.level, h.text, h.line])).toEqual([
      [1, "Title", 1],
      [2, "Section", 4],
    ]);
  });

  // The reason this parses instead of scanning for "#".
  it("ignores a hash line inside a fenced code block", () => {
    const headings = extractMarkdownHeadings(
      ["# Real", "", "```sh", "# not a heading", "```", "", "## Also real"].join("\n"),
    );
    expect(headings.map((h) => h.text)).toEqual(["Real", "Also real"]);
  });

  it("leaves inline markup as written", () => {
    expect(extractMarkdownHeadings("## The `code` path")[0]?.text).toBe("The `code` path");
  });

  it("reports an offset that lands on the heading", () => {
    const source = ["intro", "", "## Target"].join("\n");
    const heading = extractMarkdownHeadings(source)[0];
    expect(source.slice(heading!.from, heading!.from + 9)).toBe("## Target");
  });

  it("returns nothing for a document with no headings", () => {
    expect(extractMarkdownHeadings("just prose\n\nand more prose\n")).toEqual([]);
  });
});
