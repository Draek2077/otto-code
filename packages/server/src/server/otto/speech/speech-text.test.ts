import { describe, expect, it } from "vitest";
import { markdownToSpokenText } from "./speech-text.js";

describe("markdownToSpokenText", () => {
  it("speaks a heading's text, never its hashes", () => {
    expect(markdownToSpokenText("### The plan")).toBe("The plan.");
    expect(markdownToSpokenText("# Title #")).toBe("Title.");
  });

  it("does not double a stop the heading already ends with", () => {
    expect(markdownToSpokenText("## Ready?")).toBe("Ready?");
  });

  it("drops emphasis markers but keeps the words", () => {
    expect(markdownToSpokenText("This is **very** important and *urgent*.")).toBe(
      "This is very important and urgent.",
    );
    expect(markdownToSpokenText("__bold__ and _italic_ and ~~gone~~")).toBe(
      "bold and italic and gone",
    );
  });

  it("leaves intra-word underscores and asterisks alone", () => {
    expect(markdownToSpokenText("call agent_manager_start now")).toBe(
      "call agent_manager_start now",
    );
  });

  it("speaks a link's label, not its target", () => {
    expect(markdownToSpokenText("See [the docs](https://example.com/a/b) for more.")).toBe(
      "See the docs for more.",
    );
  });

  it("speaks an image's alt text", () => {
    expect(markdownToSpokenText("![a red square](img.png)")).toBe("a red square");
  });

  it("drops a bare autolink", () => {
    expect(markdownToSpokenText("Open <https://example.com> now").trim()).toBe("Open  now".trim());
  });

  it("keeps inline code content without the backticks", () => {
    expect(markdownToSpokenText("Run `npm test` first.")).toBe("Run npm test first.");
  });

  it("replaces a fenced code block with a spoken marker", () => {
    const input = ["Here is the fix:", "", "```ts", "const x = 1;", "```", "", "Done."].join("\n");
    expect(markdownToSpokenText(input)).toBe("Here is the fix:\n\ncode block.\n\nDone.");
  });

  it("does not read an unclosed trailing fence", () => {
    expect(markdownToSpokenText("Start\n\n```\nsecret();\n")).toBe("Start\n\ncode block.");
  });

  it("strips list bullets, ordered markers, and task checkboxes", () => {
    const input = ["- first", "* second", "3. third", "- [x] done", "- [ ] todo"].join("\n");
    expect(markdownToSpokenText(input)).toBe("first\nsecond\nthird\ndone\ntodo");
  });

  it("strips blockquote markers", () => {
    expect(markdownToSpokenText("> > quoted thing")).toBe("quoted thing");
  });

  it("drops horizontal rules", () => {
    expect(markdownToSpokenText("before\n\n---\n\nafter")).toBe("before\n\nafter");
  });

  it("speaks table cells and drops the separator row", () => {
    const input = ["| Name | Count |", "| --- | ----: |", "| files | 12 |"].join("\n");
    expect(markdownToSpokenText(input)).toBe("Name, Count\nfiles, 12");
  });

  it("unescapes backslash-escaped punctuation", () => {
    expect(markdownToSpokenText("a literal \\* star")).toBe("a literal * star");
  });

  it("drops HTML comments", () => {
    expect(markdownToSpokenText("visible <!-- hidden --> text")).toBe("visible  text");
  });

  it("collapses the blank lines the strips leave behind", () => {
    expect(markdownToSpokenText("a\n\n\n\n---\n\n\nb")).toBe("a\n\nb");
  });

  it("returns empty for input with nothing speakable", () => {
    expect(markdownToSpokenText("---\n\n***\n")).toBe("");
  });

  it("leaves plain prose untouched", () => {
    const prose = "The report is done. It found three issues, all in the parser.";
    expect(markdownToSpokenText(prose)).toBe(prose);
  });
});
