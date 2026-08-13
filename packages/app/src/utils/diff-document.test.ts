import { describe, expect, it } from "vitest";
import { getSupportedExtensions } from "@otto-code/highlight";
import {
  buildStructuralDiffBlocks,
  buildStructuralDiffRows,
  buildStructuralSourceIndex,
  createDiffDocumentFromParsedFile,
  createDiffDocumentHunksFromLines,
  filterStructuralDiffBlocks,
  getStructuralDiffAvailability,
  getStructuralDiffUnavailableReason,
} from "./diff-document";
import type { ParsedDiffFile } from "@/git/use-diff-query";

describe("structural diff document", () => {
  it("derives an honest source-pair hunk header from real line coordinates", () => {
    expect(
      createDiffDocumentHunksFromLines([
        { type: "context", content: " shared", oldLineNumber: 9, newLineNumber: 9 },
        { type: "remove", content: "-before", oldLineNumber: 10 },
        { type: "add", content: "+after", newLineNumber: 10 },
      ]),
    ).toMatchObject([
      {
        header: "@@ -9,2 +9,2 @@",
        lines: [
          { oldLineNumber: 9, newLineNumber: 9 },
          { oldLineNumber: 10, newLineNumber: null },
          { oldLineNumber: null, newLineNumber: 10 },
        ],
      },
    ]);
  });

  it("adapts a live patch without losing hunk boundaries or review targets", () => {
    const file: ParsedDiffFile = {
      path: "src/example.ts",
      isNew: false,
      isDeleted: false,
      additions: 1,
      deletions: 1,
      status: "ok",
      beforeSource: "shared\nbefore",
      afterSource: "shared\nafter",
      hunks: [
        {
          oldStart: 40,
          oldCount: 2,
          newStart: 40,
          newCount: 2,
          lines: [
            { type: "header", content: "@@ -40,2 +40,2 @@" },
            { type: "context", content: " shared" },
            { type: "remove", content: "-before" },
            { type: "add", content: "+after" },
          ],
        },
      ],
    };

    const document = createDiffDocumentFromParsedFile(file);

    expect(document.hunks).toHaveLength(1);
    expect(document).toMatchObject({
      beforeSource: "shared\nbefore",
      afterSource: "shared\nafter",
    });
    expect(document.hunks?.[0]).toMatchObject({ index: 0, header: "@@ -40,2 +40,2 @@" });
    expect(document.hunks?.[0]?.lines).toEqual([
      expect.objectContaining({ oldLineNumber: null, newLineNumber: null }),
      expect.objectContaining({
        oldLineNumber: 40,
        newLineNumber: 40,
        oldReviewTarget: expect.objectContaining({ key: "src/example.ts:old:40" }),
        newReviewTarget: expect.objectContaining({ key: "src/example.ts:new:40" }),
      }),
      expect.objectContaining({
        oldLineNumber: 41,
        newLineNumber: null,
        oldReviewTarget: expect.objectContaining({ key: "src/example.ts:old:41" }),
        newReviewTarget: null,
      }),
      expect.objectContaining({
        oldLineNumber: null,
        newLineNumber: 41,
        oldReviewTarget: null,
        newReviewTarget: expect.objectContaining({ key: "src/example.ts:new:41" }),
      }),
    ]);
  });

  it("pairs corresponding syntax fragments before unrelated additions", () => {
    const rows = buildStructuralDiffRows({
      source: "before-after",
      filePath: "src/example.ts",
      lines: [
        { type: "remove", content: "-function total(a, b) {" },
        { type: "remove", content: "-  return a + b;" },
        { type: "add", content: "+function total(left, right) {" },
        { type: "add", content: "+  return left + right;" },
      ],
    });

    expect(rows).toEqual([
      expect.objectContaining({ kind: "pair", left: expect.anything(), right: expect.anything() }),
      expect.objectContaining({ kind: "pair", left: expect.anything(), right: expect.anything() }),
    ]);
  });

  it("builds parser context from complete, parser-safe snapshots", () => {
    const index = buildStructuralSourceIndex(
      ["export function format(value: string) {", "  return value.trim();", "}"].join("\n"),
      "src/format.ts",
    );

    expect(index?.contexts.get(2)).toEqual(expect.arrayContaining(["FunctionDeclaration"]));
    expect(buildStructuralSourceIndex("export function incomplete( {", "src/format.ts")).toBeNull();
  });

  it("keeps aligned replacements monotonic when repeated code swaps order", () => {
    const rows = buildStructuralDiffRows({
      source: "before-after",
      filePath: "src/example.ts",
      lines: [
        { type: "remove", content: "-render(primary);" },
        { type: "remove", content: "-render(secondary);" },
        { type: "add", content: "+render(secondary);" },
        { type: "add", content: "+render(primary);" },
      ],
    });
    const paired = rows.filter(
      (row): row is Extract<typeof row, { kind: "pair" }> =>
        row.kind === "pair" && row.left !== null && row.right !== null,
    );

    // The old greedy planner claimed two crossed replacements. The monotonic
    // plan may preserve one strong correspondence, but never crosses source
    // order and therefore leaves the other move explicit.
    expect(paired).toHaveLength(1);
    expect(rows.filter((row) => row.kind === "pair" && row.left === null)).toHaveLength(1);
    expect(rows.filter((row) => row.kind === "pair" && row.right === null)).toHaveLength(1);
  });

  it("pairs an import replacement that keeps its import structure", () => {
    const blocks = buildStructuralDiffBlocks({
      source: "before-after",
      filePath: "src/panel.ts",
      lines: [
        { type: "remove", content: '-import { LegacyChart } from "./legacy-chart";' },
        { type: "add", content: '+import { Chart } from "./chart";' },
      ],
    });

    expect(blocks).toEqual([
      expect.objectContaining({
        kind: "replacement",
        before: [
          expect.objectContaining({ content: '-import { LegacyChart } from "./legacy-chart";' }),
        ],
        after: [expect.objectContaining({ content: '+import { Chart } from "./chart";' })],
      }),
    ]);
  });

  it("pairs same-level Markdown headings even when their words differ", () => {
    const blocks = buildStructuralDiffBlocks({
      source: "before-after",
      filePath: "guide.md",
      lines: [
        { type: "remove", content: "-# Deploy preview" },
        { type: "add", content: "+# Browser preview" },
      ],
    });

    expect(blocks.map((block) => block.kind)).toEqual(["replacement"]);
  });

  it("pairs matching HTML tags when their content and attributes change", () => {
    const blocks = buildStructuralDiffBlocks({
      source: "before-after",
      filePath: "page.html",
      lines: [
        { type: "remove", content: "-<h1>Old title</h1>" },
        { type: "add", content: '+<h1 id="title">New title</h1>' },
      ],
    });

    expect(blocks.map((block) => block.kind)).toEqual(["replacement"]);
  });

  it("pairs changed comments as one reviewable replacement", () => {
    const blocks = buildStructuralDiffBlocks({
      source: "before-after",
      filePath: "query.ts",
      lines: [
        { type: "remove", content: "-// Fetches the current profile." },
        { type: "add", content: "+// Fetches and validates the current profile." },
      ],
    });

    expect(blocks.map((block) => block.kind)).toEqual(["replacement"]);
  });

  it("keeps a complete line fallback for unsupported and oversized inputs", () => {
    expect(
      getStructuralDiffUnavailableReason({ source: "patch", filePath: "image.png", lines: [] }),
    ).toContain("file type");
    expect(
      getStructuralDiffUnavailableReason({
        source: "patch",
        filePath: "src/a.ts",
        lines: Array.from({ length: 2001 }, () => ({ type: "context" as const, content: " x" })),
      }),
    ).toContain("large diffs");
  });

  it("requires complete before and after snapshots for changed Structural files", () => {
    expect(
      getStructuralDiffAvailability({
        source: "patch",
        filePath: "src/example.ts",
        lines: [{ type: "add", content: "+export const total = 1;" }],
      }),
    ).toMatchObject({ available: false, code: "missing-source" });
  });

  it("shares structural eligibility with the syntax parser registry", () => {
    for (const filePath of ["src/theme.swift", "src/query.sql", "src/task.ex", "src/script.sh"]) {
      expect(
        getStructuralDiffAvailability({ source: "before-after", filePath, lines: [] }),
      ).toEqual({ available: true });
    }
    expect(
      getStructuralDiffAvailability({
        source: "before-after",
        filePath: "src/image.png",
        lines: [],
      }),
    ).toMatchObject({ available: false, code: "unsupported-language" });
  });

  it("keeps every syntax-parser language eligible for the Structural pipeline", () => {
    for (const extension of getSupportedExtensions()) {
      expect(
        getStructuralDiffAvailability({
          source: "before-after",
          filePath: `src/example.${extension}`,
          lines: [],
        }),
      ).toEqual({ available: true });
    }
  });

  it("falls back when either complete source snapshot has a parser error", () => {
    expect(
      getStructuralDiffAvailability({
        source: "before-after",
        filePath: "src/example.ts",
        beforeSource: "export function complete() { return 1; }",
        afterSource: "export function incomplete( {",
        lines: [],
      }),
    ).toMatchObject({ available: false, code: "invalid-source" });
  });

  it("classifies replacements, formatting, and exact moves without losing a line", () => {
    const blocks = buildStructuralDiffBlocks({
      source: "before-after",
      filePath: "src/example.ts",
      lines: [
        { type: "remove", content: "-const name = oldName;" },
        { type: "add", content: "+const name = newName;" },
        { type: "remove", content: "-validate(input);" },
        { type: "context", content: " save(input);" },
        { type: "add", content: "+validate(input);" },
      ],
    });

    expect(blocks.map((block) => block.kind)).toEqual(["replacement", "move", "shared", "move"]);
    expect(blocks.filter((block) => block.kind === "move")).toEqual([
      expect.objectContaining({ direction: "from" }),
      expect.objectContaining({ direction: "to" }),
    ]);

    const formatting = buildStructuralDiffBlocks({
      source: "before-after",
      filePath: "src/example.ts",
      lines: [
        { type: "remove", content: "-const route = buildRoute({ method, path, });" },
        { type: "add", content: "+const route = buildRoute({\n" },
        { type: "add", content: "+  method,\n" },
        { type: "add", content: "+  path,\n" },
        { type: "add", content: "+});" },
      ],
    });
    expect(formatting.map((block) => block.kind)).toEqual(["formatting"]);
    expect(filterStructuralDiffBlocks(formatting, false)).toEqual([]);
  });

  for (const filePath of ["src/branch.py", "config.yaml", "guide.md", "script.sh"]) {
    it(`keeps whitespace-only changes visible for ${filePath}`, () => {
      const blocks = buildStructuralDiffBlocks({
        source: "before-after",
        filePath,
        lines: [
          { type: "remove", content: "-    complete()" },
          { type: "add", content: "+complete()" },
        ],
      });

      expect(blocks.map((block) => block.kind)).toEqual(["replacement"]);
      expect(filterStructuralDiffBlocks(blocks, false)).toEqual(blocks);
    });
  }
});
