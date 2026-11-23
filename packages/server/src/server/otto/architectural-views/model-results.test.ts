import { expect, test } from "vitest";
import type { ViewDocument } from "@getpaseo/plugin/otto/architectural-views";
import { viewModelText, viewSourcePart, VIEW_MODEL_CHARACTERS } from "./model-results.js";
const revision = "a".repeat(64);
const document: ViewDocument = {
  kind: "published",
  view: {
    viewId: "system",
    title: "Source",
    diagramType: "architecture",
    origin: { location: "repository", storeKey: "b".repeat(64) },
    revision,
    knowledgeReferences: [{ kind: "root", id: "architecture" }],
    sourceStatus: "current",
    renderedAt: "2026-11-09",
    state: "published",
  },
  specification: {
    labels: Array.from({ length: 3000 }, (_, index) => ({ id: index, text: '🙂 "source"\n' })),
  },
};
test("large source is losslessly readable below every supported harness result cap", () => {
  let offset: number | null = 0;
  const parts: string[] = [];
  let count = 0;
  while (offset !== null) {
    const result = viewSourcePart(document, {
      offset,
      expectedRevision: offset ? revision : undefined,
    });
    const text = viewModelText(result);
    expect(text.length).toBeLessThanOrEqual(VIEW_MODEL_CHARACTERS);
    expect(JSON.parse(text).source.revision).toBe(revision);
    parts.push(result.source.text);
    offset = result.source.nextOffset;
    if (++count > 100) throw new Error("Unbounded source paging");
  }
  expect(parts.join("")).toBe(JSON.stringify(document.specification, null, 2));
  expect(count).toBeGreaterThan(1);
});
test("source continuation requires the original revision and never combines peer edits", () => {
  expect(() => viewSourcePart(document, { offset: 8000 })).toThrow("pin every source part");
  expect(() =>
    viewSourcePart(document, { offset: 8000, expectedRevision: "c".repeat(64) }),
  ).toThrow("pin every source part");
  expect(() => viewSourcePart(document, { offset: 524288, expectedRevision: revision })).toThrow(
    "outside",
  );
});
test("oversized non-source model replies fail explicitly instead of yielding truncated JSON", () => {
  expect(() => viewModelText({ value: "x".repeat(14000) })).toThrow("transfer budget");
});
