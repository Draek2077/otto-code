import { expect, test } from "vitest";
import { removeFindingRanges } from "./finding-edits.js";
import { ContextConflict } from "./source-write.js";
function span(text: string, snippet: string, from = 0) {
  const start = text.indexOf(snippet, from);
  return { start, end: start + snippet.length, snippet };
}
test("removes complete dead-link bullets while preserving CRLF and unrelated blank runs", () => {
  const text = "First\r\n\r\n\r\n- @gone.md\r\nLast 🙂\r\n";
  expect(removeFindingRanges(text, [span(text, "@gone.md")])).toBe("First\r\n\r\n\r\nLast 🙂\r\n");
});
test("batched removals use original offsets and do not shift earlier ranges through global whitespace cleanup", () => {
  const text = "- @first.md\n\n\n\nKeep\n- @second.md\nTail";
  expect(removeFindingRanges(text, [span(text, "@first.md"), span(text, "@second.md")])).toBe(
    "\n\n\nKeep\nTail",
  );
});
test("a stale snippet rejects the complete file plan before any removal", () => {
  const text = "@first.md\n@second.md";
  expect(() =>
    removeFindingRanges(text, [
      span(text, "@first.md"),
      { ...span(text, "@second.md"), snippet: "STALE" },
    ]),
  ).toThrow(ContextConflict);
});
test("overlapping duplicate findings remove the same source region once", () => {
  const text = "Keep\n- @gone.md\nTail";
  expect(removeFindingRanges(text, [span(text, "@gone.md"), span(text, "- @gone.md")])).toBe(
    "Keep\nTail",
  );
});
test("inline removals preserve surrounding prose and tidy only their own space seam", () => {
  const text = "Read @gone.md later.  Other spacing stays.";
  expect(removeFindingRanges(text, [span(text, "@gone.md")])).toBe(
    "Read later.  Other spacing stays.",
  );
});
test("range validation refuses invalid offsets and an empty plan is a byte-identical no-op", () => {
  expect(() => removeFindingRanges("text", [{ start: -1, end: 2, snippet: "te" }])).toThrow(
    ContextConflict,
  );
  expect(() => removeFindingRanges("text", [{ start: 0.5, end: 2, snippet: "te" }])).toThrow(
    ContextConflict,
  );
  expect(removeFindingRanges("Keep\r\n", [])).toBe("Keep\r\n");
});
