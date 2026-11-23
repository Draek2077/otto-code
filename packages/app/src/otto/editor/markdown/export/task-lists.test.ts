import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";
import {
  applyTaskListMarkers,
  rewriteTaskListTokens,
  TASK_LINE_ATTRIBUTE,
  TASK_STATE_ATTRIBUTE,
} from "./task-lists";

// Deliberately unannotated. Two copies of markdown-it's types are resolvable
// from here - the app's own and the hoisted `@types/markdown-it` - so naming
// the token type picks one and then fails to accept the other's tokens.
// Inference takes whichever the parser actually is.
function parse(markdown: string) {
  return applyTaskListMarkers(new MarkdownIt({ typographer: true, linkify: true })).parse(
    markdown,
    {},
  );
}

/** The text left after the marker is lifted out of the content. */
function inlineContents(markdown: string): string[] {
  return parse(markdown)
    .filter((token) => token.type === "inline")
    .map((token) => token.children?.[0]?.content ?? "");
}

// One of the two resolvable markdown-it type copies declares an attribute
// value as `string | number`, so read it as text rather than trusting either.
function attributeText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** `[state, line]` for every list item, in document order. */
function itemAttributes(markdown: string): Array<[string | null, string | null]> {
  return parse(markdown)
    .filter((token) => token.type === "list_item_open")
    .map((token) => [
      attributeText(token.attrGet(TASK_STATE_ATTRIBUTE)),
      attributeText(token.attrGet(TASK_LINE_ATTRIBUTE)),
    ]);
}

describe("task list markers", () => {
  // The marker leaves the text so the renderer can draw a real control in its
  // place; a glyph baked into the content is not something anyone can tap.
  it("lifts the marker out of the item text", () => {
    expect(inlineContents("- [ ] todo\n- [x] done\n- [X] also done\n")).toEqual([
      "todo",
      "done",
      "also done",
    ]);
  });

  it("records the checked state on the item", () => {
    expect(itemAttributes("- [ ] todo\n- [x] done\n- [X] also done\n").map(([state]) => state)) //
      .toEqual(["unchecked", "checked", "checked"]);
  });

  // Without the line there is nothing to write a toggle back to.
  it("records the 1-based source line of each item", () => {
    const markdown = ["# Notes", "", "- [ ] first", "- [x] second", ""].join("\n");
    expect(itemAttributes(markdown).map(([, line]) => line)).toEqual(["3", "4"]);
  });

  it("works in nested and ordered lists", () => {
    expect(inlineContents("1. [ ] first\n   - [x] nested\n")).toEqual(["first", "nested"]);
    expect(itemAttributes("1. [ ] first\n   - [x] nested\n").map(([state]) => state)).toEqual([
      "unchecked",
      "checked",
    ]);
  });

  it("leaves plain list items and mid-sentence brackets alone", () => {
    expect(inlineContents("- plain item\n- see [x] marks the spot later\n")).toEqual([
      "plain item",
      "see [x] marks the spot later",
    ]);
  });

  // A plain item is not a task, so it carries no state at all - which is how
  // the renderer tells "unchecked" from "not a checkbox".
  it("marks a plain list item with no state", () => {
    expect(itemAttributes("- plain item\n")).toEqual([[null, null]]);
  });

  it("does not touch task syntax inside code fences", () => {
    const parser = applyTaskListMarkers(new MarkdownIt());
    const tokens = parser.parse("```md\n- [ ] example\n```\n", {});
    const fence = tokens.find((token) => token.type === "fence");
    expect(fence?.content).toBe("- [ ] example\n");
  });

  it("does not touch paragraphs outside lists", () => {
    expect(inlineContents("[ ] not a list item\n")).toEqual(["[ ] not a list item"]);
  });

  it("requires a space after the closing bracket", () => {
    expect(inlineContents("- [ ]tight\n- [x]tight\n")).toEqual(["[ ]tight", "[x]tight"]);
  });

  // A token the parser synthesised rather than read has no `map`. That makes
  // the checkbox read-only, not broken.
  it("omits the line when the item has no source map", () => {
    const text = { type: "text", content: "[x] ship it" };
    const attributes: Array<[string, string]> = [];
    const tokens = [
      {
        type: "list_item_open",
        content: "",
        attrSet: (name: string, value: string) => attributes.push([name, value]),
      },
      { type: "paragraph_open", content: "" },
      { type: "inline", content: "[x] ship it", children: [text] },
    ];
    rewriteTaskListTokens(tokens);
    expect(text.content).toBe("ship it");
    expect(attributes).toEqual([[TASK_STATE_ATTRIBUTE, "checked"]]);
  });
});
