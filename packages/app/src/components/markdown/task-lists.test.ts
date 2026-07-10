import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";
import { applyTaskListMarkers, rewriteTaskListTokens } from "./task-lists";

function renderInlineContents(markdown: string): string[] {
  const parser = applyTaskListMarkers(new MarkdownIt({ typographer: true, linkify: true }));
  return parser
    .parse(markdown, {})
    .filter((token) => token.type === "inline")
    .map((token) => token.children?.[0]?.content ?? "");
}

describe("task list markers", () => {
  it("replaces unchecked and checked markers at the start of list items", () => {
    const contents = renderInlineContents("- [ ] todo\n- [x] done\n- [X] also done\n");
    expect(contents).toEqual(["☐ todo", "☑ done", "☑ also done"]);
  });

  it("works in nested and ordered lists", () => {
    const contents = renderInlineContents("1. [ ] first\n   - [x] nested\n");
    expect(contents).toEqual(["☐ first", "☑ nested"]);
  });

  it("leaves plain list items and mid-sentence brackets alone", () => {
    const contents = renderInlineContents("- plain item\n- see [x] marks the spot later\n");
    expect(contents).toEqual(["plain item", "see [x] marks the spot later"]);
  });

  it("does not touch task syntax inside code fences", () => {
    const parser = applyTaskListMarkers(new MarkdownIt());
    const tokens = parser.parse("```md\n- [ ] example\n```\n", {});
    const fence = tokens.find((token) => token.type === "fence");
    expect(fence?.content).toBe("- [ ] example\n");
  });

  it("does not touch paragraphs outside lists", () => {
    const contents = renderInlineContents("[ ] not a list item\n");
    expect(contents).toEqual(["[ ] not a list item"]);
  });

  it("requires a space after the closing bracket", () => {
    const contents = renderInlineContents("- [ ]tight\n- [x]tight\n");
    expect(contents).toEqual(["[ ]tight", "[x]tight"]);
  });

  it("rewrites hand-built token structures", () => {
    const text = { type: "text", content: "[x] ship it" };
    const tokens = [
      { type: "list_item_open", content: "" },
      { type: "paragraph_open", content: "" },
      { type: "inline", content: "[x] ship it", children: [text] },
    ];
    rewriteTaskListTokens(tokens);
    expect(text.content).toBe("☑ ship it");
  });
});
