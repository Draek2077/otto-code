import { expect, it } from "vitest";
import { markdownNoteTargets } from "./annotation-source";
import { editorContextText, sourceExcerpt } from "../context-attachment";
it("keeps source-backed heading locators through frontmatter, CRLF, inline formatting, fenced examples and duplicate titles", () => {
  const source =
    "---\r\ntitle: Header\r\n---\r\n# **Actual** `heading`\r\n\r\n```md\r\n# example\r\n```\r\n\r\nSecond\r\n------\r\n";
  const targets = markdownNoteTargets(source);
  expect(targets.map((target) => [target.title, target.range.start.line])).toEqual([
    ["Actual heading", 3],
    ["Second", 9],
  ]);
  for (const target of targets) expect(source.slice(target.from, target.to)).toBe(target.excerpt);
  expect(targets[1].excerpt).toBe("Second\r\n------");
  expect(markdownNoteTargets("<div>\n# not a heading\n</div>\n")).toEqual([]);
});
it("captures exact UTF-16 selections and emits plain provider-neutral source context without inventing disk state", () => {
  const range = { start: { line: 0, character: 2 }, end: { line: 1, character: 3 } };
  const excerpt = sourceExcerpt("😀alpha\r\nbeta\r\n", range);
  expect(excerpt).toBe("alpha\nbet");
  expect(
    sourceExcerpt("x".repeat(21000), {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 21000 },
    }),
  ).toBe(
    `${"x".repeat(20000)}\n[Captured excerpt limited to 20,000 characters; requested range is shown above.]`,
  );
  expect(
    editorContextText({
      kind: "editor_context",
      id: "source",
      file: "guide.md",
      range,
      excerpt,
      note: "Keep this",
      locator: "source",
    }),
  ).toMatchObject({ type: "text", mimeType: "text/plain" });
  expect(
    editorContextText({
      kind: "editor_context",
      id: "source",
      file: "guide.md",
      range,
      excerpt,
      note: "Keep this",
      locator: "source",
    }).text,
  ).toContain("may include unsaved edits");
});
