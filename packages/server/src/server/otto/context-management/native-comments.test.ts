import { expect, test } from "vitest";
import { claudeInstructionText } from "./native-comments.js";
import { nativeReferences } from "./native-text.js";
test("maintainer comments do not contribute Claude prompt text, while surrounding prose remains", () => {
  expect(claudeInstructionText("Before\n<!-- private maintainer note\ncontinued -->\nAfter")).toBe(
    "Before\n\n\nAfter",
  );
});
test("fenced and inline code examples keep their literal comment syntax", () => {
  const text =
    "````md\n<!-- example -->\n```\n<!-- still code -->\n````\n`<!-- inline -->`\n<!-- remove -->";
  expect(claudeInstructionText(text)).toBe(text.slice(0, text.lastIndexOf("<!-- remove -->")));
});
test("dependency masking preserves UTF-16 offsets and does not load commented imports", () => {
  const text = "<!-- 😀 @hidden.md -->\n@visible.md\n[Later](later.md)";
  const masked = claudeInstructionText(text, true);
  expect(masked.length).toBe(text.length);
  const references = nativeReferences(text, true);
  expect(references.map((entry) => entry.target)).toEqual(["visible.md", "later.md"]);
  expect(text.slice(references[0]!.start, references[0]!.end)).toBe("@visible.md");
});
test("unclosed comments suppress remaining prose without changing the source", () => {
  expect(claudeInstructionText("Keep\n<!-- not closed\n@hidden.md")).toBe("Keep\n\n");
});
