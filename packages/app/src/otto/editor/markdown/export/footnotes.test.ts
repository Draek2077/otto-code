import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";
import { applyFootnotes, footnoteMarker } from "./footnotes";

function parse(markdown: string) {
  return applyFootnotes(new MarkdownIt()).parse(markdown, {});
}

/** Every inline token's rendered text, in document order. */
function inlineText(markdown: string): string[] {
  return parse(markdown)
    .filter((token) => token.type === "inline")
    .map((token) => token.content);
}

/** The block token types, so structural moves are visible in the assertion. */
function blockTypes(markdown: string): string[] {
  return parse(markdown)
    .map((token) => token.type)
    .filter((type) => type !== "inline");
}

describe("footnoteMarker", () => {
  it("uses real superscript characters", () => {
    expect(footnoteMarker(1)).toBe("¹");
    expect(footnoteMarker(7)).toBe("⁷");
  });

  it("composes multi-digit numbers", () => {
    expect(footnoteMarker(12)).toBe("¹²");
    expect(footnoteMarker(103)).toBe("¹⁰³");
  });
});

describe("footnotes", () => {
  const DOC = [
    "A claim[^src] and another[^book].",
    "",
    "[^src]: The source.",
    "[^book]: A book.",
  ].join("\n");

  it("replaces references with superscript markers", () => {
    expect(inlineText(DOC)[0]).toBe("A claim¹ and another².");
  });

  it("numbers by first reference, not by definition order", () => {
    const doc = ["See[^b] then[^a].", "", "[^a]: Alpha.", "[^b]: Beta."].join("\n");
    expect(inlineText(doc)[0]).toBe("See¹ then².");
    // Beta was referenced first, so it is note 1 and leads the list.
    expect(inlineText(doc).slice(1)).toEqual(["Beta.", "Alpha."]);
  });

  it("moves the definitions into a list at the end", () => {
    expect(blockTypes(DOC)).toEqual([
      "paragraph_open",
      "paragraph_close",
      "hr",
      "ordered_list_open",
      "list_item_open",
      "paragraph_open",
      "paragraph_close",
      "list_item_close",
      "list_item_open",
      "paragraph_open",
      "paragraph_close",
      "list_item_close",
      "ordered_list_close",
    ]);
  });

  it("strips the definition marker from the note text", () => {
    expect(inlineText(DOC).slice(1)).toEqual(["The source.", "A book."]);
  });

  it("keeps a repeated reference pointing at one note", () => {
    const doc = ["First[^a] and again[^a].", "", "[^a]: Once."].join("\n");
    expect(inlineText(doc)[0]).toBe("First¹ and again¹.");
    expect(inlineText(doc).slice(1)).toEqual(["Once."]);
  });

  // Numbering a note that does not exist would leave a hole in the list.
  it("leaves a reference with no definition exactly as written", () => {
    const doc = "A claim[^missing].\n";
    expect(inlineText(doc)).toEqual(["A claim[^missing]."]);
    expect(blockTypes(doc)).toEqual(["paragraph_open", "paragraph_close"]);
  });

  // Silently deleting the author's text would be worse than leaving it in place.
  it("leaves an unreferenced definition where the author put it", () => {
    const doc = ["Body text.", "", "[^unused]: Nobody points here."].join("\n");
    expect(inlineText(doc)).toEqual(["Body text.", "[^unused]: Nobody points here."]);
  });

  it("moves only the referenced definitions, leaving the rest alone", () => {
    const doc = ["Cite[^a].", "", "[^a]: Used.", "", "[^b]: Unused."].join("\n");
    expect(inlineText(doc)).toEqual(["Cite¹.", "[^b]: Unused.", "Used."]);
  });

  // The whole reason this runs on tokens rather than on the source text.
  it("does not touch footnote syntax inside a code fence", () => {
    const doc = ["```md", "A claim[^src].", "", "[^src]: The source.", "```"].join("\n");
    const fence = parse(doc).find((token) => token.type === "fence");
    expect(fence?.content).toBe("A claim[^src].\n\n[^src]: The source.\n");
    expect(blockTypes(doc)).toEqual(["fence"]);
  });

  it("leaves a document with no footnotes untouched", () => {
    expect(blockTypes("Just a paragraph.\n")).toEqual(["paragraph_open", "paragraph_close"]);
  });
});
